const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const jsonHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function response(statusCode, payload) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  };
}

function getDatabaseConfig() {
  const host = process.env.SUPABASE_DB_HOST || process.env.PGHOST;
  const port = Number(process.env.SUPABASE_DB_PORT || process.env.PGPORT || 5432);
  const database = process.env.SUPABASE_DB_NAME || process.env.PGDATABASE || 'postgres';
  const user = process.env.SUPABASE_DB_USER || process.env.PGUSER;
  const password = process.env.SUPABASE_DB_PASSWORD || process.env.PGPASSWORD;

  if (host && user && password) {
    return {
      host,
      port,
      database,
      user,
      password,
      ssl: true
    };
  }

  const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || '';
  if (connectionString) {
    const url = new URL(connectionString);
    return {
      host: url.hostname,
      port: Number(url.port || 5432),
      database: decodeURIComponent(url.pathname.replace(/^\//, '') || 'postgres'),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      ssl: true
    };
  }

  throw new Error('Missing Supabase database configuration');
}

function sqlLiteral(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function readCString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) end += 1;
  return {
    value: buffer.slice(offset, end).toString('utf8'),
    nextOffset: end + 1
  };
}

function readInt32(buffer, offset) {
  return buffer.readInt32BE(offset);
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function writeInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}

function writeInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeInt16BE(value, 0);
  return buffer;
}

function concatMessage(typeByte, payloadBuffers) {
  const payload = Buffer.concat(payloadBuffers);
  return Buffer.concat([
    Buffer.from(typeByte),
    writeInt32(payload.length + 4),
    payload
  ]);
}

function makeStartupMessage(config) {
  const params = [
    ['user', config.user],
    ['database', config.database],
    ['client_encoding', 'UTF8']
  ];

  const parts = [writeInt32(196608)];
  for (const [key, value] of params) {
    parts.push(Buffer.from(`${key}\0${value}\0`, 'utf8'));
  }
  parts.push(Buffer.from([0]));

  const body = Buffer.concat(parts);
  return Buffer.concat([writeInt32(body.length + 4), body]);
}

function makeSslRequest() {
  return Buffer.concat([writeInt32(8), writeInt32(80877103)]);
}

function makeSimpleQuery(sql) {
  return concatMessage('Q', [Buffer.from(`${sql}\0`, 'utf8')]);
}

function makeSaslInitialResponse(username, nonce) {
  const clientFirstBare = `n=${username},r=${nonce}`;
  const initialMessage = `n,,${clientFirstBare}`;
  const payload = Buffer.concat([
    Buffer.from('SCRAM-SHA-256\0', 'utf8'),
    writeInt32(Buffer.byteLength(initialMessage, 'utf8')),
    Buffer.from(initialMessage, 'utf8')
  ]);
  return {
    clientFirstBare,
    initialMessage,
    payload: concatMessage('p', [payload])
  };
}

function makeSaslResponse(responseText) {
  return concatMessage('p', [Buffer.from(responseText, 'utf8')]);
}

function parseErrorMessage(payload) {
  const fields = {};
  let offset = 0;
  while (offset < payload.length) {
    const code = String.fromCharCode(payload[offset]);
    offset += 1;
    if (code === '\0') break;
    const { value, nextOffset } = readCString(payload, offset);
    fields[code] = value;
    offset = nextOffset;
  }
  return fields.M || fields.S || fields.C || 'Unknown database error';
}

function parseCommandTag(tag) {
  const value = String(tag || '');
  const match = value.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function decodeDataRow(payload, fields) {
  let offset = 0;
  const columnCount = payload.readInt16BE(offset);
  offset += 2;
  const row = {};

  for (let index = 0; index < columnCount; index += 1) {
    const length = payload.readInt32BE(offset);
    offset += 4;
    const fieldName = fields[index]?.name || `column_${index + 1}`;
    if (length === -1) {
      row[fieldName] = null;
      continue;
    }

    row[fieldName] = payload.slice(offset, offset + length).toString('utf8');
    offset += length;
  }

  return row;
}

class SocketReader {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.closed = false;

    socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.flush();
    });

    socket.on('error', error => this.failAll(error));
    socket.on('end', () => this.failAll(new Error('Connection closed by server')));
  }

  flush() {
    while (this.waiters.length && this.buffer.length >= this.waiters[0].size) {
      const waiter = this.waiters.shift();
      const chunk = this.buffer.subarray(0, waiter.size);
      this.buffer = this.buffer.subarray(waiter.size);
      waiter.resolve(chunk);
    }
  }

  failAll(error) {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length) {
      this.waiters.shift().reject(error);
    }
  }

  read(size) {
    if (this.buffer.length >= size) {
      const chunk = this.buffer.subarray(0, size);
      this.buffer = this.buffer.subarray(size);
      return Promise.resolve(chunk);
    }

    return new Promise((resolve, reject) => {
      this.waiters.push({ size, resolve, reject });
    });
  }
}

class MinimalPgClient {
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.reader = null;
  }

  async connect() {
    const plainSocket = await this.openSocket(this.config.host, this.config.port);
    plainSocket.write(makeSslRequest());

    const sslResponse = await this.readExact(plainSocket, 1);
    if (sslResponse.toString('utf8') !== 'S') {
      throw new Error('Postgres server refused SSL');
    }

    this.socket = await this.upgradeToTls(plainSocket, this.config.host);
    this.reader = new SocketReader(this.socket);
    this.socket.write(makeStartupMessage(this.config));
    await this.authenticate();
    return this;
  }

  async authenticate() {
    let saslState = null;

    while (true) {
      const message = await this.readMessage();

      if (message.type === 'R') {
        const authCode = message.payload.readInt32BE(0);

        if (authCode === 0) {
          continue;
        }

        if (authCode === 10) {
          const mechanisms = [];
          let offset = 4;
          while (offset < message.payload.length) {
            const { value, nextOffset } = readCString(message.payload, offset);
            offset = nextOffset;
            if (!value) break;
            mechanisms.push(value);
          }

          if (!mechanisms.includes('SCRAM-SHA-256')) {
            throw new Error('Server does not support SCRAM-SHA-256');
          }

          const nonce = crypto.randomBytes(18).toString('base64');
          const initial = makeSaslInitialResponse(this.config.user, nonce);
          saslState = this.buildScramState(initial.clientFirstBare, nonce);
          this.socket.write(initial.payload);
          continue;
        }

        if (authCode === 11) {
          if (!saslState) throw new Error('SCRAM state missing');
          const serverFirstMessage = message.payload.slice(4).toString('utf8');
          const parsed = this.parseServerFirstMessage(serverFirstMessage);
          const finalMessage = this.buildScramFinalMessage(saslState, parsed, serverFirstMessage);
          this.socket.write(makeSaslResponse(finalMessage.clientFinalMessage));
          saslState.expectedServerSignature = finalMessage.expectedServerSignature;
          continue;
        }

        if (authCode === 12) {
          if (!saslState) throw new Error('SCRAM state missing');
          const serverFinalMessage = message.payload.slice(4).toString('utf8');
          const serverSignature = this.parseServerFinalMessage(serverFinalMessage);
          if (serverSignature && saslState.expectedServerSignature && serverSignature !== saslState.expectedServerSignature) {
            throw new Error('SCRAM server signature mismatch');
          }
          continue;
        }

        throw new Error(`Unsupported authentication method: ${authCode}`);
      }

      if (message.type === 'S' || message.type === 'K' || message.type === 'N') {
        continue;
      }

      if (message.type === 'Z') {
        return;
      }

      if (message.type === 'E') {
        throw new Error(parseErrorMessage(message.payload));
      }
    }
  }

  buildScramState(clientFirstBare, nonce) {
    return {
      clientFirstBare,
      nonce,
      password: this.config.password
    };
  }

  parseServerFirstMessage(message) {
    const result = {};
    for (const part of message.split(',')) {
      const [key, value] = part.split('=');
      result[key] = value;
    }
    return result;
  }

  buildScramFinalMessage(state, serverFirst, serverFirstMessage) {
    const salt = Buffer.from(serverFirst.s || '', 'base64');
    const iterations = Number(serverFirst.i || 0);
    const channelBinding = 'biws';
    const clientFinalWithoutProof = `c=${channelBinding},r=${serverFirst.r}`;
    const authMessage = `${state.clientFirstBare},${serverFirstMessage},${clientFinalWithoutProof}`;
    const saltedPassword = crypto.pbkdf2Sync(state.password, salt, iterations, 32, 'sha256');
    const clientKey = crypto.createHmac('sha256', saltedPassword).update('Client Key').digest();
    const storedKey = crypto.createHash('sha256').update(clientKey).digest();
    const clientSignature = crypto.createHmac('sha256', storedKey).update(authMessage).digest();
    const clientProof = Buffer.alloc(clientKey.length);
    for (let index = 0; index < clientKey.length; index += 1) {
      clientProof[index] = clientKey[index] ^ clientSignature[index];
    }
    const serverKey = crypto.createHmac('sha256', saltedPassword).update('Server Key').digest();
    const expectedServerSignature = crypto.createHmac('sha256', serverKey).update(authMessage).digest('base64');
    return {
      clientFinalMessage: `${clientFinalWithoutProof},p=${clientProof.toString('base64')}`,
      expectedServerSignature
    };
  }

  parseServerFinalMessage(message) {
    const match = message.match(/v=([^,]+)/);
    return match ? match[1] : '';
  }

  async query(sql) {
    this.socket.write(makeSimpleQuery(sql));
    const rows = [];
    let fields = [];
    let commandTag = '';

    while (true) {
      const message = await this.readMessage();

      if (message.type === 'T') {
        fields = this.parseRowDescription(message.payload);
        continue;
      }

      if (message.type === 'D') {
        rows.push(decodeDataRow(message.payload, fields));
        continue;
      }

      if (message.type === 'C') {
        commandTag = message.payload.subarray(0, message.payload.length - 1).toString('utf8');
        continue;
      }

      if (message.type === 'Z') {
        return {
          rows,
          rowCount: rows.length || parseCommandTag(commandTag),
          commandTag
        };
      }

      if (message.type === 'E') {
        throw new Error(parseErrorMessage(message.payload));
      }
    }
  }

  parseRowDescription(payload) {
    let offset = 0;
    const count = payload.readInt16BE(offset);
    offset += 2;
    const fields = [];

    for (let index = 0; index < count; index += 1) {
      const { value, nextOffset } = readCString(payload, offset);
      offset = nextOffset + 18;
      fields.push({ name: value });
    }

    return fields;
  }

  async close() {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }

  async readMessage() {
    const type = await this.reader.read(1);
    const lengthBuffer = await this.reader.read(4);
    const length = lengthBuffer.readInt32BE(0);
    const payload = await this.reader.read(length - 4);
    return {
      type: type.toString('utf8'),
      payload
    };
  }

  openSocket(host, port) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host, port }, () => resolve(socket));
      socket.once('error', reject);
    });
  }

  upgradeToTls(socket, host) {
    return new Promise((resolve, reject) => {
      const tlsSocket = tls.connect({
        socket,
        servername: host,
        rejectUnauthorized: false
      }, () => resolve(tlsSocket));
      tlsSocket.once('error', reject);
    });
  }

  readExact(socket, size) {
    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      const onData = chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length < size) return;
        socket.off('data', onData);
        resolve(buffer.subarray(0, size));
      };
      socket.on('data', onData);
      socket.once('error', reject);
    });
  }
}

let schemaReady = false;
let schemaPromise = null;

function normalizeTicket(ticket) {
  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) {
    throw new Error('Invalid ticket payload');
  }

  const copy = JSON.parse(JSON.stringify(ticket));
  if (copy.ticketId != null) copy.ticketId = String(copy.ticketId).trim();
  return copy;
}

function hydrateTicket(row) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    ticketId: row.ticket_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function connectClient() {
  const client = new MinimalPgClient(getDatabaseConfig());
  await client.connect();
  return client;
}

async function ensureSchema(client) {
  if (!schemaReady) {
    if (!schemaPromise) {
      schemaPromise = (async () => {
        await client.query(`
          CREATE TABLE IF NOT EXISTS workflow_tickets (
            ticket_id text PRIMARY KEY,
            payload jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          )
        `);

        await client.query(`
          CREATE INDEX IF NOT EXISTS workflow_tickets_updated_at_idx
          ON workflow_tickets (updated_at DESC)
        `);
      })();
    }

    await schemaPromise;
    schemaReady = true;
  }
}

async function getLatestTicketNumber(client, year) {
  const sql = `
    SELECT ticket_id
    FROM workflow_tickets
    WHERE ticket_id LIKE ${sqlLiteral(`REQ-${year}-%`)}
    ORDER BY ticket_id DESC
    LIMIT 1
  `;
  const { rows } = await client.query(sql);
  const lastTicketId = rows[0]?.ticket_id || '';
  const match = lastTicketId.match(/-(\d{4})$/);
  return match ? Number(match[1]) + 1 : 1;
}

async function upsertTicket(client, ticket) {
  const payload = normalizeTicket(ticket);
  const year = new Date().getFullYear();
  const ticketId = payload.ticketId || `REQ-${year}-${String(await getLatestTicketNumber(client, year)).padStart(4, '0')}`;
  payload.ticketId = ticketId;

  const sql = `
    INSERT INTO workflow_tickets (ticket_id, payload)
    VALUES (${sqlLiteral(ticketId)}, ${sqlLiteral(JSON.stringify(payload))}::jsonb)
    ON CONFLICT (ticket_id)
    DO UPDATE SET
      payload = EXCLUDED.payload,
      updated_at = now()
    RETURNING ticket_id, payload, created_at, updated_at
  `;
  const result = await client.query(sql);
  return hydrateTicket(result.rows[0]);
}

async function replaceTickets(client, tickets) {
  const payloads = Array.isArray(tickets) ? tickets.map(normalizeTicket) : [];
  const year = new Date().getFullYear();
  let nextTicketNumber = await getLatestTicketNumber(client, year);

  await client.query('BEGIN');
  try {
    await client.query('DELETE FROM workflow_tickets');

    for (const payload of payloads) {
      const ticketId = payload.ticketId || `REQ-${year}-${String(nextTicketNumber).padStart(4, '0')}`;
      if (!payload.ticketId) nextTicketNumber += 1;
      payload.ticketId = ticketId;

      await client.query(`
        INSERT INTO workflow_tickets (ticket_id, payload)
        VALUES (${sqlLiteral(ticketId)}, ${sqlLiteral(JSON.stringify(payload))}::jsonb)
      `);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  const { rows } = await client.query(`
    SELECT ticket_id, payload, created_at, updated_at
    FROM workflow_tickets
    ORDER BY updated_at DESC, ticket_id DESC
  `);

  return rows.map(hydrateTicket);
}

async function listTickets(client) {
  const { rows } = await client.query(`
    SELECT ticket_id, payload, created_at, updated_at
    FROM workflow_tickets
    ORDER BY updated_at DESC, ticket_id DESC
  `);
  return rows.map(hydrateTicket);
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: jsonHeaders, body: '' };
  }

  let client;

  try {
    client = await connectClient();
    await ensureSchema(client);

    if (event.httpMethod === 'GET') {
      const ticketId = String(event.queryStringParameters?.ticketId || event.queryStringParameters?.ticket || '').trim();

      if (ticketId) {
        const { rows } = await client.query(`
          SELECT ticket_id, payload, created_at, updated_at
          FROM workflow_tickets
          WHERE ticket_id = ${sqlLiteral(ticketId)}
          LIMIT 1
        `);

        if (!rows.length) {
          return response(404, { ok: false, error: 'Ticket not found' });
        }

        return response(200, { ok: true, ticket: hydrateTicket(rows[0]) });
      }

      return response(200, {
        ok: true,
        tickets: await listTickets(client)
      });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (error) {
      return response(400, { ok: false, error: 'Invalid JSON body' });
    }

    if (event.httpMethod === 'POST') {
      const ticket = normalizeTicket(payload.ticket || payload);
      const savedTicket = await upsertTicket(client, ticket);
      return response(200, { ok: true, ticket: savedTicket });
    }

    if (event.httpMethod === 'PATCH') {
      const ticketId = String(payload.ticketId || payload.ticket?.ticketId || '').trim();
      if (!ticketId) {
        return response(400, { ok: false, error: 'Missing ticketId' });
      }

      const { rows } = await client.query(`
        SELECT ticket_id, payload, created_at, updated_at
        FROM workflow_tickets
        WHERE ticket_id = ${sqlLiteral(ticketId)}
        LIMIT 1
      `);

      if (!rows.length) {
        return response(404, { ok: false, error: 'Ticket not found' });
      }

      const existing = hydrateTicket(rows[0]);
      const patch = payload.patch || payload.ticket || {};
      const savedTicket = await upsertTicket(client, { ...existing, ...patch, ticketId });
      return response(200, { ok: true, ticket: savedTicket });
    }

    if (event.httpMethod === 'PUT') {
      const tickets = await replaceTickets(client, payload.tickets || []);
      return response(200, { ok: true, tickets });
    }

    return response(405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('workflow-tickets failed', error);
    return response(500, {
      ok: false,
      error: error.message || 'Failed to process workflow tickets'
    });
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
  }
};

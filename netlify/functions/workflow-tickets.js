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

let schemaReady = false;
let schemaPromise = null;

function getSupabaseRestConfig() {
  const supabaseUrl = String(
    process.env.SUPABASE_URL
    || process.env.SUPABASE_PROJECT_URL
    || process.env.SUPABASE_INSTANCE_URL
    || ''
  ).trim().replace(/\/$/, '');

  const apiKey = String(
    process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_DB_SECRET_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY
    || ''
  ).trim();

  if (!supabaseUrl || !apiKey) {
    throw new Error('Missing Supabase REST configuration');
  }

  return {
    supabaseUrl,
    apiKey,
    restUrl: `${supabaseUrl}/rest/v1`
  };
}

function createRestHeaders(apiKey, extra = {}) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    ...extra
  };
}

async function restRequest(method, path, { apiKey, query = '', body = null, headers = {} }) {
  const url = new URL(`${path}${query}`, `${getSupabaseRestConfig().restUrl}/`);
  const response = await fetch(url.toString(), {
    method,
    headers: createRestHeaders(apiKey, body ? { 'Content-Type': 'application/json', Prefer: 'return=representation', ...headers } : headers),
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text().catch(() => '');
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const message = data?.message || data?.error || text || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

function hydrateTickets(rows) {
  return (Array.isArray(rows) ? rows : []).map(hydrateTicket).sort((a, b) => {
    const left = new Date(b.updatedAt || b.updated_at || 0).getTime();
    const right = new Date(a.updatedAt || a.updated_at || 0).getTime();
    return left - right;
  });
}

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
  return getSupabaseRestConfig();
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: jsonHeaders, body: '' };
  }

  let client;

  try {
    client = await connectClient();

    if (event.httpMethod === 'GET') {
      const ticketId = String(event.queryStringParameters?.ticketId || event.queryStringParameters?.ticket || '').trim();

      if (ticketId) {
        const rows = await restRequest('GET', 'workflow_tickets', {
          apiKey: client.apiKey,
          query: `?select=ticket_id,payload,created_at,updated_at&ticket_id=eq.${encodeURIComponent(ticketId)}&limit=1`
        });

        if (!Array.isArray(rows) || !rows.length) {
          return response(404, { ok: false, error: 'Ticket not found' });
        }

        return response(200, { ok: true, ticket: hydrateTicket(rows[0]) });
      }

      const rows = await restRequest('GET', 'workflow_tickets', {
        apiKey: client.apiKey,
        query: '?select=ticket_id,payload,created_at,updated_at&order=updated_at.desc,ticket_id.desc'
      });

      return response(200, {
        ok: true,
        tickets: hydrateTickets(rows)
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
      const year = new Date().getFullYear();
      const ticketId = ticket.ticketId || `REQ-${year}-${String(Date.now()).slice(-4)}`;
      ticket.ticketId = ticketId;
      const [savedTicket] = await restRequest('POST', 'workflow_tickets', {
        apiKey: client.apiKey,
        query: '?on_conflict=ticket_id',
        body: ticket,
        headers: {
          Prefer: 'return=representation,resolution=merge-duplicates'
        }
      });
      return response(200, { ok: true, ticket: savedTicket });
    }

    if (event.httpMethod === 'PATCH') {
      const ticketId = String(payload.ticketId || payload.ticket?.ticketId || '').trim();
      if (!ticketId) {
        return response(400, { ok: false, error: 'Missing ticketId' });
      }

      const existingRows = await restRequest('GET', 'workflow_tickets', {
        apiKey: client.apiKey,
        query: `?select=ticket_id,payload,created_at,updated_at&ticket_id=eq.${encodeURIComponent(ticketId)}&limit=1`
      });

      if (!Array.isArray(existingRows) || !existingRows.length) {
        return response(404, { ok: false, error: 'Ticket not found' });
      }

      const existing = hydrateTicket(existingRows[0]);
      const patch = payload.patch || payload.ticket || {};
      const nextPayload = normalizeTicket({ ...existing, ...patch, ticketId });
      const [savedTicket] = await restRequest('POST', 'workflow_tickets', {
        apiKey: client.apiKey,
        query: '?on_conflict=ticket_id',
        body: nextPayload,
        headers: {
          Prefer: 'return=representation,resolution=merge-duplicates'
        }
      });
      return response(200, { ok: true, ticket: savedTicket });
    }

    if (event.httpMethod === 'PUT') {
      const ticketsPayload = Array.isArray(payload.tickets) ? payload.tickets.map(normalizeTicket) : [];
      await restRequest('DELETE', 'workflow_tickets', {
        apiKey: client.apiKey,
        query: '?ticket_id=not.is.null'
      });

      const tickets = [];
      for (const ticket of ticketsPayload) {
        const year = new Date().getFullYear();
        if (!ticket.ticketId) {
          ticket.ticketId = `REQ-${year}-${String(Date.now()).slice(-4)}`;
        }
        const [savedTicket] = await restRequest('POST', 'workflow_tickets', {
          apiKey: client.apiKey,
          query: '?on_conflict=ticket_id',
          body: ticket,
          headers: {
            Prefer: 'return=representation,resolution=merge-duplicates'
          }
        });
        tickets.push(savedTicket);
      }
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
    client = null;
  }
};

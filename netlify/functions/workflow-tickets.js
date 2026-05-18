const { Pool } = require('pg');

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

function normalizeTicket(ticket) {
  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) {
    throw new Error('Invalid ticket payload');
  }

  const copy = JSON.parse(JSON.stringify(ticket));
  if (copy.ticketId != null) copy.ticketId = String(copy.ticketId).trim();
  return copy;
}

function getCurrentIso() {
  return new Date().toISOString();
}

function hydrateTicket(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    ticketId: row.ticket_id || payload.ticketId,
    createdAt: row.created_at || payload.createdAt,
    updatedAt: row.updated_at || payload.updatedAt
  };
}

function hydrateTickets(rows) {
  return (Array.isArray(rows) ? rows : []).map(hydrateTicket).sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.updated_at || 0).getTime();
    const rightTime = new Date(right.updatedAt || right.updated_at || 0).getTime();
    if (leftTime !== rightTime) return rightTime - leftTime;
    return String(right.ticketId || '').localeCompare(String(left.ticketId || ''));
  });
}

function getDatabaseConfig() {
  const connectionTimeoutMillis = Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000);
  const connectionString = String(
    process.env.SUPABASE_DATABASE_URL
    || process.env.SUPABASE_DB_URL
    || process.env.SUPABASE_POSTGRES_URL
    || process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.PG_CONNECTION_STRING
    || ''
  ).trim();

  if (connectionString) {
    return {
      connectionString,
      ssl: { rejectUnauthorized: false },
      allowExitOnIdle: true,
      max: 1,
      connectionTimeoutMillis
    };
  }

  const host = String(process.env.SUPABASE_DB_HOST || process.env.PGHOST || '').trim();
  const port = Number(process.env.SUPABASE_DB_PORT || process.env.PGPORT || 5432);
  const database = String(process.env.SUPABASE_DB_NAME || process.env.PGDATABASE || 'postgres').trim();
  const user = String(process.env.SUPABASE_DB_USER || process.env.PGUSER || '').trim();
  const password = String(
    process.env.SUPABASE_DB_PASSWORD
    || process.env.PGPASSWORD
    || process.env.SUPABASE_DB_SECRET
    || ''
  );

  if (!host || !user || !password) {
    throw new Error('Missing database configuration');
  }

  return {
    host,
    port,
    database,
    user,
    password,
    ssl: { rejectUnauthorized: false },
    allowExitOnIdle: true,
    max: 1,
    connectionTimeoutMillis
  };
}

function getRestConfig() {
  const baseUrl = String(
    process.env.SUPABASE_URL
    || process.env.SUPABASE_PROJECT_URL
    || process.env.SUPABASE_REST_URL
    || ''
  ).trim().replace(/\/+$/, '');
  const apiKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_KEY
    || process.env.SUPABASE_ANON_KEY
    || ''
  ).trim();

  if (!baseUrl || !apiKey) {
    return null;
  }

  return {
    baseUrl,
    apiKey,
    table: String(process.env.WORKFLOW_TICKETS_TABLE || 'workflow_tickets').trim() || 'workflow_tickets'
  };
}

function getStorageMode() {
  const restConfig = getRestConfig();

  try {
    const dbConfig = getDatabaseConfig();
    return restConfig ? { mode: 'pg', dbConfig, restConfig } : { mode: 'pg', dbConfig };
  } catch (error) {
    if (restConfig) {
      return { mode: 'rest', restConfig };
    }

    const supported = [
      'SUPABASE_DATABASE_URL',
      'SUPABASE_DB_URL',
      'SUPABASE_POSTGRES_URL',
      'DATABASE_URL',
      'POSTGRES_URL',
      'PG_CONNECTION_STRING',
      'SUPABASE_DB_HOST',
      'PGHOST',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_SECRET_KEY',
      'SUPABASE_KEY'
    ];

    throw new Error(`Missing workflow storage configuration. Set one of: ${supported.join(', ')}`);
  }
}

let pool = null;
let schemaPromise = null;

function getPool() {
  if (!pool) {
    pool = new Pool(getDatabaseConfig());
  }
  return pool;
}

async function ensureSchema(client) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await client.query(`
        create table if not exists public.workflow_tickets (
          ticket_id text primary key,
          payload jsonb not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);

      await client.query(`
        create index if not exists workflow_tickets_updated_at_idx
          on public.workflow_tickets (updated_at desc)
      `);

      await client.query(`
        alter table public.workflow_tickets enable row level security
      `).catch(() => {});
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}

async function withClient(run) {
  const client = await getPool().connect();
  try {
    await ensureSchema(client);
    return await run(client);
  } finally {
    client.release();
  }
}

async function saveTicket(client, ticket) {
  const payload = normalizeTicket(ticket);
  const ticketId = payload.ticketId || `REQ-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
  payload.ticketId = ticketId;

  const { rows } = await client.query(
    `
      insert into public.workflow_tickets (ticket_id, payload, created_at, updated_at)
      values (
        $1,
        $2::jsonb,
        coalesce((select created_at from public.workflow_tickets where ticket_id = $1), now()),
        now()
      )
      on conflict (ticket_id) do update
        set payload = excluded.payload,
            updated_at = now()
      returning ticket_id, payload, created_at, updated_at
    `,
    [ticketId, JSON.stringify(payload)]
  );

  return hydrateTicket(rows[0]);
}

async function restRequest(restConfig, method, path = '', body = null, extraHeaders = {}) {
  const url = new URL(`${restConfig.baseUrl}/rest/v1/${restConfig.table}${path}`);
  const timeoutMs = Number(process.env.SUPABASE_REST_TIMEOUT_MS || 10000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Supabase REST request timed out')), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        apikey: restConfig.apiKey,
        Authorization: `Bearer ${restConfig.apiKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...extraHeaders
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

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

function toRestRow(ticket, existingRow = null) {
  const payload = normalizeTicket(ticket);
  const ticketId = payload.ticketId || existingRow?.ticket_id || `REQ-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
  const createdAt = existingRow?.created_at || payload.createdAt || getCurrentIso();
  const updatedAt = getCurrentIso();

  payload.ticketId = ticketId;
  payload.createdAt = createdAt;
  payload.updatedAt = updatedAt;

  return {
    ticket_id: ticketId,
    payload,
    created_at: createdAt,
    updated_at: updatedAt
  };
}

async function restGetTicket(restConfig, ticketId) {
  const rows = await restRequest(
    restConfig,
    'GET',
    `?select=ticket_id,payload,created_at,updated_at&ticket_id=eq.${encodeURIComponent(ticketId)}&limit=1`
  );
  return Array.isArray(rows) && rows.length ? hydrateTicket(rows[0]) : null;
}

async function restListTickets(restConfig) {
  const rows = await restRequest(
    restConfig,
    'GET',
    '?select=ticket_id,payload,created_at,updated_at&order=updated_at.desc,ticket_id.desc'
  );
  return hydrateTickets(rows);
}

async function restSaveTicket(restConfig, ticket) {
  const payload = normalizeTicket(ticket);
  const ticketId = payload.ticketId || `REQ-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
  const existing = await restGetTicket(restConfig, ticketId);
  const row = toRestRow({ ...payload, ticketId }, existing);
  const rows = await restRequest(
    restConfig,
    'POST',
    '?on_conflict=ticket_id',
    row,
    { Prefer: 'return=representation,resolution=merge-duplicates' }
  );

  if (!Array.isArray(rows) || !rows.length) {
    return {
      ...row.payload,
      ticketId: row.ticket_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  return hydrateTicket(rows[0]);
}

async function restDeleteAllTickets(restConfig) {
  await restRequest(restConfig, 'DELETE', '?ticket_id=not.is.null', null, {
    Prefer: 'return=minimal'
  });
}

async function restReplaceAllTickets(restConfig, tickets) {
  const normalized = Array.isArray(tickets) ? tickets.map(normalizeTicket) : [];
  await restDeleteAllTickets(restConfig);

  const saved = [];
  for (const ticket of normalized) {
    saved.push(await restSaveTicket(restConfig, ticket));
  }
  return saved;
}

async function readAllTickets(storage) {
  if (storage.mode === 'pg') {
    return withClient(async client => {
      const { rows } = await client.query(
        `
          select ticket_id, payload, created_at, updated_at
          from public.workflow_tickets
          order by updated_at desc, ticket_id desc
        `
      );
      return hydrateTickets(rows);
    });
  }

  return restListTickets(storage.restConfig);
}

async function readSingleTicket(storage, ticketId) {
  if (storage.mode === 'pg') {
    return withClient(async client => {
      const { rows } = await client.query(
        `
          select ticket_id, payload, created_at, updated_at
          from public.workflow_tickets
          where ticket_id = $1
          limit 1
        `,
        [ticketId]
      );

      return rows.length ? hydrateTicket(rows[0]) : null;
    });
  }

  return restGetTicket(storage.restConfig, ticketId);
}

async function writeTicket(storage, ticket) {
  if (storage.mode === 'pg') {
    return withClient(async client => saveTicket(client, ticket));
  }

  return restSaveTicket(storage.restConfig, ticket);
}

async function patchExistingTicket(storage, ticketId, patch) {
  const existing = await readSingleTicket(storage, ticketId);
  if (!existing) {
    return null;
  }
  return writeTicket(storage, {
    ...existing,
    ...(patch || {}),
    ticketId: existing.ticketId
  });
}

async function replaceAllTickets(storage, tickets) {
  if (storage.mode === 'pg') {
    return withClient(async client => replaceAllTicketsPg(client, tickets));
  }

  return restReplaceAllTickets(storage.restConfig, tickets);
}

async function replaceAllTicketsPg(client, tickets) {
  const normalized = Array.isArray(tickets) ? tickets.map(normalizeTicket) : [];

  await client.query('begin');
  try {
    await client.query('delete from public.workflow_tickets');

    const saved = [];
    for (const ticket of normalized) {
      saved.push(await saveTicket(client, ticket));
    }

    await client.query('commit');
    return saved;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function runWithStorageFallback(storage, operation) {
  if (storage.mode !== 'pg' || !storage.restConfig) {
    return operation(storage);
  }

  try {
    return await operation(storage);
  } catch (error) {
    console.warn('workflow-tickets: pg backend failed, trying Supabase REST fallback.', error);
    const fallbackStorage = {
      mode: 'rest',
      restConfig: storage.restConfig
    };
    return await operation(fallbackStorage);
  }
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: jsonHeaders, body: '' };
  }

  try {
    const storage = getStorageMode();

    if (event.httpMethod === 'GET') {
      return await runWithStorageFallback(storage, async activeStorage => {
        const ticketId = String(event.queryStringParameters?.ticketId || event.queryStringParameters?.ticket || '').trim();
        if (ticketId) {
          const ticket = await readSingleTicket(activeStorage, ticketId);
          if (!ticket) {
            return response(404, { ok: false, error: 'Ticket not found' });
          }
          return response(200, { ok: true, ticket });
        }

        const tickets = await readAllTickets(activeStorage);
        return response(200, { ok: true, tickets });
      });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (error) {
      return response(400, { ok: false, error: 'Invalid JSON body' });
    }

    if (event.httpMethod === 'POST') {
      return await runWithStorageFallback(storage, async activeStorage => {
        const ticket = normalizeTicket(payload.ticket || payload);
        const savedTicket = await writeTicket(activeStorage, ticket);
        return response(200, { ok: true, ticket: savedTicket });
      });
    }

    if (event.httpMethod === 'PATCH') {
      return await runWithStorageFallback(storage, async activeStorage => {
        const ticketId = String(payload.ticketId || payload.ticket?.ticketId || '').trim();
        if (!ticketId) {
          return response(400, { ok: false, error: 'Missing ticketId' });
        }

        const patch = payload.patch || payload.ticket || {};
        const savedTicket = await patchExistingTicket(activeStorage, ticketId, patch);
        if (!savedTicket) {
          return response(404, { ok: false, error: 'Ticket not found' });
        }

        return response(200, { ok: true, ticket: savedTicket });
      });
    }

    if (event.httpMethod === 'PUT') {
      return await runWithStorageFallback(storage, async activeStorage => {
        const ticketsPayload = Array.isArray(payload.tickets) ? payload.tickets : [];
        const savedTickets = await replaceAllTickets(activeStorage, ticketsPayload);
        return response(200, { ok: true, tickets: savedTickets });
      });
    }

    return response(405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('workflow-tickets failed', error);
    return response(500, {
      ok: false,
      error: error.message || 'Failed to process workflow tickets'
    });
  }
};

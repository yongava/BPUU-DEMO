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

function hydrateTicket(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    ticketId: row.ticket_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function hydrateTickets(rows) {
  return (Array.isArray(rows) ? rows : []).map(hydrateTicket).sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.updated_at || 0).getTime();
    const rightTime = new Date(right.updatedAt || right.updated_at || 0).getTime();
    return leftTime - rightTime;
  });
}

function getDatabaseConfig() {
  const connectionString = String(
    process.env.SUPABASE_DATABASE_URL
    || process.env.SUPABASE_DB_URL
    || process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || ''
  ).trim();

  if (connectionString) {
    return {
      connectionString,
      ssl: { rejectUnauthorized: false },
      allowExitOnIdle: true,
      max: 1
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
    max: 1
  };
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

async function replaceAllTickets(client, tickets) {
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

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: jsonHeaders, body: '' };
  }

  try {
    if (event.httpMethod === 'GET') {
      return await withClient(async client => {
        const ticketId = String(event.queryStringParameters?.ticketId || event.queryStringParameters?.ticket || '').trim();

        if (ticketId) {
          const { rows } = await client.query(
            `
              select ticket_id, payload, created_at, updated_at
              from public.workflow_tickets
              where ticket_id = $1
              limit 1
            `,
            [ticketId]
          );

          if (!rows.length) {
            return response(404, { ok: false, error: 'Ticket not found' });
          }

          return response(200, { ok: true, ticket: hydrateTicket(rows[0]) });
        }

        const { rows } = await client.query(
          `
            select ticket_id, payload, created_at, updated_at
            from public.workflow_tickets
            order by updated_at desc, ticket_id desc
          `
        );

        return response(200, {
          ok: true,
          tickets: hydrateTickets(rows)
        });
      });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (error) {
      return response(400, { ok: false, error: 'Invalid JSON body' });
    }

    if (event.httpMethod === 'POST') {
      return await withClient(async client => {
        const ticket = normalizeTicket(payload.ticket || payload);
        const savedTicket = await saveTicket(client, ticket);
        return response(200, { ok: true, ticket: savedTicket });
      });
    }

    if (event.httpMethod === 'PATCH') {
      return await withClient(async client => {
        const ticketId = String(payload.ticketId || payload.ticket?.ticketId || '').trim();
        if (!ticketId) {
          return response(400, { ok: false, error: 'Missing ticketId' });
        }

        const { rows } = await client.query(
          `
            select ticket_id, payload, created_at, updated_at
            from public.workflow_tickets
            where ticket_id = $1
            limit 1
          `,
          [ticketId]
        );

        if (!rows.length) {
          return response(404, { ok: false, error: 'Ticket not found' });
        }

        const existing = hydrateTicket(rows[0]);
        const patch = payload.patch || payload.ticket || {};
        const savedTicket = await saveTicket(client, {
          ...existing,
          ...patch,
          ticketId
        });

        return response(200, { ok: true, ticket: savedTicket });
      });
    }

    if (event.httpMethod === 'PUT') {
      return await withClient(async client => {
        const ticketsPayload = Array.isArray(payload.tickets) ? payload.tickets : [];
        const savedTickets = await replaceAllTickets(client, ticketsPayload);
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

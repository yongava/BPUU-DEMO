# Production deployment notes

`/api/workflow-tickets` supports two storage modes:

1. Postgres connection string mode
   - Set one of:
     - `SUPABASE_DATABASE_URL`
     - `SUPABASE_DB_URL`
     - `SUPABASE_POSTGRES_URL`
     - `DATABASE_URL`
     - `POSTGRES_URL`
     - `PG_CONNECTION_STRING`

2. Supabase REST mode
   - Set:
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
   - Optional:
     - `WORKFLOW_TICKETS_TABLE` default is `workflow_tickets`

The function will prefer Postgres when a valid connection string exists and automatically fall back to Supabase REST if Postgres is unavailable but REST config is present.

Other deployment settings:

- `NODE_VERSION=20`
- Optional timeout tuning:
  - `PG_CONNECT_TIMEOUT_MS` default `5000`
  - `SUPABASE_REST_TIMEOUT_MS` default `10000`
- Netlify function directory: `netlify/functions`
- Redirects: `/api/* -> /.netlify/functions/:splat`

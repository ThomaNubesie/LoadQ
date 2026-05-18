# queue-close-watchdog

Enforces the LoadQ loading rules server-side:

- **2-hour cap** per driver in `loading` state → move to back of queue.
- **11:59 PM EOD close** in the **zone's local timezone** → remove from queue.
- After freeing a zone's loading slot (while its window is still open),
  promote the front-most `waiting` driver in that zone to `loading`.

Zone metadata (including IANA timezone) is read from `public.zones` at every
invocation. **Add new zones via a migration**, never by editing this function.
See `../../migrations/*_zones_table.sql`.

## Setup (one-time)

1. **Run the zones migration** in Supabase SQL Editor (or via `supabase db push`):

   ```bash
   # Either: copy/paste supabase/migrations/*_zones_table.sql into Supabase SQL Editor
   # Or:
   supabase db push   # if you've linked the project
   ```

2. **Deploy the function:**

   ```bash
   supabase login                                  # one-time
   supabase link --project-ref <PROJECT_REF>       # one-time
   supabase functions deploy queue-close-watchdog --no-verify-jwt
   ```

Re-run step 2 whenever you edit `index.ts`.

Use `--no-verify-jwt` because pg_cron will call this without a user JWT.
Authorization is done via the function's own service-role key.

## Schedule (every minute via pg_cron)

In **Supabase Dashboard → SQL Editor**:

```sql
-- Enable extensions
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> below
select cron.schedule(
  'queue-close-watchdog',
  '* * * * *',  -- every minute
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.functions.supabase.co/queue-close-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    )
  ) as request_id;
  $$
);

-- To stop the job later:
-- select cron.unschedule('queue-close-watchdog');
```

## Verify

Inspect cron history:

```sql
select * from cron.job_run_details
where jobname = 'queue-close-watchdog'
order by start_time desc limit 10;
```

Manual test (any time):

```bash
curl -X POST \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  https://<PROJECT_REF>.functions.supabase.co/queue-close-watchdog
```

Response is JSON like:

```json
{ "now": "...", "moved": ["<entry_id>"], "removed": [], "promoted": ["<entry_id>"] }
```

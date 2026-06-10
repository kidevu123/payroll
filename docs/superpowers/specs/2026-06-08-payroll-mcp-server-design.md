# Payroll MCP Server — Design

## Goal

Expose Milo payroll operations to AI agents (Cursor, Claude Desktop, remote automations) with **full read/write** access, reusing existing `lib/db/queries/*` and pg-boss job enqueue — not Next.js server actions.

## Transports

| Mode | Use case | Entry |
|------|----------|-------|
| **stdio** | Local Cursor / Claude Desktop | `npm run mcp:stdio` |
| **HTTP** | LXC or remote agents | `npm run mcp:http` → `POST /mcp` (streamable HTTP, port 3100 default) |

## Auth

- `MCP_SERVICE_TOKEN` — required for HTTP (`Authorization: Bearer …`); recommended for stdio env
- `MCP_ACTOR_EMAIL` or `MCP_ACTOR_USER_ID` — maps mutations to a real user for audit logs (defaults to `OWNER_EMAIL`)
- `DATABASE_URL` — same Postgres as the app
- Never expose NGTeco vault credentials via read tools

## Architecture

```
mcp-server/src/
  index.ts          CLI (--stdio | --http)
  env.ts            dotenv + validation
  actor.ts          resolve MCP actor
  create-server.ts  McpServer factory + tool registration
  http.ts           Express + Bearer auth
  tools/            domain tools (employees, punches, periods, ngteco, hall-monitor)
  util.ts           JSON serialization helpers
```

Tools call `lib/` directly. Job triggers use `getBoss()` like `pollNowAction`.

## Tool tiers

### Read (readOnlyHint: true)

- `payroll_list_employees`, `payroll_get_employee`
- `payroll_list_periods`, `payroll_get_period`
- `payroll_list_punches`
- `payroll_list_runs`, `payroll_get_run`, `payroll_list_run_exceptions`
- `payroll_list_payslips`
- `payroll_poll_status`
- `payroll_run_hall_monitor`

### Write (destructiveHint where applicable)

- `payroll_poll_now`, `payroll_poll_backfill`
- `payroll_lock_period`, `payroll_unlock_period`
- `payroll_create_punch`, `payroll_edit_punch`, `payroll_void_punch`

## Deployment notes

- **Local**: tunnel `DATABASE_URL` to LXC Postgres or run against a dev DB
- **LXC**: optional second compose service on port 3100, same network as `db`
- Poll singleton: check `getInProgressPoll()` before enqueue (same as UI)

## Out of scope (v1)

- Employee CRUD, payroll run publish pipeline, settings writes
- MCP resources/prompts (tools only for v1)

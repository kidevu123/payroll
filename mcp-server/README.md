# Payroll MCP Server

MCP server for the Milo payroll app. Gives AI agents read/write access to employees, punches, pay periods, NGTeco polls, and hall-monitor audits.

## Setup

```bash
cd mcp-server
npm install
```

Add to the repo root `.env`:

```env
MCP_SERVICE_TOKEN=your-long-random-secret
MCP_ACTOR_EMAIL=owner@yourcompany.com   # audit attribution
# DATABASE_URL=...                      # already required by the app
```

## Run

**stdio** (Cursor / Claude Desktop):

```bash
npm run start:stdio
```

**HTTP** (remote agents, default `127.0.0.1:3100`):

```bash
npm run start:http
```

```bash
curl -H "Authorization: Bearer $MCP_SERVICE_TOKEN" \
  http://127.0.0.1:3100/health
```

## Cursor config

Add to `.cursor/mcp.json` (or global MCP settings):

```json
{
  "mcpServers": {
    "payroll": {
      "command": "npm",
      "args": ["run", "start:stdio"],
      "cwd": "/absolute/path/to/payroll-git/mcp-server",
      "env": {
        "DATABASE_URL": "postgresql://...",
        "MCP_SERVICE_TOKEN": "...",
        "MCP_ACTOR_EMAIL": "owner@example.com"
      }
    }
  }
}
```

For production DB access from your Mac, tunnel Postgres from the LXC or point `DATABASE_URL` at a read replica.

## Tools

| Tool | Type |
|------|------|
| `payroll_list_employees` | read |
| `payroll_get_employee` | read |
| `payroll_list_periods` | read |
| `payroll_get_period` | read |
| `payroll_list_punches` | read |
| `payroll_list_runs` | read |
| `payroll_get_run` | read |
| `payroll_list_run_exceptions` | read |
| `payroll_list_payslips` | read |
| `payroll_poll_status` | read |
| `payroll_run_hall_monitor` | read |
| `payroll_poll_now` | write |
| `payroll_poll_backfill` | write |
| `payroll_lock_period` | write |
| `payroll_unlock_period` | write |
| `payroll_create_punch` | write |
| `payroll_edit_punch` | write |
| `payroll_void_punch` | write |

Design: `docs/superpowers/specs/2026-06-08-payroll-mcp-server-design.md`

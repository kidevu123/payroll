# Payroll MCP Server

MCP server for the Milo payroll app. Gives AI agents read/write access to employees, punches, pay periods, payroll runs, payslips, period documents and NGTeco polls.

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

27 tools. Each tool declares in code whether it is read-only; the Type column below is a summary.

| Tool | Type |
|------|------|
| `payroll_list_employees` | read |
| `payroll_get_employee` | read |
| `payroll_list_employee_payslips` | read |
| `payroll_list_employee_documents` | read |
| `payroll_list_periods` | read |
| `payroll_get_period` | read |
| `payroll_list_punches` | read |
| `payroll_list_runs` | read |
| `payroll_get_run` | read |
| `payroll_list_run_exceptions` | read |
| `payroll_list_payslips` | read |
| `payroll_poll_status` | read |
| `payroll_get_period_bank_cash_list` | read |
| `payroll_download_period_signature` | read |
| `payroll_download_period_cut_sheet` | read |
| `payroll_poll_now` | write |
| `payroll_poll_backfill` | write |
| `payroll_lock_period` | write |
| `payroll_unlock_period` | write |
| `payroll_mark_paid` | write |
| `payroll_unmark_paid` | write |
| `payroll_create_punch` | write |
| `payroll_edit_punch` | write |
| `payroll_void_punch` | write |
| `payroll_upload_period_paystub` | write |
| `payroll_upload_salaried_paystub` | write |
| `payroll_delete_period_document` | write |

The employee tools return whole employee rows, including phone, email and Zelle contact.

Design: `docs/superpowers/specs/2026-06-08-payroll-mcp-server-design.md`

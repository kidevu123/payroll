# Payroll MCP — Ready to use

## Production (HTTP)

After deploy, the MCP server listens on **port 3100**:

| Check | Command |
|-------|---------|
| Health | `curl http://YOUR_HOST:3100/health` |
| MCP endpoint | `POST http://YOUR_HOST:3100/mcp` with `Authorization: Bearer <token>` |

## Cursor setup

1. Copy `deploy/mcp/cursor-mcp.json` into your Cursor MCP config.
2. Replace `REPLACE_HOST` with your payroll host (e.g. `192.168.1.197` on LAN, or tunnel).
3. Replace `REPLACE_MCP_SERVICE_TOKEN` with the value from the server `.env`.

**macOS Cursor config path:** `~/.cursor/mcp.json`  
Or project-level: `.cursor/mcp.json` in this repo.

```json
{
  "mcpServers": {
    "payroll": {
      "url": "http://192.168.1.197:3100/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

Restart Cursor after saving.

## Claude Desktop (stdio, local)

If you run against a tunneled DB from your Mac:

```json
{
  "mcpServers": {
    "payroll": {
      "command": "npm",
      "args": ["run", "mcp:stdio"],
      "cwd": "/path/to/payroll-git",
      "env": {
        "DATABASE_URL": "postgresql://...",
        "MCP_SERVICE_TOKEN": "...",
        "MCP_ACTOR_EMAIL": "owner@example.com"
      }
    }
  }
}
```

## Tools available

17 tools — employees, periods, punches, payroll runs, NGTeco poll/backfill, hall-monitor audit, lock/unlock period, create/edit/void punch.

See `mcp-server/README.md` for the full list.

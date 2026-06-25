# Payroll MCP — Production (deployed)

| Item | Value |
|------|-------|
| Health | `http://192.168.1.197:3100/health` |
| MCP endpoint | `http://192.168.1.197:3100/mcp` |
| Cursor config | `~/.cursor/mcp.json` (payroll entry added) |
| Actor email | `nabeelvira@gmail.com` |
| Token | In `/opt/payroll/.env` as `MCP_SERVICE_TOKEN` |

**Restart Cursor** to load the payroll MCP server.

## Quick test

```bash
curl http://192.168.1.197:3100/health
```

## Example prompts in Cursor

- "Run payroll hall monitor audit and summarize failures"
- "What's the NGTeco poll status?"
- "List open pay periods and punches for this week"

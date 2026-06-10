#!/usr/bin/env bash
# Idempotently add MCP_SERVICE_TOKEN to .env on the payroll host.
set -euo pipefail

ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

if grep -q '^MCP_SERVICE_TOKEN=.\+' "$ENV_FILE" 2>/dev/null; then
  echo "MCP_SERVICE_TOKEN already set in $ENV_FILE"
  exit 0
fi

token="$(openssl rand -base64 48 | tr -d '\n')"
printf '\n# Payroll MCP server (AI agents)\nMCP_SERVICE_TOKEN=%s\n' "$token" >> "$ENV_FILE"
echo "Added MCP_SERVICE_TOKEN to $ENV_FILE"

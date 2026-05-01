#!/usr/bin/env bash
# Page-load smoke test. Pass the base URL (e.g. http://localhost:3000 or
# https://digitz.duckdns.org) as the first argument. Exits 0 if every
# required path returns 200 AND the body has no error sentinel; 1 otherwise.
#
# Health 200 alone is insufficient — /api/health only checks DB + pg-boss
# reachability, not page-render failures. Use this script after every
# deploy, alongside curl /api/health.

set -uo pipefail

BASE="${1:-http://localhost:3000}"
PATHS=(
  "/login"
  "/setup"
  "/dashboard"
  "/employees"
  "/payroll"
  "/reports"
  "/audit"
  "/me/home"
  "/me/pay"
  "/me/profile"
)
ERROR_PATTERNS='Application error|server-side exception|next-intl config'

fail=0
echo "Smoke test against ${BASE}"
echo "--"

# /api/health first.
hc=$(curl -s -o /tmp/smoke-health -w '%{http_code}' --max-time 10 "${BASE}/api/health" || echo 000)
if [[ "${hc}" != "200" ]]; then
  echo "FAIL  /api/health  http=${hc}"
  fail=1
else
  echo "OK    /api/health  http=${hc}"
fi

# Page-load checks. We follow redirects but record the final code; an
# unauth user gets bounced to /login (200) which is fine for the auth-only
# paths. The error-sentinel grep is what catches a server-rendered crash.
for p in "${PATHS[@]}"; do
  body_file=$(mktemp)
  code=$(curl -sL --max-time 10 -o "${body_file}" -w '%{http_code}' "${BASE}${p}" || echo 000)
  if [[ "${code}" != "200" ]]; then
    echo "FAIL  ${p}  http=${code}"
    fail=1
    rm -f "${body_file}"
    continue
  fi
  if grep -qE "${ERROR_PATTERNS}" "${body_file}"; then
    matched=$(grep -oE "${ERROR_PATTERNS}" "${body_file}" | head -1)
    echo "FAIL  ${p}  http=${code}  body matched: ${matched}"
    fail=1
  else
    echo "OK    ${p}  http=${code}"
  fi
  rm -f "${body_file}"
done

echo "--"
if [[ "${fail}" -eq 0 ]]; then
  echo "PASS  all checks green"
  exit 0
fi
echo "FAIL  one or more checks regressed"
exit 1

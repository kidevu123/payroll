#!/usr/bin/env bash
# Page-load smoke test. Two modes:
#
#   bash scripts/smoke.sh <BASE>
#     Anonymous-only: hits public + protected paths without auth. Protected
#     paths redirect to /login (200). Catches render errors that fire even
#     before middleware (e.g. layout-level crashes, next-intl config).
#
#   bash scripts/smoke.sh <BASE> <EMAIL> <PASSWORD>
#     Authenticated: signs in via Auth.js credentials, then loads the same
#     paths with the session cookie. Catches render errors on authed routes
#     (e.g. dashboard's getSetting('company') Zod throw).
#
# Health 200 alone is insufficient — /api/health checks DB + pg-boss
# reachability, not page-render failures.

set -uo pipefail

BASE="${1:-http://localhost:3000}"
EMAIL="${2:-}"
PASSWORD="${3:-}"

PUBLIC_PATHS=(
  "/login"
  "/setup"
)
AUTHED_PATHS=(
  "/"
  "/dashboard"
  "/employees"
  "/payroll"
  "/reports"
  "/run-payroll"
  "/run-payroll/upload"
  "/audit"
  "/settings/company"
  "/settings/branding"
  "/settings/pay-schedules"
  "/settings/zoho"
  "/settings/holidays"
  "/settings/automation"
  "/settings/notifications"
  "/me/home"
  "/me/pay"
  "/me/profile"
)
ERROR_PATTERNS='Application error|server-side exception|next-intl config|Internal Server Error|invalid_type|Lands in Phase|Phase 5'

cookie_jar="$(mktemp)"
trap 'rm -f "${cookie_jar}"' EXIT

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

probe() {
  local p="$1"
  local label="$2"
  body_file=$(mktemp)
  code=$(curl -sL -k --max-time 10 -b "${cookie_jar}" -c "${cookie_jar}" \
    -o "${body_file}" -w '%{http_code}' "${BASE}${p}" || echo 000)
  if [[ "${code}" != "200" ]]; then
    echo "FAIL  ${label}${p}  http=${code}"
    fail=1
    rm -f "${body_file}"
    return
  fi
  if grep -qE "${ERROR_PATTERNS}" "${body_file}"; then
    matched=$(grep -oE "${ERROR_PATTERNS}" "${body_file}" | head -1)
    echo "FAIL  ${label}${p}  http=${code}  body matched: ${matched}"
    fail=1
  else
    echo "OK    ${label}${p}  http=${code}"
  fi
  rm -f "${body_file}"
}

# Public paths (no session yet).
for p in "${PUBLIC_PATHS[@]}"; do
  probe "${p}" "anon "
done

# Authed paths anonymously — they should redirect to /login (final 200) with
# no error sentinels. This catches early-render crashes.
for p in "${AUTHED_PATHS[@]}"; do
  probe "${p}" "anon "
done

# Optional: sign in and re-test the authed paths with a session.
if [[ -n "${EMAIL}" && -n "${PASSWORD}" ]]; then
  echo "--"
  echo "signing in as ${EMAIL}…"
  # Auth.js credentials sign-in: 1) fetch CSRF, 2) POST credentials.
  csrf_json=$(curl -s -k -b "${cookie_jar}" -c "${cookie_jar}" "${BASE}/api/auth/csrf" || echo "{}")
  csrf=$(printf '%s' "${csrf_json}" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')
  if [[ -z "${csrf}" ]]; then
    echo "FAIL  could not fetch csrf token"
    exit 1
  fi
  signin_code=$(curl -s -k -L -o /dev/null -w '%{http_code}' \
    -b "${cookie_jar}" -c "${cookie_jar}" \
    -X POST "${BASE}/api/auth/callback/credentials" \
    -d "csrfToken=${csrf}" \
    -d "email=${EMAIL}" \
    -d "password=${PASSWORD}" \
    -d "callbackUrl=${BASE}/" \
    --header "Content-Type: application/x-www-form-urlencoded")
  # Verify a session cookie landed.
  if ! grep -q -E "(authjs|next-auth)\.session-token" "${cookie_jar}"; then
    echo "FAIL  sign-in did not produce a session cookie (http=${signin_code})"
    fail=1
  else
    echo "OK    sign-in cookie present (http=${signin_code})"
    for p in "${AUTHED_PATHS[@]}"; do
      probe "${p}" "auth "
    done
  fi
fi

echo "--"
if [[ "${fail}" -eq 0 ]]; then
  echo "PASS  all checks green"
  exit 0
fi
echo "FAIL  one or more checks regressed"
exit 1

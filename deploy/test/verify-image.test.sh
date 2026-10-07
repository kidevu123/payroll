#!/usr/bin/env bash
# Tests for deploy/verify-image.sh. Run: bash deploy/test/verify-image.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
SCRIPT="$HERE/../verify-image.sh"
fail=0; pass() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; fail=1; }
T=$(mktemp -d); mkdir -p "$T/bin"; ln -s "$HERE/docker-shim.sh" "$T/bin/docker"; export SHIM_LOG="$T/calls.log"

# 1. size: an image Docker LOADED (not built) reports content size in inspect;
#    the check must use the real disk figure and fail a 2.21 GB image at 1600.
out=$(cd "$T" && PATH="$T/bin:$PATH" SHIM_SIZE_INSPECT=475000000 SHIM_SIZE_LS=2.21GB bash "$SCRIPT" 1600 size 2>&1)
echo "$out" | grep -q "^FAIL  size" && pass "size uses the real image size, not content size" || bad "size uses the real image size, not content size ($out)"
out=$(cd "$T" && PATH="$T/bin:$PATH" SHIM_SIZE_INSPECT=475000000 SHIM_SIZE_LS=2.21GB bash "$SCRIPT" 2300 size 2>&1)
echo "$out" | grep -q "^PASS  size" && pass "size passes under the limit" || bad "size passes under the limit ($out)"

# 2. reaper: the check must kill only the browser it launched. A decoy process
#    whose command line also contains "chrome-headless" must survive.
( exec -a chrome-headless-decoy sleep 120 ) & DECOY=$!
sleep 0.5
out=$(cd "$ROOT" && VERIFY_LOCAL=1 bash "$SCRIPT" 9999 reaper 2>&1)
if kill -0 "$DECOY" 2>/dev/null; then pass "reaper check leaves other headless browsers alone"; else bad "reaper check leaves other headless browsers alone (decoy was killed)"; fi
echo "$out" | grep -q "^PASS  reaper" && pass "reaper check passes locally" || bad "reaper check passes locally ($out)"
kill -9 "$DECOY" 2>/dev/null; wait "$DECOY" 2>/dev/null

echo "--"; [ "$fail" = 0 ] && echo "ALL VERIFY-IMAGE TESTS PASSED" || echo "SOME VERIFY-IMAGE TESTS FAILED"; exit $fail

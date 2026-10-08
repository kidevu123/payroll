#!/usr/bin/env bash
# The golden harness must refuse to run when :3111 is already taken: otherwise
# its own server fails to bind, the health probe is answered by the squatter,
# and the comparison runs against code that is not the current build.
# Run: bash scripts/golden/test/port-in-use.test.sh
set -u
cd "$(dirname "$0")/../../.."
node -e 'require("http").createServer((q,s)=>{s.setHeader("content-type","application/json");s.end("{\"status\":\"ok\"}")}).listen(3111,()=>console.log("squatter up"))' &
SQUAT=$!
sleep 1
out=$(node scripts/golden/run.mjs check 2>&1); rc=$?
kill "$SQUAT" 2>/dev/null; wait "$SQUAT" 2>/dev/null
if [ "$rc" -eq 2 ] && echo "$out" | grep -q "port 3111 is already in use"; then
  echo "PASS  refuses to run when the port is taken"; exit 0
fi
echo "FAIL  refuses to run when the port is taken (exit $rc)"; echo "$out" | tail -3; exit 1

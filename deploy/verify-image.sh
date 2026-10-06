#!/usr/bin/env bash
# In-container checks for the payroll image. Run from the compose project
# directory on a host where `docker compose up -d db app mcp` has finished.
#
#   bash deploy/verify-image.sh [max-size-mb]
#
# Every check exercises something the container must do at runtime that the
# Next.js build cannot prove: packages resolved outside the bundle, system
# binaries the app shells out to, and the headless browser. Health 200 alone
# does not cover any of these.
set -uo pipefail

MAX_MB="${1:-1600}"
fail=0
pass() { echo "PASS  $1${2:+  $2}"; }
bad()  { echo "FAIL  $1${2:+  $2}"; fail=1; }
in_app() { docker compose exec -T app "$@"; }

# size ------------------------------------------------------------------
bytes=$(docker image inspect payroll-app:latest --format '{{.Size}}' 2>/dev/null || echo 0)
mb=$((bytes / 1000000))
if [ "$mb" -gt 0 ] && [ "$mb" -le "$MAX_MB" ]; then pass size "${mb} MB (limit ${MAX_MB})"; else bad size "${mb} MB (limit ${MAX_MB})"; fi

# node-version ----------------------------------------------------------
nv=$(in_app node -p 'process.versions.node.split(".")[0]' 2>/dev/null | tr -d '[:space:]')
[ "$nv" = "24" ] && pass node-version "v$nv" || bad node-version "got '${nv}', want 24"

# health ----------------------------------------------------------------
h=$(in_app node -e 'fetch("http://localhost:3000/api/health").then(r=>r.text()).then(t=>console.log(t)).catch(e=>console.log("ERR "+e.message))' 2>/dev/null)
echo "$h" | grep -q '"app":"ok"' && echo "$h" | grep -q '"db":"ok"' && echo "$h" | grep -q '"boss":"ok"' \
  && pass health || bad health "$h"

# runtime-modules: everything loaded outside the webpack bundle ----------
mods='["@react-pdf/renderer","sharp","web-push","pg-boss","postgres","@node-rs/argon2","playwright","drizzle-orm","zod","dotenv","express","@modelcontextprotocol/sdk/server/mcp.js","@modelcontextprotocol/sdk/server/streamableHttp.js","@opentelemetry/sdk-node","@opentelemetry/resources","@opentelemetry/exporter-prometheus","@opentelemetry/exporter-trace-otlp-http","@opentelemetry/instrumentation-http","@opentelemetry/instrumentation-pg"]'
out=$(in_app node -e "(async()=>{const bad=[];for(const m of ${mods}){try{await import(m)}catch(e){bad.push(m+': '+String(e.message).split('\n')[0])}}console.log(bad.length?bad.join(' | '):'OK')})()" 2>&1)
[ "$out" = "OK" ] && pass runtime-modules || bad runtime-modules "$out"

# runtime-files: paths the code reads by name ----------------------------
out=$(in_app sh -c 'for f in .next/pdf/payslip.js .next/pdf/signature-report.js .next/pdf/admin-report.js .next/pdf/employee-guide.js .next/pdf/payslip-cut-sheet.js .next/pdf/payslip-batch-sheet.js lib/ngteco/selectors.json lib/payroll/pdf-rebuild-seed.json mcp-server/run.cjs node_modules/tsx/dist/cli.mjs scripts/migrate.ts scripts/seed.ts drizzle/meta/_journal.json .git-sha server.js; do [ -e "/app/$f" ] || echo "missing:$f"; done' 2>&1)
[ -z "$out" ] && pass runtime-files || bad runtime-files "$(echo "$out" | tr '\n' ' ')"

# sharp: actually encode a PNG (libvips binary for this platform) --------
out=$(in_app node -e 'require("sharp")({create:{width:8,height:8,channels:4,background:"#067049"}}).png().toBuffer().then(b=>console.log(b.subarray(1,4).toString()+" "+b.length)).catch(e=>console.log("ERR "+e.message))' 2>&1)
echo "$out" | grep -q '^PNG ' && pass sharp "$out" || bad sharp "$out"

# chromium: launch the headless shell the scraper uses, render a page ----
out=$(in_app node -e '(async()=>{const {chromium}=require("playwright");const ctx=await chromium.launchPersistentContext("/tmp/verify-profile",{headless:true,viewport:{width:1280,height:900},locale:"en-US"});const p=await ctx.newPage();await p.setContent("<title>verify</title><h1>ok</h1>");const t=await p.title();const png=await p.screenshot();await ctx.close();console.log(t+" "+png.length)})().catch(e=>console.log("ERR "+String(e.message).split("\n")[0]))' 2>&1)
echo "$out" | grep -q '^verify [0-9]' && pass chromium "$out" || bad chromium "$out"

# reaper: an orphaned browser is found by pgrep and removed by pkill -----
out=$(in_app sh -c '
  node -e "(async()=>{const {chromium}=require(\"playwright\");await chromium.launchPersistentContext(\"/tmp/verify-orphan\",{headless:true});setTimeout(()=>{},60000)})()" >/dev/null 2>&1 &
  i=0; while [ $i -lt 20 ]; do n=$(pgrep -f chrome-headless | wc -l); [ "$n" -gt 0 ] && break; i=$((i+1)); sleep 1; done
  before=$(pgrep -f chrome-headless | wc -l)
  pkill -9 -f chrome-headless; sleep 1
  after=$(pgrep -f chrome-headless | wc -l)
  pkill -9 -f verify-orphan >/dev/null 2>&1
  echo "before=$before after=$after"' 2>&1)
case "$out" in
  *"before=0"*|*"not found"*) bad reaper "$out" ;;
  *"after=0"*) pass reaper "$out" ;;
  *) bad reaper "$out" ;;
esac

# tsx-script: the runbook's way of running a repair script ---------------
out=$(in_app node ./node_modules/tsx/dist/cli.mjs scripts/repair-duplicate-punches.ts --dry-run 2>&1 | tail -3)
rc=${PIPESTATUS[0]}
[ "$rc" = "0" ] && pass tsx-script || bad tsx-script "exit $rc: $(echo "$out" | tr '\n' ' ')"

# mcp --------------------------------------------------------------------
st=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q mcp)" 2>/dev/null)
[ "$st" = "healthy" ] && pass mcp || bad mcp "health=${st:-none}"

# metrics: the Prometheus exporter (OpenTelemetry) is listening ----------
out=$(in_app node -e 'fetch("http://localhost:9464/metrics").then(r=>r.text()).then(t=>console.log(t.includes("# HELP")?"OK":"NOHELP")).catch(e=>console.log("ERR "+e.message))' 2>&1)
[ "$out" = "OK" ] && pass metrics || bad metrics "$out"

# logs: nothing failed to resolve since start ----------------------------
out=$(docker compose logs app mcp 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|Cannot find module|Executable doesn't exist|error while loading shared libraries" | head -3)
[ -z "$out" ] && pass logs || bad logs "$out"

echo "--"
[ "$fail" = "0" ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit "$fail"

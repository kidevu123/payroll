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
# Optional second arg: comma-separated check names to run (default: all).
ONLY="${2:-}"
want() { [ -z "$ONLY" ] || [[ ",$ONLY," == *",$1,"* ]]; }
fail=0
pass() { echo "PASS  $1${2:+  $2}"; }
bad()  { echo "FAIL  $1${2:+  $2}"; fail=1; }
# Plain `docker exec` against the resolved container, not `docker compose
# exec`: compose prints its own warnings (an unset variable in the compose
# file, for one) on stderr, and they would land in the captured output.
# VERIFY_LOCAL=1 runs the in-container commands on this machine instead
# (used by deploy/test/verify-image.test.sh; never on a real host).
if [ "${VERIFY_LOCAL:-0}" = 1 ]; then
  in_app() { "$@"; }
else
  APP=$(docker compose ps -q app 2>/dev/null)
  [ -n "$APP" ] || { echo "FAIL  no running app container (run from the compose directory)"; exit 1; }
  in_app() { docker exec "$APP" "$@"; }
fi

if want size; then
# size ------------------------------------------------------------------
# `docker image ls` prints the on-disk size ("2.21GB"). `image inspect`'s
# .Size is NOT that: for an image that was `docker load`ed rather than built
# it reports the compressed content size (475 MB for a 2.21 GB image), so a
# check based on it passed without measuring anything.
human=$(docker image ls payroll-app:latest --format '{{.Size}}' 2>/dev/null | head -1)
mb=$(echo "$human" | awk '{ v=$0; sub(/[A-Za-z]+$/,"",v); u=toupper($0); sub(/^[0-9.]+/,"",u);
  if (u=="GB") printf "%d", v*1000; else if (u=="MB") printf "%d", v; else if (u=="KB") printf "%d", v/1000; else printf "%d", v/1000000 }')
mb=${mb:-0}
if [ "$mb" -gt 0 ] && [ "$mb" -le "$MAX_MB" ]; then pass size "${mb} MB (limit ${MAX_MB})"; else bad size "${mb} MB (limit ${MAX_MB})"; fi
fi

if want node-version; then
# node-version ----------------------------------------------------------
nv=$(in_app node -p 'process.versions.node.split(".")[0]' 2>/dev/null | tr -d '[:space:]')
[ "$nv" = "24" ] && pass node-version "v$nv" || bad node-version "got '${nv}', want 24"
fi

if want health; then
# health ----------------------------------------------------------------
h=$(in_app node -e 'fetch("http://localhost:3000/api/health").then(r=>r.text()).then(t=>console.log(t)).catch(e=>console.log("ERR "+e.message))' 2>/dev/null)
echo "$h" | grep -q '"app":"ok"' && echo "$h" | grep -q '"db":"ok"' && echo "$h" | grep -q '"boss":"ok"' \
  && pass health || bad health "$h"
fi

if want runtime-modules; then
# runtime-modules: everything loaded outside the webpack bundle ----------
mods='["@react-pdf/renderer","sharp","web-push","pg-boss","postgres","@node-rs/argon2","playwright","drizzle-orm","zod","dotenv","express","@modelcontextprotocol/sdk/server/mcp.js","@modelcontextprotocol/sdk/server/streamableHttp.js","@opentelemetry/sdk-node","@opentelemetry/resources","@opentelemetry/exporter-prometheus","@opentelemetry/exporter-trace-otlp-http","@opentelemetry/instrumentation-http","@opentelemetry/instrumentation-pg"]'
out=$(in_app node -e "(async()=>{const bad=[];for(const m of ${mods}){try{await import(m)}catch(e){bad.push(m+': '+String(e.message).split('\n')[0])}}console.log(bad.length?bad.join(' | '):'OK')})()" 2>&1)
[ "$out" = "OK" ] && pass runtime-modules || bad runtime-modules "$out"
fi

if want runtime-files; then
# runtime-files: paths the code reads by name ----------------------------
out=$(in_app sh -c 'for f in .next/pdf/payslip.js .next/pdf/signature-report.js .next/pdf/admin-report.js .next/pdf/employee-guide.js .next/pdf/payslip-cut-sheet.js .next/pdf/payslip-batch-sheet.js lib/ngteco/selectors.json lib/payroll/pdf-rebuild-seed.json mcp-server/run.cjs node_modules/tsx/dist/cli.mjs scripts/migrate.ts scripts/seed.ts drizzle/meta/_journal.json .git-sha server.js; do [ -e "/app/$f" ] || echo "missing:$f"; done' 2>&1)
[ -z "$out" ] && pass runtime-files || bad runtime-files "$(echo "$out" | tr '\n' ' ')"
fi

if want sharp; then
# sharp: actually encode a PNG (libvips binary for this platform) --------
out=$(in_app node -e 'require("sharp")({create:{width:8,height:8,channels:4,background:"#067049"}}).png().toBuffer().then(b=>console.log(b.subarray(1,4).toString()+" "+b.length)).catch(e=>console.log("ERR "+e.message))' 2>&1)
echo "$out" | grep -q '^PNG ' && pass sharp "$out" || bad sharp "$out"
fi

if want chromium; then
# chromium: launch the headless shell the scraper uses, render a page ----
out=$(in_app node -e '(async()=>{const {chromium}=require("playwright");const ctx=await chromium.launchPersistentContext("/tmp/verify-profile",{headless:true,viewport:{width:1280,height:900},locale:"en-US"});const p=await ctx.newPage();await p.setContent("<title>verify</title><h1>ok</h1>");const t=await p.title();const png=await p.screenshot();await ctx.close();console.log(t+" "+png.length)})().catch(e=>console.log("ERR "+String(e.message).split("\n")[0]))' 2>&1)
echo "$out" | grep -q '^verify [0-9]' && pass chromium "$out" || bad chromium "$out"
fi

if want reaper; then
# reaper: the reaper's pattern finds an orphaned browser, and pkill removes it
# The browser is launched with a unique marker in its profile path and ONLY
# that marker is killed. A plain `pkill -f chrome-headless` here would also
# kill a live NGTeco scrape if the check ran during a poll on a real host.
# The body runs under the image's /bin/sh (dash): POSIX only, no bashisms.
# `browser` lists the marker's processes that ALSO match the reaper's own
# pattern ("chrome-headless", same as lib/ngteco/chromium-reaper.ts), so a
# non-zero `before` proves that pattern matches the headless shell binary;
# the Node launcher alone never counts.
out=$(in_app sh -c '
  pat="chrome-head""less"
  marker="verify-orphan-$$-$(date +%s)"
  dir="$(mktemp -d)/$marker"
  launcher=$( (node -e "(async()=>{const {chromium}=require(\"playwright\");await chromium.launchPersistentContext(process.argv[1],{headless:true});setTimeout(()=>{},60000)})()" "$dir" >/dev/null 2>&1 & echo $!) )
  browser() { for p in $(pgrep -f "$marker"); do pgrep -f "$pat" | grep -qx "$p" && echo "$p"; done; }
  i=0; while [ $i -lt 25 ]; do [ -n "$(browser)" ] && break; i=$((i+1)); sleep 1; done
  before=$(browser | wc -l | tr -d " ")
  pkill -9 -f "$marker"; sleep 1
  after=$(browser | wc -l | tr -d " ")
  kill -9 "$launcher" >/dev/null 2>&1
  rm -rf "$(dirname "$dir")"
  echo "before=$before after=$after"' 2>&1)
case "$out" in
  *"before=0"*|*"not found"*) bad reaper "$out" ;;
  *"after=0"*) pass reaper "$out" ;;
  *) bad reaper "$out" ;;
esac
fi

if want tsx-script; then
# tsx-script: the runbook's way of running a repair script ---------------
out=$(in_app node ./node_modules/tsx/dist/cli.mjs scripts/repair-duplicate-punches.ts --dry-run 2>&1 | tail -3)
rc=${PIPESTATUS[0]}
[ "$rc" = "0" ] && pass tsx-script || bad tsx-script "exit $rc: $(echo "$out" | tr '\n' ' ')"
fi

if want mcp; then
# mcp --------------------------------------------------------------------
st=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q mcp 2>/dev/null)" 2>/dev/null)
[ "$st" = "healthy" ] && pass mcp || bad mcp "health=${st:-none}"
fi

if want metrics; then
# metrics: the Prometheus exporter (OpenTelemetry) is listening ----------
out=$(in_app node -e 'fetch("http://localhost:9464/metrics").then(r=>r.text()).then(t=>console.log(t.includes("# HELP")?"OK":"NOHELP")).catch(e=>console.log("ERR "+e.message))' 2>&1)
[ "$out" = "OK" ] && pass metrics || bad metrics "$out"
fi

if want logs; then
# logs: nothing failed to resolve since start ----------------------------
out=$(docker compose logs app mcp 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|Cannot find module|Executable doesn't exist|error while loading shared libraries" | head -3)
[ -z "$out" ] && pass logs || bad logs "$out"
fi

echo "--"
[ "$fail" = "0" ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit "$fail"

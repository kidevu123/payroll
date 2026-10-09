#!/usr/bin/env bash
# Tests for deploy/lxc/payroll-deploy.service's ExecStart body. Runs it for
# real against a throwaway git repo + bare origin, with `docker` replaced by
# deploy/test/docker-shim.sh. Run: bash deploy/test/payroll-deploy.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
UNIT="$HERE/../lxc/payroll-deploy.service"
fail=0; pass() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; fail=1; }

# Extract the bash -c '...' body: everything between ExecStart=/bin/bash -c ' and the closing fi'
BODY=$(awk "/^ExecStart=\/bin\/bash -c '/{f=1; sub(/^ExecStart=\/bin\/bash -c '/, \"\"); print; next} f{print} /fi'\$/{if(f){exit}}" "$UNIT" | sed "s/fi'\$/fi/" | sed 's/\\$//' | sed 's#/usr/bin/docker#docker#g')
[ -n "$BODY" ] || { echo "could not extract ExecStart body"; exit 1; }

setup() {
  T=$(mktemp -d); export T
  git init -q --bare "$T/origin.git"
  git clone -q "$T/origin.git" "$T/work" 2>/dev/null
  (cd "$T/work" && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m one && git push -q origin HEAD:rebuild/foundation)
  git clone -q -b rebuild/foundation "$T/origin.git" "$T/app"
  export SHIM_LOG="$T/calls.log"; : > "$SHIM_LOG"
  export PAYROLL_DIR="$T/app" PAYROLL_BRANCH=rebuild/foundation
  mkdir -p "$T/bin"; ln -s "$HERE/docker-shim.sh" "$T/bin/docker"
  # Fake `df` so the low-disk branch can be exercised: SHIM_FREE_KB is the
  # free space the unit sees (default: plenty).
  printf '%s\n' '#!/usr/bin/env bash' 'echo "Filesystem 1024-blocks Used Available Capacity Mounted on"' 'echo "/dev/fake 37000000 1 ${SHIM_FREE_KB:-20000000} 1% /"' > "$T/bin/df"; chmod +x "$T/bin/df"
}
run_unit() { (export PATH="$T/bin:$PATH"; cd "$T/app" && bash -c "$BODY" >"$T/out.log" 2>&1); echo $?; }
push_commit() { (cd "$T/work" && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m "$1" && git push -q origin HEAD:rebuild/foundation); }

# 1. On a rebuild, `previous` is the RUNNING container's image, not :latest
setup; push_commit two
export SHIM_RUNNING_IMAGE=sha256:running SHIM_LATEST_ID=sha256:broken-latest SHIM_RUNNING_SHA=oldsha
rc=$(run_unit)
if grep -q "docker tag sha256:running payroll-app:previous" "$SHIM_LOG"; then pass "previous = running image"; else bad "previous = running image ($(grep 'docker tag' "$SHIM_LOG" | head -1))"; fi
if ! grep -q "docker tag payroll-app:latest payroll-app:previous" "$SHIM_LOG"; then pass "never tags :latest as previous"; else bad "never tags :latest as previous"; fi
[ "$rc" = 0 ] && pass "successful deploy exits 0" || bad "successful deploy exits 0 (rc=$rc)"
grep -q "image prune -f" "$SHIM_LOG" && pass "removes dangling images after success" || bad "removes dangling images after success"
# The build cache is what makes the next deploy fast. With disk to spare it
# must not be pruned at all: every partial prune tried on the host left a
# cache the builder could not reuse.
if ! grep -q "builder prune" "$SHIM_LOG"; then pass "keeps the build cache when disk is fine"; else bad "keeps the build cache when disk is fine"; fi

# 1b. Low disk after a build clears the whole cache (never a partial prune)
setup; push_commit two
export SHIM_RUNNING_SHA=oldsha SHIM_FREE_KB=5000000
rc=$(run_unit)
grep -q "builder prune -f$" "$SHIM_LOG" && pass "low disk clears the whole build cache" || bad "low disk clears the whole build cache"
if ! grep -qE "builder prune .*(--filter|--max-used-space|--keep-storage)" "$SHIM_LOG"; then pass "never a partial prune"; else bad "never a partial prune"; fi
unset SHIM_FREE_KB

# 2. A failed build still cleans up, exits non-zero, and is NOT retried on the same HEAD
setup; push_commit two
export SHIM_UP_FAILS=1 SHIM_RUNNING_SHA=oldsha
rc=$(run_unit)
[ "$rc" != 0 ] && pass "failed build exits non-zero" || bad "failed build exits non-zero"
grep -q "image prune -f" "$SHIM_LOG" && pass "cleans up images after a FAILED build" || bad "cleans up images after a FAILED build"
: > "$SHIM_LOG"; rc=$(run_unit)
if ! grep -q "compose up -d --build" "$SHIM_LOG"; then pass "same failed HEAD is not rebuilt every tick"; else bad "same failed HEAD is not rebuilt every tick"; fi
grep -q "compose up -d --remove-orphans" "$SHIM_LOG" && pass "services still ensured up while skipping" || bad "services still ensured up while skipping"
unset SHIM_UP_FAILS; push_commit three; : > "$SHIM_LOG"; rc=$(run_unit)
grep -q "compose up -d --build" "$SHIM_LOG" && [ "$rc" = 0 ] && pass "a new commit after a failure is built" || bad "a new commit after a failure is built (rc=$rc)"

echo "--"; [ "$fail" = 0 ] && echo "ALL DEPLOY-UNIT TESTS PASSED" || echo "SOME DEPLOY-UNIT TESTS FAILED"; exit $fail

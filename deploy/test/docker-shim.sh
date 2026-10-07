#!/usr/bin/env bash
# Fake `docker` for the deploy tests. Logs every invocation to $SHIM_LOG and
# answers from environment knobs so the deploy unit and verify-image.sh can
# be exercised on a machine with no Docker at all.
#   SHIM_RUNNING_IMAGE   image id the "running" app container uses
#   SHIM_LATEST_ID       image id :latest resolves to
#   SHIM_UP_FAILS=1      make `compose up --build` fail (a build error)
#   SHIM_SIZE_INSPECT    bytes returned by `image inspect --format {{.Size}}`
#   SHIM_SIZE_LS         text returned by `image ls --format {{.Size}}`
#   SHIM_EXEC_EXIT       exit code for `docker exec` (default 0)
echo "docker $*" >> "${SHIM_LOG:?}"
case "$1 $2" in
  "compose ps")      echo "cid-app-1";;
  "compose exec")    echo "${SHIM_RUNNING_SHA:-}";;
  "compose up")      if [[ "$*" == *--build* && "${SHIM_UP_FAILS:-0}" = 1 ]]; then echo "failed to solve: no space left on device" >&2; exit 1; fi;;
  "compose logs")    exit 0;;
  "inspect "*)       echo "${SHIM_RUNNING_IMAGE:-sha256:running}";;
  "image inspect")   case "$*" in *previous*) [ -n "${SHIM_PREVIOUS_ID:-}" ] && echo "$SHIM_PREVIOUS_ID" || exit 1;; *Size*) echo "${SHIM_SIZE_INSPECT:-0}";; *) echo "${SHIM_LATEST_ID:-sha256:latest}";; esac;;
  "image ls")        echo "${SHIM_SIZE_LS:-0B}";;
  "exec "*)          exit "${SHIM_EXEC_EXIT:-0}";;
  "ps "*)            exit 0;;
esac
exit 0

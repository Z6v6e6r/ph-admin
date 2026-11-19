#!/usr/bin/env bash
set -euo pipefail
umask 077
kit=$(cd "$(dirname "$0")" && pwd)
mode=${1:?Use seed or recover}
output=${2:?Specify a work directory}
mkdir -p "$output"
output=$(cd "$output" && pwd)
: "${RATING_CUP_SOURCE:?Absolute CUP checkout pinned in manifest}"
: "${RATING_LK1_SOURCE:?Absolute LK1 checkout pinned in manifest}"
: "${RATING_LK2_SOURCE:?Absolute LK2 checkout pinned in manifest}"
: "${RATING_NODE_RED_ROOT:=$kit/nodered}"

case "$mode" in
  seed|recover) ;;
  *) echo "Unknown phase $mode" >&2; exit 2 ;;
esac

export PATH
export NODE_OPTIONS="--require=\"$kit/loopback-only.cjs\""
export NODE_PATH="$RATING_CUP_SOURCE/node_modules"
export RATING_CUP_DIST="${RATING_CUP_DIST:-$RATING_CUP_SOURCE/dist}"
export RATING_LK1_SOURCE NODE_RED_FIXTURE_ROOT="$RATING_NODE_RED_ROOT"
export RATING_CHECKPOINT="$output/checkpoint.json"
export TOURNAMENTS_MONGODB_URI='mongodb://127.0.0.1:27183/?replicaSet=ratingRecovery&directConnection=true&retryWrites=true&w=majority'
export TOURNAMENTS_MONGODB_DB=rating_recovery_fixture
export PLAYER_RATINGS_MONGODB_URI="$TOURNAMENTS_MONGODB_URI"
export PLAYER_RATINGS_MONGODB_DB=rating_recovery_fixture
export TOURNAMENTS_MONGODB_COLLECTION=custom_tournaments
export PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED=true
export PADLHUB_PLAYER_LEVEL_PROJECTION_MODE=pilot
export PADLHUB_PLAYER_LEVEL_PROJECTION_PILOT_BINDINGS='[{"playerKey":"client:synthetic-shared-player","clientId":"synthetic-shared-player"}]'
export PADLHUB_PLAYER_LEVEL_PROJECTION_URL='http://127.0.0.1:18183'
export PADLHUB_PLAYER_LEVEL_PROJECTION_TENANT_KEY=local-padel
export PADLHUB_PLAYER_LEVEL_PROJECTION_TOKEN=synthetic-shared-projection-test-token

if [[ "$mode" == recover ]]; then
  export TOURNAMENT_OWNER_RECOVERY_ONLY=true
  export TOURNAMENT_SERVER_BOOKING_MODE=enabled
else
  unset TOURNAMENT_OWNER_RECOVERY_ONLY TOURNAMENT_SERVER_BOOKING_MODE
fi

fixture="$RATING_LK2_SOURCE/scripts/.rating-recovery-ingress.ts"
[[ ! -e "$fixture" ]]
(
  set -o noclobber
  python3 "$kit/make-lk2-fixture.py" "$RATING_LK2_SOURCE/scripts/rehearse-cup-player-level-projection.ts" > "$fixture"
)
lk2_pid=
cleanup() {
  if [[ -n "$lk2_pid" ]]; then
    kill "$lk2_pid" 2>/dev/null || true
    wait "$lk2_pid" || true
  fi
  rm -f "$fixture"
}
trap cleanup EXIT
(
  cd "$RATING_LK2_SOURCE"
  export RATING_PHASE="$mode"
  export LK2_CUP_PROJECTION_TEST_DB='postgres://postgres@127.0.0.1:25483/rating_recovery_fixture'
  export LK2_CUP_PROJECTION_TEST_TOKEN="$PADLHUB_PLAYER_LEVEL_PROJECTION_TOKEN"
  exec node --import tsx scripts/.rating-recovery-ingress.ts
) > "$output/lk2-$mode.log" 2>&1 &
lk2_pid=$!
for ((i=0;i<60;i++)); do
  kill -0 "$lk2_pid" || { cat "$output/lk2-$mode.log" >&2; exit 1; }
  if curl --noproxy '*' --fail --silent --max-time 2 http://127.0.0.1:18183/rehearsal > /dev/null; then break; fi
  sleep 1
done
curl --noproxy '*' --fail --silent --max-time 2 http://127.0.0.1:18183/rehearsal > /dev/null
printf 'LK2 phase=%s pid=%s\n' "$mode" "$lk2_pid"
node "$kit/rehearse.cjs" "$mode"

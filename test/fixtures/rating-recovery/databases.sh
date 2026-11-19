#!/usr/bin/env bash
set -euo pipefail
umask 077
action=${1:?Use start, dump, restore, or stop}
archives=${2:-.}
tag=${RATING_DB_TAG:-repro}
[[ "$tag" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,35}$ ]]
mongo="phub-rating-recovery-mongo-$tag"
pg="phub-rating-recovery-pg-$tag"
label=org.padlhub.fixture=rating-recovery
db=rating_recovery_fixture
mongo_image='mongo@sha256:884c055bff8b7144ca44830d01826facd3083b33c4dea44b94a1476c62de3c32'
pg_image='postgres@sha256:81e77a4833487b8132fe4b00bedd39dc3f74b8641e387f19312a48f7de218c2e'

owned() {
  [[ "$(docker inspect --format '{{ index .Config.Labels "org.padlhub.fixture" }}' "$1")" == rating-recovery ]]
}

poll() {
  for ((i=0;i<45;i++)); do
    if "$@" >/dev/null 2>&1; then return; fi
    sleep 1
  done
  "$@"
}

case "$action" in
  start)
    docker run -d --label "$label" --name "$mongo" --publish 127.0.0.1:27183:27017 \
      "$mongo_image" --replSet ratingRecovery --bind_ip_all
    docker run -d --label "$label" --name "$pg" --publish 127.0.0.1:25483:5432 \
      --env POSTGRES_HOST_AUTH_METHOD=trust --env "POSTGRES_DB=$db" "$pg_image"
    poll docker exec "$mongo" mongosh --quiet --eval 'db.adminCommand({ping:1}).ok'
    docker exec "$mongo" mongosh --quiet --eval \
      'rs.initiate({_id:"ratingRecovery",members:[{_id:0,host:"127.0.0.1:27017"}]})'
    poll docker exec "$mongo" mongosh --quiet --eval \
      'if (!db.adminCommand({hello:1}).isWritablePrimary) quit(1)'
    poll docker exec "$pg" pg_isready -h 127.0.0.1 -U postgres -d "$db"
    ;;
  dump)
    owned "$mongo"; owned "$pg"
    mkdir -p "$archives"
    (
      set -o noclobber
      docker exec "$mongo" mongodump --db "$db" --archive --gzip > "$archives/mongo.archive.gz"
      docker exec "$pg" pg_dumpall -U postgres --roles-only --no-role-passwords |
        sed '/^CREATE ROLE postgres;$/d' > "$archives/postgres-roles.sql"
      docker exec "$pg" pg_dump -U postgres -Fc "$db" > "$archives/postgres.dump"
    )
    ;;
  restore)
    owned "$mongo"; owned "$pg"
    docker exec "$mongo" mongosh --quiet --eval \
      'if (db.getSiblingDB("rating_recovery_fixture").getCollectionNames().length) quit(1)'
    [[ "$(docker exec "$pg" psql -U postgres -d "$db" -tAc \
      "select count(*) from pg_namespace where nspname in ('eligibility', 'identity', 'profile')")" == 0 ]]
    docker exec -i "$mongo" mongorestore --stopOnError --nsInclude "$db.*" --archive --gzip < "$archives/mongo.archive.gz"
    docker exec -i "$pg" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$db" < "$archives/postgres-roles.sql"
    docker exec -i "$pg" pg_restore --exit-on-error -U postgres -d "$db" < "$archives/postgres.dump"
    ;;
  stop)
    owned "$mongo"; owned "$pg"
    docker rm -f -v "$mongo" "$pg"
    ;;
  *) echo "Unknown database action $action" >&2; exit 2 ;;
esac

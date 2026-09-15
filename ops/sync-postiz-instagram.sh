#!/bin/sh
set -eu
umask 077
mkdir -p /var/lib/dreamcatcher-reporting
chmod 700 /var/lib/dreamcatcher-reporting
tmp=$(mktemp /var/lib/dreamcatcher-reporting/.instagram.XXXXXX)
trap 'rm -f "$tmp"' EXIT
container=$(docker ps --filter name=postiz-fhbl7lcdb94xaywmxq2ffe6k --format '{{.Names}}')
[ "$container" = 'postiz-fhbl7lcdb94xaywmxq2ffe6k' ]
docker exec -i "$container" node < /opt/dreamcatcher-reporting/sync-postiz-instagram.cjs > "$tmp"
test -s "$tmp"
mv "$tmp" /var/lib/dreamcatcher-reporting/postiz-instagram.json

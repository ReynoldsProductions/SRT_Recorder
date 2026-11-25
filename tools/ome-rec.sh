#!/bin/sh
# Start/stop/list OvenMediaEngine recordings directly through its REST API, bypassing c2c-console.
# For debugging OME itself; normal recording control belongs in the console.
#
#   ome-rec.sh streams              # inbound streams OME currently sees
#   ome-rec.sh start <stream> [id]  # start recording (id defaults to <stream>-<UTC time>)
#   ome-rec.sh stop  <id>           # stop a recording
#   ome-rec.sh list                 # all recordings and their state
#
# Env: OME_API_TOKEN (required, OME_API_TOKEN from deploy/.env; Server.xml reads it via ${env:...})
#      OME_API_URL   (default: the ovenmediaengine container's IP on port 8081; the API is not published)
#      OME_CONTAINER (default: ovenmediaengine)   OME_APP (default: app)
set -eu

: "${OME_API_TOKEN:?set OME_API_TOKEN}"
OME_CONTAINER="${OME_CONTAINER:-ovenmediaengine}"
if [ -z "${OME_API_URL:-}" ]; then
  IP=$(docker inspect "$OME_CONTAINER" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null) \
    || { echo "error: $OME_CONTAINER container not running (or set OME_API_URL)" >&2; exit 1; }
  OME_API_URL="http://${IP}:8081"
fi
API="${OME_API_URL%/}/v1/vhosts/default/apps/${OME_APP:-app}"
AUTH="Authorization: Basic $(printf %s "$OME_API_TOKEN" | base64)"

call() { # method path [json]
  curl -sS -m 10 -X "$1" -H "$AUTH" -H 'Content-Type: application/json' "${API}$2" ${3:+-d "$3"}
  echo
}

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

case "${1:-}" in
  streams) call GET /streams ;;
  list)    call POST :records '{}' ;;
  start)
    STREAM="${2:?stream name required, e.g. cam1}"
    case "$STREAM" in *[!A-Za-z0-9_-]*) echo "error: invalid stream name" >&2; exit 2 ;; esac
    ID="${3:-${STREAM}-$(date -u +%Y%m%dT%H%M%SZ)}"
    case "$ID" in *[!A-Za-z0-9_.:-]*) echo "error: invalid id" >&2; exit 2 ;; esac
    call POST :startRecord "{\"id\":\"${ID}\",\"stream\":{\"name\":\"${STREAM}\"}}" ;;
  stop)
    ID="${2:?recording id required (see: ome-rec.sh list)}"
    case "$ID" in *[!A-Za-z0-9_.:-]*) echo "error: invalid id" >&2; exit 2 ;; esac
    call POST :stopRecord "{\"id\":\"${ID}\"}" ;;
  *) usage ;;
esac

#!/bin/sh
# Offline recording regression test: replay a captured camera .ts over SRT, record it through the OME
# REST API, then report duration, frame count and decode errors for the resulting file(s).
# This is how the FX2 PPS problem was found and how the OME path was passed, without a camera present.
#
#   ome_replay_test.sh <capture.ts>
#
# Env: SRT_HOST        (required) host the relay / OME SRT listener is on, e.g. this machine's LAN IP
#      DIAG_DIR        (required) directory holding the capture
#      RECORDINGS_DIR  (required) where OME writes recordings (deploy/.env RECORDINGS_DIR)
#      OME_API_TOKEN   (required) see tools/ome-rec.sh
#      MODE            relay (default): AES SRT into the c2c-relay port, like a real camera
#                      direct: plain SRT straight into OME's listener with a stream ID (isolates the relay)
#                              OME publishes no host SRT port, so set SRT_HOST to the OME container IP
#      SRT_PORT        relay port (default 8897) or OME SRT port for direct mode (default 9999)
#      SRT_PASSPHRASE  required for relay mode: that input's passphrase from the console
#      STREAM          OME stream / input name (default cam1)
set -u

SRC="${1:?usage: ome_replay_test.sh <capture.ts in DIAG_DIR>}"
: "${SRT_HOST:?set SRT_HOST}" "${DIAG_DIR:?set DIAG_DIR}" "${RECORDINGS_DIR:?set RECORDINGS_DIR}" "${OME_API_TOKEN:?set OME_API_TOKEN}"
MODE="${MODE:-relay}"
STREAM="${STREAM:-cam1}"
case "$SRC$STREAM" in */*|*[!A-Za-z0-9_.-]*) echo "error: capture and stream must be plain names" >&2; exit 2 ;; esac
# Pinned ffmpeg image used for both replay and analysis.
IMG=linuxserver/ffmpeg@sha256:66fa8e2351fb78f9dad2c59c946be2658edcc529339320da3f2cf788312368af
REC="$(dirname "$0")/ome-rec.sh"
ID="replaytest-$(date -u +%Y%m%dT%H%M%SZ)"

case "$MODE" in
  relay)
    : "${SRT_PASSPHRASE:?set SRT_PASSPHRASE for relay mode}"
    URL="srt://${SRT_HOST}:${SRT_PORT:-8897}?passphrase=\$PP&pbkeylen=16" ;;
  direct)
    SID=$(python3 -I -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "srt://${SRT_HOST}:${SRT_PORT:-9999}/app/${STREAM}")
    URL="srt://${SRT_HOST}:${SRT_PORT:-9999}?streamid=${SID}" ;;
  *) echo "error: MODE must be relay or direct" >&2; exit 2 ;;
esac

START=$(date +%s)
# The passphrase goes in via the container env so it never appears in this host's process list.
docker run --rm -d --name ome-replay --network host -e PP="${SRT_PASSPHRASE:-}" -v "$DIAG_DIR":/d:ro --entrypoint sh "$IMG" \
  -c "ffmpeg -hide_banner -loglevel error -re -i /d/$SRC -map 0 -c copy -f mpegts \"$URL\"" >/dev/null
sleep 4
echo "--- streams:"; "$REC" streams
echo "--- startRecord:"; "$REC" start "$STREAM" "$ID"
while docker ps -q --filter name=ome-replay | grep -q .; do sleep 2; done
echo "--- records after stream end:"; "$REC" list
"$REC" stop "$ID" >/dev/null
sleep 2
echo "--- ome log:"
docker logs --since "$START" "${OME_CONTAINER:-ovenmediaengine}" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E ' [EW] |File|Record|SRT' | cut -c1-220 | tail -12
echo "--- files:"
find "$RECORDINGS_DIR" -newermt "@$START" -name '*.ts' -type f | while read -r f; do
  ls -la "$f"
  docker run --rm -v "$(dirname "$f")":/r:ro --entrypoint sh "$IMG" -c '
    f=/r/$1
    echo "dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")" \
         "frames=$(ffprobe -v quiet -select_streams v -count_frames -show_entries stream=nb_read_frames -of csv=p=0 "$f")" \
         "pps_errors=$(ffmpeg -v error -i "$f" -f null - 2>&1 | grep -c PPS)" \
         "all_err_lines=$(ffmpeg -v error -i "$f" -f null - 2>&1 | grep -c .)"
    ffprobe -v error -show_entries stream=codec_name,width,height,avg_frame_rate,bit_rate -of compact "$f"' _ "$(basename "$f")"
done

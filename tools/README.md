# tools

- `srt_handshake_sid.py`: decodes the SRT handshake from a pcap and shows the stream ID the caller sends and
  whether it offered encryption (KMREQ). Run with `python3 -I` on captures you made yourself.
- `ome-rec.sh`: start/stop/list OvenMediaEngine recordings straight through its REST API, bypassing the console.
  For debugging OME itself. Needs `OME_API_TOKEN`; finds the API on the `ovenmediaengine` container's IP.
- `ome_replay_test.sh`: offline regression test. Replays a captured camera `.ts` over SRT (through `c2c-relay` with
  AES, or straight into OME with `MODE=direct`), records it through the OME API, and reports duration, frame count
  and decode/PPS errors for the result. This is how the MediaMTX PPS loss was found and the OME path passed without a
  camera present. All hosts, paths and secrets come from env vars (see the header). Use test captures only.

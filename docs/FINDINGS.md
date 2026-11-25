# Findings (lab test, 2026-11-24)

One-camera proof of concept: Sony **ILME-FX2** → encrypted SRT over a wired LAN → Docker host. All
footage was synthetic or non-sensitive.

## Sony FX2

| Topic | Finding |
|---|---|
| Wired network | A USB-C Ethernet adapter works, but **USB-LAN must be started from the menu**: MENU → Network → *USB-LAN/Tethering* → *USB-LAN Connection*. Plugging it in alone does nothing (no link lights, no IP). |
| Where SRT is configured | Only in **Sony Creators' App** (Bluetooth-paired phone). The camera menu just turns streaming on and starts/stops output (control-wheel center). |
| App SRT fields | URL, Port, Latency (ms), TTL, Encryption (None/AES-128/AES-256), Pass phrase/Common key, ARC, Video Codec. **No stream ID field, no caller/listener choice** (the camera is always the caller). |
| URL format | **Must be exactly `srt://<host>`.** Anything after the host (`?streamid=…`, `%3A`-encoded colons, `/path`) makes the camera send **zero packets** (confirmed by packet capture). The app also silently strips text after a `:`. With a bare host the handshake carries **no SID extension**. |
| Error message | Any destination failure shows "camera is not connected to the Internet / check Wi-Fi Connect". This is **misleading**: wired streaming works without Wi-Fi. |
| Encryption | **AES-128 works** (the handshake carries KMREQ). Wrong or missing passphrases are rejected by the receiver. |
| Stream content | H.264 High 8-bit 4:2:0 (HEVC is selectable, not tested) + **AAC-LC 48 kHz stereo** (not 16-bit PCM). Observed 4K29.97 ~20 Mbps, 4K59.94 ~40 Mbps, 1080p59.94 ~9 Mbps. |
| H.264 quirk | The FX2 sends **~53 PPS NAL units per GOP with multiple PPS ids**. Receivers that keep only one PPS lose frames (see MediaMTX below). |
| Reconnect | After a server restart mid-stream, the FX2 reconnected on its own within ~4 s (observed once). |
| Library compatibility | **libsrt 1.5.3 (Alpine) fails the FX2 handshake** (`Error opening input: I/O error`). libsrt 1.5.7 works, which is why the relay image is built on `linuxserver/ffmpeg`. |

**Consequence:** the FX2 can't name its stream, so the server identifies cameras by **listener port**
(one SRT port per camera). This is the traditional SRT pattern (vMix/OBS inputs, hardware decoders,
cloud ingest), as opposed to stream-ID multiplexing on one port.

## MediaMTX: FAIL for FX2 recordings

- Recording the FX2 stream gives `non-existing PPS 2 referenced`. **~5% of frames can't be decoded.**
- Reproduced offline by replaying a clean ffmpeg capture of the camera stream: same result with
  **fMP4 and MPEG-TS**, on **v1.21.3 and v1.21.4**, with and without the relay. The raw capture decodes cleanly.
- Cause: MediaMTX keeps one PPS per track and drops the rest. Candidate upstream bug report.
- Also: MediaMTX requires a `publish:<path>` stream ID (with a colon), which the FX2 can't send.

## OvenMediaEngine: PASS

- FX2 live take: 64.1 s, 1921 frames (exactly 29.97 fps), **0 decode errors**, passed through untouched (bypass profile).
- Recording is controlled through the REST API (`startRecord`/`stopRecord`). It accepts a per-recording `filePath`,
  `infoPath` and `metadata`, which is what makes human-readable names possible.
- Stopping a recording while the camera keeps streaming leaves the stream unaffected.
- **If the input stream ends, the active recording ends.** It doesn't resume into the same file on reconnect, so the
  operator has to re-arm.
- `${StartTime:…}` file tokens: use `hh` for hours (`HH` comes out literally).
- Stats `lastThroughputIn` is **bytes/s**. Per-track `bitrateLatest` is bits/s.
- `Server.xml` supports `${env:NAME:default}` macros (used for the API token).
- LL-HLS output works for H.264+AAC passthrough. Note: Node's `fetch` asks for gzip, so a proxy must not
  forward the upstream `Content-Length` (it truncated playlists).
- The old URL-encoded `srt://host:port/app/stream` stream ID still works but logs a deprecation warning in
  favor of `{host}/{app}/{stream}`.

## Load (one host, Docker)

| Stream | Relay | OME |
|---|---|---|
| 4K29.97 H.264 ~20 Mbps | ~11% CPU, ~31 MB | ~11% CPU, ~29 MB |

Three simultaneous inputs (FX2 or replay + 1080p59.94 + 720p29.97 synthetic) ran without issue. Four 1080p cameras
look plausible but **haven't been tested**.

## Relay

- `-c copy`, `-re` plus a short probe (2 s / 5 MB). Without pacing, the probe buffer is burst into the server
  (MediaMTX's recorder flagged it as clock drift).
- Known issue: a few seconds can be lost at the very start of a session (probe). Measure and tune
  before edge-of-take tests.
- One caller per port: while a camera is connected, a second sender on the same port is refused.

## Test matrix status

| Test | Status |
|---|---|
| Secure ingest (encrypted; wrong/absent passphrase rejected) | Pass |
| Camera compatibility (FX2) | Pass with port-per-camera relay |
| Short take | Partial (~27–64 s at 1080p59.94 / 4K29.97). Full 5-minute take not done |
| 60-minute take | Not tested |
| 4K path vs card original | Recorded. Comparison not done |
| NLE import | Not tested |
| Network disruption / process / host failure | Not formally tested |
| Disk pressure | Not tested |
| Multi-camera load | 3 inputs OK. 4×1080 not tested |
| Encrypted storage | Not done (lab used unencrypted storage) |

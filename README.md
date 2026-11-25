# SRT_Recorder

A front end for SRT-based remote recording: cameras push **encrypted SRT** to a server on the local
network, which records camera-quality files with per-shoot / per-camera / per-take naming. Engineers
monitor and control it from a web console or from **Bitfocus Companion**.

```
Sony FX2 / any SRT caller ──AES SRT──▶ c2c-relay (one UDP port per camera, passphrase per camera)
                                          │ stream copy (no re-encode)
                                          ▼
                                   OvenMediaEngine ──▶ <shoot>/<camera>/<clip>_T001_<time>.ts
                                          │ REST + LL-HLS
                                          ▼
              browser ──▶ c2c-console :3020 ◀── Companion (companion-module)
```

## What's here

| Path | What |
|---|---|
| [`console/`](console/) | **c2c-console** (web UI + API) and **c2c-relay** (SRT relay manager). Node, no npm dependencies. 53 tests |
| [`companion-module/`](companion-module/) | Bitfocus Companion v5 module (`@companion-module/base` 2.x). Start/stop/toggle, shoot/clip/take naming, tally, variables, presets |
| [`deploy/`](deploy/) | `docker-compose.yml`, `.env.example`, OvenMediaEngine `Server.xml` |
| [`docs/FINDINGS.md`](docs/FINDINGS.md) | Test results: Sony FX2 SRT behavior, MediaMTX vs OvenMediaEngine |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Deploy, add cameras, Companion setup, rotating secrets |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | Project status and open items, for whoever picks this up next |
| [`tools/`](tools/) | Diagnostics (SRT handshake decoder) |

## Quick start

```bash
cd deploy
cp .env.example .env        # fill in every CHANGE_ME
docker compose up -d --build
# open http://<server>:3020 (user "engineer"), "Add input", then enter the shown
# URL / port / passphrase on the camera.
```

## Features

- **Per-camera encrypted SRT listeners**, created and removed from the UI. Ports come from a reserved range and passphrases are generated.
  This works with cameras that can't send an SRT stream ID (Sony FX2).
- **Recording control is separate from camera takes**: start/stop per input or for all inputs, from the UI or Companion.
- **Naming**: set the shoot (folder), clip name per camera, and an auto-incrementing take →
  `2026-11-24_Promo/cam1/interview_T003_2026-11-24_17-06-41.ts`. Metadata goes in a sidecar `.xml`. Existing files are never overwritten.
- **Signal health**: live / stalled / none, codec, resolution, fps and bitrate per input, plus relay connection state.
- **Low-latency HLS preview** in the browser, behind the console login.
- **Recordings list** with "clear between shoots" (hides only; files are never deleted).

## Status

Lab-tested on 2026-11-24 with a Sony FX2 (4K29.97 / 4K59.94 / 1080p59.94 H.264) and synthetic sources.
Recordings come out passed through untouched, with 0 decode errors. See [docs/FINDINGS.md](docs/FINDINGS.md) for what's
verified and [docs/HANDOFF.md](docs/HANDOFF.md) for what isn't yet (long takes, disruption tests, NLE import, HTTPS).

**Security:** this is built for a trusted LAN. The console uses plain HTTP with one shared login. Don't expose it
or the SRT ports to the internet without adding TLS and proper auth.

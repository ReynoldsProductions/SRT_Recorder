# Handoff: project status (2026-11-24)

Read this first if you're picking the project up (human or AI session). Read [FINDINGS.md](FINDINGS.md) for
the evidence and [OPERATIONS.md](OPERATIONS.md) for how to run it.

## Where things stand

- **Working end to end:** Sony FX2 → AES-128 SRT → `c2c-relay` (port per camera) → OvenMediaEngine → named
  `.ts` recordings. Controlled from `c2c-console` (web) and the Companion module.
- **Verified:** FX2 live recordings at 4K29.97 / 1080p59.94 with 0 decode errors. Three concurrent inputs.
  Start/stop/start-all/stop-all with auto take numbers. Passphrase rejection. Relay status. LL-HLS proxy (with curl).
  The Companion module was loaded into a real Companion **5.1.3**, and its variables tracked live console state.
- **Rejected:** MediaMTX as the recorder (drops the FX2's extra PPS → ~5% bad frames).

## Components

| Component | Tech | Tests |
|---|---|---|
| `console/src/app.js`, `recording.js`, `inputs-config.js`, `state.js`, … | Node 24, built-ins only | `cd console && npm test` (53 tests, ~98% lines) |
| `console/src/relay/*` (`c2c-relay`) | Node 24 + ffmpeg 9.0.2 / libsrt 1.5.7 | included above |
| `companion-module/` | TypeScript, `@companion-module/base` 2.2.2, Node 26 runtime | `yarn build && yarn test` (7) + `yarn lint` |

Design decisions to keep:
- **Port per camera** (no stream IDs): required by the FX2.
- **Relay separate from the console:** redeploying the UI doesn't drop camera streams.
- **Input registry in `inputs.json`** (console writes, relay reads read-only, mode 0600). Input names can't be changed after creation (they're part of file paths and take keys).
- **Take numbers live in the console** (`state.json`), keyed by shoot/input/clip. A take is only consumed once OME confirms the recording started.
- **"Clear list" never deletes files.** Nothing in this project deletes recordings.

## Open items (priority order)

1. **Browser-check the preview** (Chrome + Safari): latency, CPU at 4K, behavior on signal loss.
2. **Alerts:** signal lost and recording ended unexpectedly (OME ends the recording when input drops). Maybe an opt-in auto re-arm.
3. **NLE import test** of the `.ts` output (Premiere/Resolve): seeking, audio, timecode.
4. **Disruption tests:** network pull mid-take, relay/OME/host restart, 60-minute take, disk pressure (disposable volume only).
5. **Relay start-loss:** measure how much of the first seconds is lost with OME and tune the probe.
6. **Long-record segmentation:** OME `startRecord` supports `interval`/`segmentationRule`, which needs a `${Sequence}` token in the path.
7. **HEVC from the FX2**, and **4× 1080p** load.
8. **Security beyond the lab:** HTTPS, per-user auth, audit log of record actions, encrypted recording storage.
9. Relay → OME stream ID: switch to OME's newer `{host}/{app}/{stream}` format.
10. Companion: publish the module (bitfocus/companion-module-requests) if it's worth sharing; add upgrade scripts before changing action/option ids.

## Gotchas

- Restarting OME ends active recordings and drops camera streams. Check that nothing is recording first.
- After editing `.env`, use `docker compose up -d` (recreate), not `restart`.
- Recordings are written by OME as root. Moving or deleting them needs elevated permissions.
- Alpine's libsrt (1.5.3) fails the FX2 handshake. Don't rebase the relay image on Alpine.
- Node 26 doesn't bundle corepack: `npm i -g corepack` before using Yarn 4.

# C2C Console + SRT relay

Engineer console for SRT camera recording, backed by OvenMediaEngine (OME). The same codebase
builds two images:

| Image | Dockerfile | Role |
|---|---|---|
| `c2c-console` | `Dockerfile` | Web UI + JSON API: input management, signal health, record start/stop, shoot/clip/take naming, LL-HLS preview proxy |
| `c2c-relay` | `Dockerfile.relay` | One encrypted SRT **listener per input**, forwarding to OME by stream copy (for cameras that can't send an SRT stream ID, e.g. Sony FX2) |

```
camera --AES SRT (caller)--> c2c-relay :<port per input> --copy--> OME app/<input> --> FILE (.ts) / LL-HLS
browser / Companion --> c2c-console :3020 --REST--> OME API
```

No npm dependencies (Node built-ins only). hls.js 1.5.20 is vendored in `public/vendor/`.

## Run tests

    npm test        # node:test + coverage

## Configuration (environment)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `CONSOLE_PASSWORD` | yes | — | HTTP Basic password for user `CONSOLE_USER` (default `engineer`), at least 12 chars |
| `API_KEY` | no | — | Bearer key for machine clients (Companion), at least 24 chars. Refused on `/api/config/*` |
| `TRUST_PROXY` | no | off | `1` only behind your own reverse proxy: use the rightmost `X-Forwarded-For` as the client address for throttling/audit |
| `SYNC_TOKEN` | no | — | Read-only token for a relay on another host (DMZ). At least 32 chars, different from the password and API key. Opens only `GET /api/relay/inputs`. Unset = endpoint closed |
| `SYNC_ALLOWED_IPS` | no | any | Comma list of addresses the sync token may be used from |
| `OME_API_URL`, `OME_ACCESS_TOKEN` | yes | — | OME REST API (`http://ovenmediaengine:8081`) + its `<AccessToken>` |
| `OME_PREVIEW_URL` | no | — | OME LL-HLS base (`http://ovenmediaengine:3333`) to enable the preview |
| `INPUTS_FILE` | no | `/data/inputs.json` | Input registry (shared read-only with `c2c-relay`). Mode 0600 |
| `STATE_FILE` | no | `/data/state.json` | Shoot, clip names, take counters, list-cleared time |
| `INPUTS` | no | — | First-run seed only, e.g. `cam1:8897` (passphrases are generated) |
| `RELAY_PORT_MIN` / `RELAY_PORT_MAX` | no | 8897 / 8912 | Port range for inputs. Must match the relay's published range |
| `RELAY_STATUS_URL` | no | — | `http://c2c-relay:8090` |
| `PUBLIC_HOST` | no | — | Host/IP cameras connect to (shown in "Camera setup") |
| `RECORDINGS_SHARE` | no | — | Shown in the UI as where operators find files (e.g. an SMB URL) |
| `RECORDINGS_DIR` | no | `/recordings` | OME FILE output, mounted read-only |
| `TZ` | no | UTC | Local time used in file names |

Relay: `INPUTS_FILE`, `RELAY_PORT_MIN/MAX`, `OME_SRT_HOST` (`ovenmediaengine`), `OME_SRT_PORT` (9999), `STATUS_PORT` (8090).

## API

All responses use `{ success, data, error }`. Auth: HTTP Basic (browser) or `Authorization: Bearer <API_KEY>`.
Basic-auth POSTs must send `X-C2C-Request: 1` (CSRF guard). Bearer clients are exempt, but the API key gets 403 on every `/api/config/*` route.
After 8 failed logins from one address in 10 minutes, that address gets 429 for 5 minutes.

| Method | Path | |
|---|---|---|
| GET | `/healthz` | no auth |
| GET | `/api/status` | `{ shoot, clearedAt, inputs: [...] }`: signal, relay, tracks, clip, nextTake, nextFile, recording |
| GET | `/api/inputs` | input status list |
| GET | `/api/recordings[?all=1]` | newest first, hides entries before the last "clear" |
| GET / POST | `/api/config/inputs` | list / add input (`name`, `label`, `port`, `latencyMs`, `enabled`). The passphrase is generated |
| POST | `/api/config/inputs/:name` | edit (relay-affecting fields refused while recording) |
| POST | `/api/config/inputs/:name/regenerate-passphrase`, `…/delete` | |
| POST | `/api/shoot` | `{ shoot }`. Refused while recording. Clears the list |
| POST | `/api/recordings/clear` | hide entries (files are never deleted) |
| POST | `/api/inputs/:name/clip` | `{ clip }` |
| POST | `/api/inputs/:name/take` | `{ next }`: next take number |
| POST | `/api/inputs/:name/record/start\|stop\|toggle` | start/toggle accept `{ clip }` |
| POST | `/api/record/start-all`, `/api/record/stop-all` | per-input results |

Files: `<shoot>/<input>/<clip>_T<take>_<YYYY-MM-DD_HH-MM-SS>.ts` + OME `.xml` sidecar with
`{shoot,input,clip,take}` metadata.

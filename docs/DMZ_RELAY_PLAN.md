# DMZ relay — plan

Goal: accept SRT from cameras/encoders over the **public internet**, on a small dedicated
DMZ host, without exposing the recording stack (console, OvenMediaEngine, storage) to it.
The DMZ host plan (machine build, network/firewall layout) is a separate document; this
one is scoped to the **service** that runs on it.

## Decisions (fixed)

- **One UDP port per camera.** No stream-ID multiplexing. Several SRT encoders already in
  the kit (Sony FX2; to confirm on the ATEM Mini Pro ISO, ATEM Mini Extreme ISO G2, Hyperdeck
  Studio Minis) either can't send a stream ID or haven't been verified to, and the kit is
  expected to grow with low-cost encoders of unknown capability. Port-per-device is the
  lowest-common-denominator pattern that works for all of them, and is also the conventional
  approach for SRT ingest generally (vMix, OBS, MediaConnect).
- **6 ports provisioned now** — 2x the camera count in hand today. Reserved up front (at the
  firewall/NAT layer) so adding a camera within that headroom never touches network config;
  running out of the 6 is the trigger for a scheduled-downtime expansion, not a live change.
- **Listeners default OFF.** A provisioned port with nothing listening is low-risk (the OS
  just drops packets — no code runs). A listener that's up and parsing SRT handshakes 24/7
  on a port nobody's using is needless pre-auth attack surface (library parsing happens
  before the passphrase check). Each input starts disabled and is turned on deliberately,
  per shoot.
- **Manual start via the console UI, Bitfocus Companion, or the console's API — any of the
  three is acceptable.** Companion is the expected normal path on show day.
- **Harden as we go**, not as a final pass — each piece below names its own hardening, not a
  deferred checklist.

## What already exists (don't rebuild it)

The relay manager/supervisor (`console/src/relay/manager.js`, `relay/supervisor.js`) already
does almost exactly this:

- One supervised `ffmpeg` process per **enabled** input, each a plain SRT listener on its own
  port, stream-copied onward to OvenMediaEngine (`supervisor.js` → `buildFfmpegArgs`). Not
  enabled → no process, confirmed in `manager.js`'s `reconcile()` (`wanted` is filtered to
  `i.enabled` before anything is started).
- Config lives in `data/inputs.json`, validated and mutated through `inputs-config.js`
  (`createInputsStore`) — this is already the "data-driven device registry" a port-per-device
  design needs: name, port, passphrase, latency, `enabled`, one row per camera.
- `manager.reconcile()` runs every `RECONCILE_MS` (default 2s) and diffs `wanted` against
  `running` — toggling `enabled` in the store starts or stops that one input's ffmpeg process
  without touching any other running camera. This is exactly the "add/toggle one camera
  without disturbing the others" behaviour the port-per-device plan depends on.
- Bitfocus Companion module + a scoped Bearer API key already exist, already used for
  recording control (`record/start|stop|toggle`).

So this plan is about **closing specific gaps**, not building a new system.

## Gaps to close

### 1. Default `enabled` is currently `true`

`inputs-config.js`: `DEFAULTS = { latencyMs: 1000, enabled: true }`. Flip to `false`. Any
input created without an explicit `enabled` — including the 6 seeded today — starts off.

### 2. No route lets the Bearer (Companion) key start/stop a *listener*

`app.js:144` blocks `bearer` auth from all of `/api/config/*`, which is also the only place
`enabled` can be changed today (`PATCH /api/config/inputs/:name`). That route is blocked for
Bearer **on purpose** — it's bundled with the input's name/port/passphrase, and the API key
must never be able to read a passphrase (see `OPERATIONS.md`'s access-control section).

Fix: add a narrow, Bearer-reachable route that does exactly one thing —
`POST /api/inputs/:name/listener { enabled: true|false }` — reusing `guardNotRecording`
(can't flip a camera that's actively recording) and `inputs.update(name, { enabled })`, but
returning only `{ name, port, enabled }`, never the passphrase or any other config field.
This keeps today's security boundary (API key can't read secrets) while satisfying "start via
Companion or API."

### 3. The relay needs to run where the console/OME don't

Today's `deploy/docker-compose.yml` co-locates `ovenmediaengine`, `c2c-console`, and
`c2c-relay` as one stack, assuming they share a Docker network and a bind-mounted
`data/inputs.json`. On the DMZ host, only **`c2c-relay`** moves — the console (recording
control, passphrases, Companion API) and OvenMediaEngine (recording, storage) stay on the
internal host, same place they are today, reachable over Tailscale/LAN only, never from the
DMZ box and never through any public hostname.

Needed:
- A standalone `docker-compose.yml` (or a `deploy/dmz/` variant) running only `c2c-relay`,
  pointed at the internal host's real LAN address via `OME_SRT_HOST` (already an env var —
  no code change) instead of today's Docker-network hostname `ovenmediaengine`.
- **Config sync.** `createManager`'s `readInputs` is already an injected function (see
  `manager.js` — it's not hardcoded to `readFile`), which is exactly the extension point this
  needs. Replace the file read with an authenticated HTTP fetch of the current input list from
  the console, polled on the same reconcile interval. The console stays the single source of
  truth for `inputs.json` — the DMZ relay never gets its own writable copy, so there's no
  split-brain between "what Companion thinks is enabled" and "what's actually listening."
  This needs a new, read-only sync endpoint on the console, separate from both the Basic-auth
  config routes and the Bearer-scoped routes — it carries passphrases (the relay needs them to
  build each listener), so it needs its own credential, not reused from either existing one,
  and should only ever be reachable from the DMZ box's address over the internal link, not
  from the public side.

### 4. The DMZ→internal-host hop currently has no independent passphrase

`buildFfmpegArgs`'s outbound leg (`srt://${omeHost}:${omePort}?streamid=...&latency=200000`)
carries no passphrase today — fine for the current same-Docker-network lab setup, where
OvenMediaEngine's SRT listener is reachable only from inside that network. Once the relay is
on a separate box reachable via a routed (if firewalled) LAN path, add a second,
independent passphrase on this hop: if the DMZ box is ever compromised, it still can't inject
a stream into the recording stack without it. One shared "backhaul" passphrase (not
per-camera — this hop isn't camera-identifying, the stream ID already is) via a new env var,
plus the matching passphrase requirement on OvenMediaEngine's `Server.xml` SRT listener
(currently unverified/absent — tracked in the lab's own `docs/FINDINGS.md` gaps).

## Target platforms

**Primary: x86_64**, on the Celeron box earmarked for this (see the DMZ machine plan doc).
**Secondary, must stay testable: ARM64**, on a Raspberry Pi 4 Tom already has on hand. Tom is
also evaluating ARM SBCs for a few other, isolated DMZ services unrelated to this relay — this
section is about keeping *this* service portable, not committing it to ARM as a destination.

What that requires in practice:

- **No code change needed for cross-building.** Checked the three pinned base-image digests in
  `console/Dockerfile` and `console/Dockerfile.relay` (`node@sha256:...` ×2,
  `linuxserver/ffmpeg@sha256:...`) with `docker buildx imagetools inspect` — all three are
  multi-arch manifest lists that already include a `linux/arm64` (or `arm64/v8`) entry, not
  single-platform digests. `docker build`/`compose build` on a Pi resolves the right platform
  automatically.
- **The Pi 4 must run a 64-bit OS** (Raspberry Pi OS 64-bit, Ubuntu Server arm64, etc.). None of
  the inspected manifests include a 32-bit `linux/arm/v7` entry — the legacy 32-bit Raspberry Pi
  OS image won't resolve to a supported platform at all.
- **Genuinely unverified, and this is the one that matters:** whether the arm64 build of
  `linuxserver/ffmpeg` carries the same libsrt behavior as the x86_64 build this project is
  already pinned to specifically *because* of a version-specific handshake bug (Alpine's libsrt
  1.5.3 fails the Sony FX2's handshake; `linuxserver/ffmpeg`'s libsrt 1.5.7 doesn't — see
  `docs/FINDINGS.md`). Multi-arch images are normally built from the same upstream source per
  tag, so it's *likely* fine, but "likely" isn't good enough for a bug this specific — run the
  same FX2 handshake test on the Pi before trusting it, don't assume parity from the tag match
  alone.
- Compute/RAM headroom is not a concern either way — the workload is light enough (stream-copy
  only, ~11% of one x86 core and ~31MB RAM per camera measured on the lab's current hardware)
  that a Pi 4's weaker per-core ARM performance still has large margin, even before any of this
  gets near the Celeron's specs.

## Non-goals for this doc

- The DMZ machine build itself (OS, nftables, VLAN, the UCG-Fiber firewall rule, Tailscale
  sidecar for admin access) — separate plan doc, follows this one.
- TURN/coturn for WebRTC — separate service, separate plan. This relay is SRT-only.
- Stream-ID-based multiplexing — deliberately not pursued now; may be added later as a
  per-device opt-in for a confirmed-capable encoder, not a replacement for port-per-device.

## Rollout order

1. ~~Flip the `enabled` default (gap 1).~~ **Done** — see PR #4.
2. ~~Add the scoped listener-toggle route (gap 2).~~ **Done** (the route) — see PR #4. A
   Companion module preset for it is not built; the raw API route already satisfies "start via
   API," so this isn't blocking.
3. ~~Add the backhaul passphrase (gap 4) to the existing lab setup first, while everything's
   still on one host.~~ **Done** — see PR #4.
4. Split the compose stack and build the config-sync endpoint (gap 3) — **not started**. Needs
   a design decision first: the sync endpoint's own credential, separate from both the Basic
   and Bearer auth that already exist.
5. Run both target platforms (x86_64 and the Pi 4) through the same FX2 handshake test before
   trusting either — not yet done on the Pi.
6. Seed the 6 ports (`cam1..cam6`, consecutive ports, `enabled: false`, no passphrase assigned
   until a camera is actually scheduled) once the DMZ host itself exists.

# Operations

## Deploy

```bash
cd deploy
cp .env.example .env
# generate each secret:
python3 -c "import secrets;print(secrets.token_urlsafe(32))"
chmod 600 .env
docker compose up -d --build
docker compose logs -f c2c-relay c2c-console
```

Open `http://<server>:3020` and log in as `engineer` with `C2C_CONSOLE_PASSWORD`.

What's exposed: the console (TCP `CONSOLE_PORT`) and the relay port range (UDP `RELAY_PORT_MIN`–`RELAY_PORT_MAX`).
OvenMediaEngine's SRT (9999), API (8081) and LL-HLS (3333) stay on the internal Docker network. Keep it
that way, because OME's SRT listener has no passphrase.

## Add a camera

1. Console → **+ Add input**: name (`cam2`), optional label, port (pre-filled from the range), latency.
2. Open the card's **Camera setup** and enter the values on the camera:
   - **Sony FX2 (Creators' App → streaming settings):** URL `srt://<server-ip>` (**nothing after the IP**), Port = the input's port,
     Encryption AES-128, Pass phrase = **Reveal**, ARC Off for recording tests, Video Codec MPEG-4/AVC.
   - Other SRT callers: `srt://<server-ip>:<port>?passphrase=<passphrase>` (stream ID not needed).
3. Start output on the camera. The card should show **Camera connected to relay** and then **Signal**.

**New passphrase** and **Remove** are under Camera setup. Changing a camera's port, latency or enabled state, its passphrase, or
removing it is refused while that input is recording.

## Record

- Set the **Shoot** (header) → files go to `<recordings>/<shoot>/<input>/`.
- Set a **Clip name** per card. The **take** auto-increments (`T001`, `T002`, …) per shoot + input + clip, and **Reset take** sets it back to 1.
- **Start/Stop** per card, or **Start all / Stop all**. Start all only starts inputs with signal.
- When a camera drops, OME ends that recording. Press Start again once the signal is back.

## Bitfocus Companion (v5)

1. Build the package: `cd companion-module && yarn install && yarn package` (Node 26, Yarn 4 via corepack)
   → `c2c-console-<version>.tgz`.
2. Companion → **Modules → Import module package** → pick the `.tgz`.
3. Add a connection **C2C Console**: host, port `3020`, API key = `C2C_API_KEY`.
4. Presets → *Recording*: REC toggle with tally per input, signal/format tile, reset take, REC ALL / STOP ALL,
   shoot name, "Shoot = today".

Daily naming example: *Set shoot* = `$(internal:date_y)-$(internal:date_m)-$(internal:date_d)_$(internal:custom_project)`,
then *Set clip name* (All inputs) = `$(internal:custom_segment)` per segment, then REC ALL / STOP ALL. Takes count up automatically.

Variables include `<input>_button_line` (`● T002 00:01:23` while recording, `next T003` when idle), `<input>_next_file`,
`<input>_rec_time`, `<input>_signal`, `shoot`, `recording_count`, `last_error`.

## Rotate secrets

| Secret | Where | How |
|---|---|---|
| Console password / API key | `.env` | Edit, then `docker compose up -d c2c-console`. Update Companion's API key |
| OME API token | `.env` `OME_API_TOKEN` (substituted into `Server.xml`) | Edit, then `docker compose up -d --force-recreate ovenmediaengine c2c-console`. This restarts OME: stop recordings first |
| Camera SRT passphrase | `data/inputs.json` | Console → Camera setup → **New passphrase**, then update the camera |

Use `docker compose up -d` (not `restart`) after editing `.env` so the containers get the new values.

## Diagnostics

- Did the camera send anything? `sudo tcpdump -i <iface> -nn 'udp port <input-port> and host <camera-ip>'`.
  Zero packets means the camera refused its own settings (for an FX2, usually a URL with anything after the host).
- What stream ID / encryption did it offer? Capture to a pcap and run `python3 -I tools/srt_handshake_sid.py file.pcap`.
- Make sure the source IP really is the camera. A forgotten VLC/ffplay preview retrying a read can look like a camera.
- Relay logs: `docker logs c2c-relay` (passphrases are redacted). Relay status: the console card, or `/status` on the relay's port 8090 (internal).

# DMZ relay host

Runs only `c2c-relay`, the public-facing SRT listener. Plan and reasoning: [`docs/DMZ_RELAY_PLAN.md`](../../docs/DMZ_RELAY_PLAN.md).

```
camera --AES SRT--> [DMZ host: c2c-relay :8897-8902/udp] --backhaul SRT (own passphrase)--> OvenMediaEngine
                          |                                                                  (internal host)
                          +-- polls GET /api/relay/inputs (read-only sync token) --> c2c-console (internal host)
```

The relay keeps **no** inputs file. The console is the single source of truth: enabling or disabling a
listener from the console, Companion or the API starts or stops that one relay on the next poll (about 2 s).
All listeners default **off**. If the console can't be reached, running listeners stay up; a freshly started
relay with no sync simply has nothing listening.

## One-time setup

**Internal host** (where the console and OvenMediaEngine run), in `deploy/.env`:

1. `C2C_SYNC_TOKEN` — a new secret, at least 32 chars, different from the console password and API key.
   It can read every camera passphrase, so treat it like the passphrases themselves.
2. `C2C_SYNC_ALLOWED_IPS` — the DMZ host's address, so a leaked token is useless from anywhere else.
3. `OME_BACKHAUL_BIND` — the internal host's own address on the interface the DMZ host reaches.
   Then start with the override that publishes OME's SRT backhaul on that one address only:
   `docker compose -f docker-compose.yml -f ome-backhaul.override.yml up -d`
4. Firewall (gateway or host): allow the DMZ host to reach **only** console `tcp/3020` and OME `udp/9999`.

**DMZ host**, in `deploy/dmz/`:

```bash
cp .env.example .env     # SYNC_URL, SYNC_TOKEN (= C2C_SYNC_TOKEN), OME_SRT_HOST, OME_SRT_PASSPHRASE
docker compose up -d --build
docker logs c2c-relay    # expect: "[manager] syncing from https://..."
```

`SYNC_URL` should be `https`. The response carries camera passphrases, and the relay refuses plain `http`
unless `SYNC_ALLOW_INSECURE_HTTP=1`. Only set that on a link you trust end to end.

## Check it

- Console: `GET /api/relay/inputs` with the sync token returns the input list; the same call with the API key or
  console login returns 403. The token itself gets 403 on every other route.
- Relay: `docker exec c2c-relay node -e "fetch('http://127.0.0.1:8090/status').then(r=>r.json()).then(console.log)"`
  shows `error: null` once syncing and lists only enabled inputs.
- The console audit log records each sync: `[audit] sync <ip> GET /api/relay/inputs`.

## Rotating the sync token

Change `C2C_SYNC_TOKEN` on the internal host and `SYNC_TOKEN` on the DMZ host, then recreate both containers
(`docker compose up -d`). Until both match, the relay logs `sync rejected: HTTP 401` and keeps running listeners.
Repeated wrong tokens trigger the console's normal login lockout for the DMZ host's address.

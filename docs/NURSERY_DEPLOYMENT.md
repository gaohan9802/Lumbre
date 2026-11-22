# Nursery deployment

Nursery is a private sidecar. It must share the app's Compose network, but it
must not publish port `8800` to the internet.

## Required secrets

Generate two unrelated random values of at least 32 characters:

- `NURSERY_BRIDGE_TOKEN`: app to Nursery authentication.
- `NURSERY_EVENT_TOKEN`: Nursery to app event authentication.

The app service needs:

```env
NURSERY_SERVICE_URL=http://nursery:8800
NURSERY_BRIDGE_TOKEN=...
NURSERY_EVENT_TOKEN=...
```

The Nursery service needs:

```env
NURSERY_BRIDGE_TOKEN=...
NURSERY_EVENT_TOKEN=...
NURSERY_EVENT_URL=http://app:3000/api/internal/nursery-events
NURSERY_TICK_SECONDS=300
TZ=Europe/Madrid
```

Do not set `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE`, or `PSYCHE_DS_MODEL`. The
Lumbre bridge also removes them before starting the engine, so the optional
psyche layer stays disabled.

## Compose service

Merge this service into the production Compose file. Keep the existing app
service name in `NURSERY_EVENT_URL` if it is not `app`.

```yaml
services:
  nursery:
    build:
      context: .
      dockerfile: services/Dockerfile.nursery
    restart: unless-stopped
    environment:
      NURSERY_BRIDGE_TOKEN: ${NURSERY_BRIDGE_TOKEN}
      NURSERY_EVENT_TOKEN: ${NURSERY_EVENT_TOKEN}
      NURSERY_EVENT_URL: http://app:3000/api/internal/nursery-events
      NURSERY_TICK_SECONDS: 300
      TZ: Europe/Madrid
    volumes:
      - /srv/lumbre/nursery:/data
      - /srv/lumbre/persistent/chat:/lumbre/chat:ro
```

There is intentionally no `ports:` entry. Before the first start, create the
only writable Nursery directory and give it to the image's unprivileged user:

```sh
sudo install -d -o 1001 -g 1001 -m 0700 /srv/lumbre/nursery
```

The chat mount is read-only. Nursery creates a short-lived sampled archive in
its own `/tmp`; it does not write into or copy Lumbre's canonical chat store.
Back up `/srv/lumbre/nursery` together with the normal Lumbre persistent data.

## Release check

After `docker compose up -d --build nursery app`:

```sh
docker compose ps nursery app
docker compose exec nursery python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8800/health').read().decode())"
docker compose logs --tail=100 nursery app
```

Open the Nursery room and create the child only after both services are
healthy. Re-running the release does not recreate the child; state lives in
`/srv/lumbre/nursery`.

Adding the single `nursery` tool changes Claude Code's exact tool-schema cache
prefix. Before normal chat resumes, run the existing silent cache warm for the
current CC window and confirm its warm-cache status is `warmed`. This absorbs
the one-time prefix rewrite without adding a fake chat turn; it does not change
the conversation id or Nursery state.

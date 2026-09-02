# Lumbre stage 0 safety baseline runbook

## Recorded baseline

- Baseline commit: `62948285f996207cbb33c09ec272e644157dc613`
- Stage branch: `codex/lumbre-00-safety-baseline`
- Workstation runtime on 2026-09-02: Node `v24.15.0`, npm `11.12.1`
- Application: Next.js 14 App Router, TypeScript, `output: 'standalone'`
- Locked installed versions are recorded in `package-lock.json`; a legacy
  `yarn.lock` also exists and should not be silently substituted during deploy.
- Repository deployment documentation says GitHub push triggers a Zeabur build.
  No Dockerfile or checked-in Zeabur configuration was present at the baseline.
- Production data defaults to `/persistent`; tests must always set `DATA_DIR` to
  a unique temporary directory.
- `npm run build` also injects a unique temporary `DATA_DIR`, because Next.js
  imports route modules while collecting build data and legacy stores perform
  initialization at module load. Runtime still uses the deployed `DATA_DIR`.

## Production backup and restore

The pre-stage production backup was captured on 2026-09-03 using Zeabur's
offline service backup flow: suspend the service, create the backup, download
it off-volume, then restart the service. The downloaded archive is kept outside
the Git repository at:

```text
/Users/gaohannatalia/Documents/ChatGPT/水獭大王/Lumbre-backups/2026-09-03.tar.gz
```

Its SHA-256 is recorded in the adjacent `2026-09-03.tar.gz.sha256` file. Local
verification successfully tested the gzip stream, unpacked the archive into an
isolated temporary directory, rejected unsafe archive paths, and parsed every
JSON/JSONL/BAK file. The archive contains 1,802 volume files, matching the
production `find /persistent -type f` count. In this particular Zeabur archive,
the restored `/persistent` root is the inner `data/data/` directory; the extra
outer JSON file is backup-tool metadata, not an application data file.

For a script-created backup, the application must likewise be put into
maintenance mode (or otherwise prevented from writing). On the production host:

```bash
node scripts/persistent-backup.mjs create \
  --source /persistent \
  --output /path/outside/persistent/lumbre-pre-refactor-2026-09-02
node scripts/persistent-backup.mjs verify \
  --backup /path/outside/persistent/lumbre-pre-refactor-2026-09-02
```

Copy that backup to storage independent of the Zeabur volume, then run `verify`
against the independent copy. A backup is not accepted until the SHA-256
inventory passes and all JSON/BAK files parse.

Restore procedure:

1. Stop all application instances and wake jobs.
2. Back up the current broken volume before overwriting it.
3. Verify the chosen backup again.
4. Restore the contents of its `data/` directory to an empty replacement data
   directory/volume.
5. Start one instance, run the manual read-only checks, then restore traffic.

## Sanitized test data

Create a sanitized copy only from the verified offline backup, never directly
from the live volume:

```bash
node scripts/sanitize-persistent.mjs \
  --source /path/to/verified-backup/data \
  --output /path/to/private-test-fixture
```

The sanitizer replaces secrets, credentials and all non-allowlisted string
values with deterministic placeholders, replaces URLs and embedded data images,
sanitizes unsafe filename components, skips non-JSON files, and fails closed on
malformed JSON. Review `sanitization-report.json` before using it. The repository
fixture is synthetic and contains no production data.

The verified production-derived copy created on 2026-09-03 is outside Git at:

```text
/Users/gaohannatalia/Documents/ChatGPT/水獭大王/Lumbre-backups/2026-09-03-sanitized
```

An upload-ready archive and adjacent SHA-256 file are also stored as
`2026-09-03-sanitized.tar.gz` and `2026-09-03-sanitized.tar.gz.sha256`.

It contains 1,183 parseable JSON/JSONL/BAK data files. The sanitizer explicitly
excluded 618 Markdown files and one database file because those formats cannot
be safely structure-preserving-sanitized by this script. They remain protected
inside the original offline backup and must not be used as test data.

## Galatea credential retirement

The Galatea MCP integration has been completely removed from Lumbre. The
credential previously embedded in Git history must still be treated as exposed.
The account owner confirmed on 2026-09-03 that it was revoked. No replacement
credential is needed. The stale `GALATEA_URL` and `GALATEA_TOKEN` values were
also removed from Zeabur.
Do not paste the old credential into an issue, chat, test fixture, or Git.

## Fast code rollback

The immutable rollback target is
`62948285f996207cbb33c09ec272e644157dc613`. Prefer redeploying that exact SHA or
reverting the stage commit; do not rewrite shared Git history. Rolling code back
does not roll data back. Restore data separately with the verified pre-stage
backup if and only if data changed.

## Manual smoke checklist

- [x] Production backup created, copied off-volume, verified, and dry-run extracted.
- [x] Old Galatea token revoked; stale Galatea variables removed from Zeabur.
- [ ] Production `/api/debug`, its children, and `/api/memory/breath-debug`
      return 404 for both authenticated and unauthenticated requests.
- [ ] Login succeeds with the configured password; logout invalidates the cookie.
- [ ] Ordinary chat returns text and streams without interruption.
- [ ] Create, read, and update a diary entry.
- [ ] View the photo wall and upload a harmless test image.
- [ ] Create, complete, and edit a todo item.
- [ ] Read and write one disposable memory.
- [ ] Send messages on phone and desktop and confirm both converge.
- [ ] Queue a message offline, reconnect, and confirm exactly one copy is saved.
- [ ] Trigger an unattended wake in preview and confirm deletion, email,
      email reply, and memory deletion via `trace` are absent/denied.
- [ ] Production build and preview deployment succeed.
- [ ] Rollback to the baseline SHA has been rehearsed without touching production data.

Do not begin the data-layer stage until every item above has evidence and the
user explicitly accepts this stage.

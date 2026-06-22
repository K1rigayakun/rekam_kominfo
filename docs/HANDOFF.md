# Professional Handoff Checklist

## Source Code

- Push source code to GitHub/GitLab. Do not send zip files.
- Keep `.gitignore` active before first commit.
- Do not commit `node_modules`, `.env`, build output, exported ZIP/PDF files, or local temp upload data.
- Current environment has no Git repository or remote configured, so pushing requires the project owner to provide/create the remote.

Suggested first commit:

```powershell
git init
git add .
git commit -m "handoff: prepare REKAM local implementation"
git remote add origin <REPO_URL>
git push -u origin main
```

## Documentation

- Main README: `README.md`
- Architecture and Mermaid diagrams: `docs/ARCHITECTURE.md`
- API spec: `docs/openapi.yaml`
- Original implementation references: `../Plan Awal/implementasi_local.md` and `../Plan Awal/implementasi_realserver.md`

## Environment And Credentials

- Copy `.env.example` to `.env`.
- Copy `apps/backend/.env.example` to `apps/backend/.env`.
- Copy `apps/web/.env.example` to `apps/web/.env`.
- Replace every `CHANGE_ME` and placeholder.
- Store production credentials in Bitwarden, 1Password, Vault, or another approved secret manager.
- Never send real credentials through regular chat.

Third party/local services:

- PostgreSQL 15: database.
- Redis 7: refresh token, lockout login, BullMQ queues.
- MinIO: private object storage.
- FFmpeg/FFprobe: video metadata/transcode workflow.
- Optional DuckDNS/Cloudflare Tunnel/Nginx: public QR PoC access.

## Database

- Migration runner: `npm run db:migrate`
- Check schema: `npm run db:check`
- Seed dummy data: `npm run db:seed`
- Migration files: `apps/backend/src/migrations/*.sql`
- Seed file: `apps/backend/src/seeds/seed.ts`

When changing a table:

1. Add a new numbered migration.
2. Update the relevant route/query.
3. Update `docs/ARCHITECTURE.md` ERD if the core domain changed.
4. Run backend build and migration check.

## API

`docs/openapi.yaml` contains the handoff OpenAPI spec. It is currently maintained manually. If this goes to production, integrate `@fastify/swagger` so the spec follows route schemas automatically.

## Deployment Guide Summary

For local LAN replacement server:

1. Run Docker Compose for PostgreSQL, Redis, and MinIO.
2. Run backend on `0.0.0.0:3000`.
3. Run frontend on `0.0.0.0:5173`.
4. Open frontend from other devices with `http://<SERVER_LAN_IP>:5173`.

For real server:

1. Follow `../sampah/Plan Awal/implementasi_realserver.md`.
2. Use Ubuntu Server 22.04 LTS.
3. Run app through PM2 behind Nginx.
4. Keep PostgreSQL, Redis, and MinIO bound to localhost/private network.
5. Enable SSL, UFW, fail2ban, backup, monitoring, and log rotation.

For desktop app:

1. App uses Tauri, React, and `tus-js-client`.
2. `npm run tauri build` to compile the Windows executable.
3. Includes SQLite queue, parallel chunks uploading, MB/s speed monitor, and batch activity creation.

Minimum production baseline:

- 4 CPU cores.
- 16 GB RAM.
- SSD for OS/PostgreSQL.
- Large HDD/NAS volume for MinIO.
- Stable uplink sized for public QR downloads.

## Maintenance Rules

- Add inline comments only around non-obvious logic, especially auth, upload streaming, archive/delete, and version restore.
- Keep naming explicit. Prefer `district_id` for event district and avoid overloading it with creator district.
- Do not expose MinIO URLs publicly.
- Keep audit log append-only.
- Hard delete activity must remain SUPER_ADMIN-only.
- Any endpoint that streams files must validate authorization before reading MinIO.

## Known Gaps To Continue

- Media processing queue must be tested with real large videos before production.
- Public quality selector depends on processed quality variants being reliably generated.
- OpenAPI is manual and should be auto-generated before production.

# REKAM

REKAM adalah platform manajemen dokumentasi kegiatan Kominfo: upload media, pengelompokan acara per kecamatan, lampiran, QR sharing selektif, audit log, export, dan halaman publik.

## Quick Start Local

Prerequisite:

- Node.js 20 LTS atau 22 LTS
- npm 10+
- Docker Desktop
- FFmpeg tersedia di PATH jika fitur video processing dipakai

Setup dari clone baru:

```powershell
git clone <REPO_URL> rekam
cd rekam
Copy-Item .env.example .env
Copy-Item apps/backend/.env.example apps/backend/.env
Copy-Item apps/web/.env.example apps/web/.env
```

Isi semua `CHANGE_ME` dan placeholder di `.env` serta `apps/backend/.env`. Jangan commit file `.env`.

Install dependency:

```powershell
npm run install:all
```

Jalankan service infrastruktur:

```powershell
npm run dev:infra
```

Migration dan seed:

```powershell
npm run db:migrate
npm run db:seed
npm run db:check
```

Jalankan backend dan frontend:

```powershell
npm run dev
```

Frontend akan berjalan di `http://localhost:5173`. Untuk akses dari perangkat lain dalam LAN, gunakan Network URL dari Vite, biasanya `http://<IP_LAN>:5173`. Backend listen di `0.0.0.0:3000`, jadi frontend dari perangkat lain akan otomatis memakai hostname browser dan port `3000` jika `VITE_API_BASE_URL` dikosongkan atau disesuaikan.

## Tech Stack

- Web: React 19, Vite 8, TypeScript 6, Tailwind CSS 4, Motion, Anime.js, Zustand, Axios, TipTap, dnd-kit, Sonner
- Backend: Node.js 20+, Fastify 5, TypeScript 5, PostgreSQL 15, Redis 7, MinIO, BullMQ, tus server, PDFKit, Archiver, Sharp, FFmpeg integration
- Local infra: Docker Compose for PostgreSQL, Redis, MinIO

## Folder Structure

```text
rekam/
  apps/
    backend/      Fastify API, migrations, seed, queue workers
    web/          React/Vite frontend
  docs/           Handoff, architecture diagrams, API docs, maintenance notes
  scripts/        Local developer scripts
  docker-compose.yml
```

Architecture level tinggi:

- Frontend menyimpan access token pendek dan mengirim request via Axios.
- Refresh token disimpan server sebagai HttpOnly cookie dan di Redis.
- Backend melakukan validasi role, audit log, streaming file, export, dan public QR access.
- MinIO bucket harus private. File tidak boleh diekspos langsung, hanya lewat API.

Lihat diagram Mermaid di [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) dan gap terbaru di [docs/GAP_ANALYSIS.md](docs/GAP_ANALYSIS.md).

## Environment And Third Party Services

File contoh:

- `.env.example` untuk Docker Compose lokal
- `apps/backend/.env.example` untuk API
- `apps/web/.env.example` untuk frontend

Service eksternal/lokal yang dipakai:

- PostgreSQL: database utama
- Redis: refresh token, lockout login, queue backend
- MinIO: object storage private untuk raw media, processed media, attachments, exports
- FFmpeg/FFprobe: processing video
- Optional Cloudflare Tunnel atau DuckDNS/Nginx: akses QR dari luar jaringan pada mode PoC

Credential asli wajib dikirim lewat password manager atau channel aman, bukan chat biasa.

## Database

Migration ada di `apps/backend/src/migrations`. Seed awal ada di `apps/backend/src/seeds/seed.ts`.

Core ERD tersedia di [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Setelah mengubah schema:

```powershell
npm run db:migrate
npm run db:check
```

## API Documentation

OpenAPI spec tersedia di [docs/openapi.yaml](docs/openapi.yaml). Jika route backend berubah, update file ini di commit yang sama.

## Build Production

```powershell
npm run build
```

Output:

- Backend: `apps/backend/dist`
- Frontend: `apps/web/dist`

Untuk production on-premise, ikuti dokumen asli `../Plan Awal/implementasi_realserver.md` dan catatan handoff di [docs/HANDOFF.md](docs/HANDOFF.md).

Minimum server recommendation untuk single server awal:

- CPU: 4 core
- RAM: 16 GB
- Storage: SSD untuk OS/database, HDD/NAS terpisah untuk MinIO media
- OS: Ubuntu Server 22.04 LTS
- Runtime: Node.js 20 LTS, PostgreSQL 15, Redis 7, MinIO, Nginx, PM2

Ports:

- Web dev: 5173
- Backend API: 3000
- PostgreSQL: 5432
- Redis: 6379
- MinIO API: 9000
- MinIO Console: 9001

## Known Issues And Limitations

- Desktop app/Tauri camera offload belum ada di repo ini. Lihat [docs/HANDOFF.md](docs/HANDOFF.md) untuk scope implementasi berikutnya.
- Media processing pipeline FFmpeg/Sharp masih perlu diverifikasi end-to-end dengan file video besar.
- Background export queue belum sepenuhnya async untuk semua export.
- OpenAPI spec masih manual. Jika ingin auto-generate, integrasikan schema Fastify dengan `@fastify/swagger`.
- Gap terbaru terhadap Plan Awal diringkas di [docs/GAP_ANALYSIS.md](docs/GAP_ANALYSIS.md).

## Git Handoff

Project ini harus dipush ke GitHub/GitLab, bukan dikirim sebagai zip. Repository lokal belum memiliki remote di environment ini, jadi developer harus menjalankan:

```powershell
git init
git add .
git commit -m "handoff: prepare REKAM local implementation"
git remote add origin <REPO_URL>
git push -u origin main
```

Pastikan `node_modules`, `.env`, file export, dan build output tidak masuk commit.

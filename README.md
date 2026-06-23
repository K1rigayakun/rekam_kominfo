# REKAM - Platform Manajemen Dokumentasi Kominfo

REKAM adalah platform tingkat *Enterprise* untuk manajemen dokumentasi kegiatan Kominfo. Platform ini mencakup pengelolaan upload media, pengelompokan acara per kecamatan, lampiran, QR sharing selektif, audit log, export, dan halaman publik.

Dokumen ini merupakan panduan lengkap yang mencakup **Deployment (Infrastruktur)**, **Pengembangan (Development)**, dan **Maintenance**.

---

# 🏢 BAGIAN 1: ENTERPRISE DEPLOYMENT & HANDOVER
**Ditujukan Untuk**: Tim DevOps, System Administrator, IT Infrastructure  

## 1.1 Pendahuluan & Topologi Jaringan
Aplikasi dibangun menggunakan arsitektur *Monorepo* yang memisahkan beban kerja antara Backend API, Front-End Internal (Admin), dan Front-End Eksternal (Instansi Luar). 

Untuk memastikan aplikasi ini **TIDAK MENGHAMBAT JARINGAN LOKAL** perusahaan meskipun diserang trafik tinggi, kami telah menyiapkan arsitektur *Offloading*:
1. **Cloudflare Tunnel (Wajib digunakan)**: Menjadikan server offline menjadi online tanpa harus membuka port di Router/Firewall kantor. Cloudflare akan bertindak sebagai *Global CDN* sehingga file statis web (HTML, CSS, JS) akan di-cache di server Cloudflare luar negeri/lokal, bukan membebani bandwidth kantor Anda.
2. **Nginx Reverse Proxy dengan Rate Limiting**: Memblokir serangan bot (DDoS) secara langsung dari server.
3. **Chunked Upload (Tus Protocol)**: Upload file bergiga-giga tidak akan membuat server nge-hang karena file dikirim dalam potongan kecil (chunk).

## 1.2 Standar Instalasi (All-in-One Automation)
Kami menyarankan penggunaan **Docker** untuk instalasi *Database, Redis, dan MinIO* agar environment bersih dan tidak merusak server host.

### 🧰 A. Setup Infrastruktur Data (1 Menit)
Jalankan file `docker-compose.yml` yang sudah kami sediakan di root folder. File ini otomatis menginstal PostgreSQL 15, Redis 7 (Max 1GB RAM), dan MinIO beserta 4 bucket otomatis.
```bash
cd /opt/rekam
docker-compose up -d
```

### 🧰 B. Setup Aplikasi Node.js (Aplikasi REKAM)
Salin konfigurasi production ke masing-masing environment:
```bash
cp apps/backend/.env.production apps/backend/.env
cp apps/web/.env.production apps/web/.env
cp apps/media-web/.env.production apps/media-web/.env
```
Gunakan *script* otomatis yang telah disediakan untuk *build* dan *run*:
```bash
chmod +x deploy-helper.sh
./deploy-helper.sh
```
*Script ini akan mem-build semua frontend, backend, menjalankan migrasi database, dan menyalakan aplikasi 24/7 menggunakan PM2 Process Manager.*

## 1.3 Pengaturan Jaringan & Nginx (Kritikal)
File `rekam_nginx.conf` telah dibuat dengan standar *Enterprise* dan telah mempertimbangkan **Network Performance**. Anda wajib menyalin file tersebut ke Nginx:
```bash
sudo cp rekam_nginx.conf /etc/nginx/sites-available/rekam
sudo ln -s /etc/nginx/sites-available/rekam /etc/nginx/sites-enabled/
sudo systemctl reload nginx
```

## 1.4 Akses Server via Internet (Tanpa Buka Port)
1. Login ke [Cloudflare Zero Trust](https://one.dash.cloudflare.com/).
2. Pilih **Networks > Tunnels** -> Create a Tunnel.
3. Install konektor di server Ubuntu Anda sesuai perintah yang muncul.
4. Pada tab **Public Hostname**, tambahkan rute:
   - `rekam.namakantor.go.id` -> arahkan ke `http://localhost:80`
   - `media.rekam.namakantor.go.id` -> arahkan ke `http://localhost:80`
5. Website sudah online dengan HTTPS, dilindungi WAF (Web Application Firewall) Cloudflare, dan menggunakan bandwidth Cloudflare untuk caching UI.

## 1.5 Credentials & Environment Production
Semua kata sandi, token JWT, dan konfigurasi API berada di:
- `apps/backend/.env.production`
- `apps/web/.env.production`
- `apps/media-web/.env.production`

> [!WARNING]
> Ganti `JWT_ACCESS_SECRET` serta `GANTI_PASSWORD` pada string Database dan MinIO untuk mencegah kebocoran data sebelum rilis ke publik.

---

# 🛠️ BAGIAN 2: PENGEMBANGAN (DEVELOPMENT GUIDE)
**Ditujukan Untuk**: Software Engineer / Developer  

## 2.1 Tech Stack
- **Web (Frontend)**: React 19, Vite 8, TypeScript, Tailwind CSS 4, Motion, Zustand, Axios, TipTap.
- **Backend**: Node.js 20+, Fastify 5, TypeScript 5, PostgreSQL 15, Redis 7, MinIO, BullMQ, tus server, FFmpeg.

## 2.2 Quick Start Local
Pastikan Anda memiliki Node.js 20/22 LTS, npm 10+, Docker Desktop, dan FFmpeg.

```bash
# Clone & Install
git clone <REPO_URL> rekam
cd rekam
npm run install:all

# Siapkan environment variables (isi CHANGE_ME)
cp .env.example .env
cp apps/backend/.env.example apps/backend/.env
cp apps/web/.env.example apps/web/.env

# Jalankan infrastruktur lokal (Database, Redis, Minio)
npm run dev:infra

# Jalankan Migrasi dan Seed
npm run db:migrate
npm run db:seed
npm run db:check

# Jalankan server Frontend & Backend mode Development
npm run dev
```

## 2.3 Folder Structure
```text
rekam/
  apps/
    backend/      Fastify API, migrations, seed, queue workers
    web/          React/Vite frontend (Admin)
    media-web/    React/Vite frontend (Instansi Media Luar)
  docs/           Arsitektur, OpenAPI, Handoff
  scripts/        Local developer scripts
  docker-compose.yml
```

---

# 🔧 BAGIAN 3: MAINTENANCE & TROUBLESHOOTING
**Ditujukan Untuk**: Tim Developer & IT Support  

## 3.1 Troubleshooting Umum

- **QR Code mengarah ke IP Localhost**:
  Pastikan Anda mengakses web menggunakan IP Address server atau Domain, bukan `localhost`. Jika terpaksa, pastikan `PUBLIC_BASE_URL` di `apps/backend/.env` sudah diisi dengan domain yang benar. Sistem QR sudah dibuat sangat dinamis membaca request host.
  
- **Video Lama Diproses / Macet**:
  Pastikan `ffmpeg` sudah terinstal di server (`ffmpeg -version`). Cek log pemrosesan dengan perintah `pm2 logs rekam-api`.

- **Gagal Upload File Besar**:
  Nginx secara default membatasi ukuran file. Blok Nginx `rekam_nginx.conf` harus memiliki `client_max_body_size 0;` (unlimited) karena aplikasi ini menggunakan protokol *tus* (chunked upload).

## 3.2 Mengubah Skema Database
Jika Anda melakukan perubahan pada entitas atau relasi database, Anda harus membuat migrasi baru:
```bash
cd apps/backend
npm run db:migrate
npm run db:check
```

## 3.3 Git Handoff (Menyimpan Pekerjaan)
Project ini harus dipush ke GitHub/GitLab:
```bash
git init
git add .
git commit -m "handoff: prepare REKAM enterprise architecture"
git remote add origin <REPO_URL>
git push -u origin main
```
Pastikan `node_modules`, `.env` lokal, dan file sampah tidak masuk ke commit.

---
**Hak Cipta © Tim REKAM Kominfo.**

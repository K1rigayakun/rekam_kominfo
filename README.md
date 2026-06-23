# REKAM - Platform Manajemen Dokumentasi Kominfo

REKAM adalah platform tingkat *Enterprise* untuk manajemen dokumentasi kegiatan Kominfo. Platform ini mencakup pengelolaan upload media, pengelompokan acara per kecamatan, lampiran, QR sharing selektif, audit log, export, dan halaman publik.

Dokumen ini merupakan panduan lengkap yang diurutkan mulai dari persiapan **Development (Lokal)**, **Struktur Arsitektur**, **Deployment Server Production**, hingga **Maintenance**.

---

# 🚀 1. PENDAHULUAN & TECH STACK

- **Web Admin (Internal)**: React 19, Vite 8, TypeScript, Tailwind CSS 4, Motion, Zustand.
- **Web Media (Eksternal)**: React 19, Vite 8, TypeScript, Tailwind CSS 4.
- **Backend API**: Node.js 20+, Fastify 5, TypeScript 5, BullMQ (Queue).
- **Infrastruktur Data**: PostgreSQL 15, Redis 7, MinIO (Object Storage S3-compatible).
- **Proses Media**: tus server (Upload chunking raksasa), FFmpeg (Pemrosesan Video).

---

# 💻 2. PENGEMBANGAN LOKAL (QUICK START)
**Ditujukan Untuk**: Software Engineer / Developer (Mencoba di Laptop/PC Pribadi)

Pastikan Anda telah menginstal **Node.js 20/22 LTS**, **npm 10+**, **Docker Desktop**, dan **FFmpeg** (masuk ke dalam system PATH).

### Langkah 1: Clone & Install
```bash
git clone https://github.com/K1rigayakun/rekam_kominfo.git rekam
cd rekam
npm run install:all
```

### Langkah 2: Setup Environment Variables
Salin file template environment ke nama aslinya (kemudian buka dan ganti yang perlu diubah, misalnya password):
```bash
cp .env.example .env
cp apps/backend/.env.example apps/backend/.env
cp apps/web/.env.example apps/web/.env
cp apps/media-web/.env.example apps/media-web/.env
```

### Langkah 3: Menjalankan Database & Infrastruktur (Via Docker)
```bash
# Menyalakan PostgreSQL, Redis, dan MinIO di belakang layar
npm run dev:infra
```

### Langkah 4: Migrasi Database & Bikin Admin Pertama
```bash
npm run db:migrate
cd apps/backend && npm run db:init-admin
```

### Langkah 5: Menjalankan Aplikasi (Mode Development)
```bash
# Menjalankan Backend API dan Frontend secara bersamaan
npm run dev
```
Aplikasi bisa langsung dibuka di browser melalui link yang muncul di terminal (biasanya `http://localhost:5173` untuk web admin).

---

# 📂 3. STRUKTUR APLIKASI
```text
rekam/
  apps/
    backend/      Fastify API, migrations, seed, queue workers
    web/          React/Vite frontend (Admin Kominfo)
    media-web/    React/Vite frontend (Instansi Media Luar)
  docs/           Dokumentasi mendalam, OpenAPI, Maintenance Guide
  scripts/        Local developer scripts
  docker-compose.yml
```

> [!NOTE]
> Untuk panduan *Maintenance Kode*, *Troubleshooting Error*, dan bagaimana Pemrosesan Video serta Arsitektur Backend bekerja, silakan buka file **`docs/MAINTENANCE_GUIDE.md`**.

---

# 🏢 4. DEPLOYMENT SERVER (ENTERPRISE HANDOVER)
**Ditujukan Untuk**: Tim DevOps, System Administrator, IT Infrastructure (Setup ke Server Asli)

### A. Persiapan Infrastruktur Data (Production)
Jalankan file `docker-compose.yml` di server asli. File ini otomatis membatasi penggunaan RAM (Redis Max 1GB) dan menyiapkan MinIO (4 Bucket).
```bash
cd /opt/rekam
docker-compose up -d
```

### B. Konfigurasi Environment Production
Salin file konfigurasi `.env.production` (yang sudah ada di repo) menjadi `.env` asli:
```bash
cp apps/backend/.env.production apps/backend/.env
cp apps/web/.env.production apps/web/.env
cp apps/media-web/.env.production apps/media-web/.env
```
*(Wajib buka `apps/backend/.env` dan ubah JWT Secret serta password database sebelum go-live!)*

### C. Build & Run (Node.js & PM2)
Gunakan script robot otomatis yang sudah kami siapkan:
```bash
chmod +x deploy-helper.sh
./deploy-helper.sh
```
Script di atas akan mem-build semua frontend, menjalankan migrasi database production, dan menyalakan PM2 Process Manager 24/7.

### D. Pengaturan Jaringan, Keamanan, & Nginx
Sistem kami telah disiapkan dengan fitur *Rate Limiting* (Anti Spam) dan *Chunked Upload* (Upload file besar tanpa *hang*). Salin konfigurasi profesional kami ke Nginx server Anda:
```bash
sudo cp rekam_nginx.conf /etc/nginx/sites-available/rekam
sudo ln -s /etc/nginx/sites-available/rekam /etc/nginx/sites-enabled/
sudo systemctl reload nginx
```

### E. Expose ke Internet Tanpa Buka Port Router (Opsi Paling Aman)
Agar aplikasi yang ada di jaringan offline kantor bisa diakses siapa saja lewat domain:
1. Login ke [Cloudflare Zero Trust](https://one.dash.cloudflare.com/).
2. Buat Tunnel baru (Networks > Tunnels).
3. Install konektor di server Ubuntu Anda.
4. Hubungkan rute `rekam.namakantor.go.id` dan `media.rekam.namakantor.go.id` ke `http://localhost:80`.

---

# 🔧 5. TROUBLESHOOTING UMUM (FAQ)

- **QR Code Mengarah ke Localhost?**
  Akses aplikasi via IP server atau domain, bukan `localhost`. QR Code dibuat dinamis mengikuti URL yang dibuka oleh pengguna. Untuk mengunci domain publik permanen, isi variabel `PUBLIC_BASE_URL` di `apps/backend/.env`.
  
- **Video Terus-Terusan Status "Processing"?**
  Pastikan `ffmpeg` terinstal di sistem Ubuntu/Windows server (`ffmpeg -version`). Cek masalahnya lewat perintah `pm2 logs rekam-api`.
  
- **Upload File Besar Gagal (HTTP 413)?**
  Nginx secara default membatasi ukuran. Pastikan block `server {}` Nginx Anda memiliki perintah `client_max_body_size 0;` (unlimited) sesuai dengan file `rekam_nginx.conf` yang kami berikan.

---
**Hak Cipta © Tim REKAM Kominfo.**

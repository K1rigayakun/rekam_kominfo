# 🛠️ Panduan Maintenance & Pengembangan (Developer Guide)

Dokumen ini adalah "Peta Navigasi" bagi Software Engineer / Developer yang akan melakukan *maintenance*, *debugging*, atau menambah fitur baru di aplikasi **REKAM**.

---

## 🏗️ 1. Pola Arsitektur Backend (Fastify)

Backend REKAM dibangun menggunakan framework **Fastify** (bukan Express) karena performanya yang sangat cepat. Seluruh *logic* dibagi berdasarkan modul-modul (Domain-Driven Design).

### Struktur Folder Utama `apps/backend/src`
- `config/`: Konfigurasi environment variables, database, minio, redis.
- `db/`: Skema migrasi SQL murni (direktori `migrations`). Tidak memakai ORM kompleks (seperti Prisma) untuk menjaga performa. Semua query dieksekusi via `pg` pool murni.
- `middlewares/`: Fungsi interceptor, contohnya `requireAuth.ts` untuk verifikasi token JWT dan `requireRole.ts` untuk membatasi hak akses (contoh: hanya Admin).
- `modules/`: Jantung aplikasi. Setiap entitas (users, activities, sharing) memiliki foldernya sendiri.
  - `[nama].routes.ts`: Definisi API endpoint (GET, POST, PUT, DELETE).
  - `[nama].controller.ts` (opsional): Logic bisnis utama.
- `plugins/`: Integrasi eksternal (Fastify Multipart, Tus protocol, BullMQ).

### Panduan Menambahkan Fitur API Baru
1. Buat folder baru di `src/modules/fitur_baru/`.
2. Buat file `fitur_baru.routes.ts`.
3. Daftarkan routes tersebut di `src/server.ts` pada bagian `fastify.register`.
4. Jika membutuhkan tabel database baru, buat file migrasi di `src/migrations/`.

---

## 🎨 2. Pola Arsitektur Frontend (React + Vite)

Terdapat dua aplikasi frontend:
- `apps/web`: Digunakan oleh Admin dan Operator Kominfo.
- `apps/media-web`: Digunakan oleh Instansi Media Luar.

### Struktur Folder `apps/web/src`
- `components/`: Komponen UI yang dapat digunakan berulang (Button, Modal, Layout).
- `pages/`: Komponen utama yang merepresentasikan satu halaman URL.
- `stores/`: Manajemen state global menggunakan **Zustand**. Contoh `authStore.ts` untuk menyimpan status login user.
- `lib/`: Fungsi utilitas (Axios instance, format tanggal, helper).
- `assets/`: Gambar statis, logo.

### Alur Komunikasi Frontend ke Backend
- Komunikasi menggunakan **Axios** (terletak di `src/lib/api.ts`).
- Terdapat **Axios Interceptor** yang otomatis menempelkan `Authorization: Bearer <token>` pada setiap request.
- Jika token *expired* (401), Interceptor akan diam-diam mengirim request `/api/auth/refresh` untuk mengambil token baru dan mengulang request asal tanpa me-*logout* user (Seamless Refresh Token Flow).

---

## 🗄️ 3. Manajemen Database & Migrasi

Aplikasi ini menggunakan migrasi manual dengan SQL script.
- **Letak file**: `apps/backend/src/migrations/`
- **Aturan penamaan**: Harus diawali dengan urutan tiga digit nomor, contoh: `015_tambah_kolom_baru.sql`.

### Cara Menambah Tabel/Kolom Baru:
1. Buat file SQL baru di dalam folder migrations.
2. Tulis perintah DDL standar: `ALTER TABLE ... ADD COLUMN ...;`
3. Jalankan script migrasi:
   ```bash
   cd apps/backend
   npm run db:migrate
   ```
Sistem `db:migrate` akan membaca tabel internal `migrations` di PostgreSQL. File yang sudah pernah dijalankan tidak akan dieksekusi dua kali.

---

## 🎥 4. Pemrosesan Video & BullMQ

Aplikasi REKAM dapat menerima file media bergiga-giga. Pemrosesan file ini **TIDAK** dilakukan langsung di API utama karena akan menyebabkan server hang (*blocking*).

### Alurnya:
1. File mentah diupload melalui protokol **TUS** ke `MinIO` (Bucket: `rekam-raw`).
2. Setelah file utuh, backend menaruh pesan/tugas ke **Redis BullMQ** (`media_processing_queue`).
3. Proses utama Fastify langsung memberikan respon `200 OK` ke frontend.
4. Di *background*, worker BullMQ mengambil tugas tersebut, mendownload file, lalu menjalakan `FFmpeg` untuk mengompresi ukuran video/mengganti resolusi (jika perlu).
5. Hasil kompresi diupload kembali ke MinIO (Bucket: `rekam-processed`), lalu status database diubah menjadi `COMPLETED`.

**Tips Maintenance**: Jika ada komplain "Video macet di status PROCESSING", Anda harus mengecek log worker dengan cara:
```bash
pm2 logs rekam-api
```
Atau periksa apakah RAM habis digunakan oleh proses FFmpeg. Anda bisa membatasi maksimal video yang dikompresi berbarengan dengan mengubah variabel `.env`:
`MEDIA_PROCESSING_CONCURRENCY=2`

---

## 🔑 5. Sistem Sharing & Token Akses (QR Code)

Ketika pengguna memilih untuk membagikan (Share) sebuah aktivitas, sistem akan membuat *Snapshot* data saat itu juga.
- Data disimpan di tabel `sharing_snapshots`.
- Sistem menghasilkan `token` unik sepanjang 32 karakter.
- URL Publik dihasilkan (contoh: `https://rekam.kominfo.co.id/share/TOKEN_ACAK_123`).
- **Penting**: Halaman `/share/:token` dilindungi dan tidak menampilkan informasi rahasia. User publik tidak bisa mengedit data, hanya melihat/mendownload sesuai *snapshot*.

---

## 🐛 6. Checklist Debugging Cepat

Jika server terjadi error, periksa hal-hal berikut secara berurutan:
1. **Nginx 502 Bad Gateway**:
   Artinya Nginx hidup, tapi Node.js (PM2) mati. Jalankan `pm2 status`. Jika statusnya *errored*, jalankan `pm2 logs` untuk melihat pesan error merahnya.
2. **MinIO Signature Mismatch / S3 Error**:
   Biasanya terjadi kalau jam/waktu di server tidak tersinkronisasi (NTP mati), atau kredensial `MINIO_SECRET_KEY` di `.env` frontend/backend tidak cocok.
3. **Redis Connection Refused**:
   Aplikasi gagal konek ke antrean. Pastikan Redis server berjalan (`systemctl status redis` atau `docker ps`).
4. **Token Expired Terus Menerus (Logout Otomatis)**:
   Pastikan jam di server frontend dan backend sinkron, dan pastikan file `apps/backend/.env.production` memiliki nilai rahasia `JWT_ACCESS_SECRET` yang valid.

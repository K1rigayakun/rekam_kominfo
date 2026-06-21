# Gap Analysis — Plan Awal vs Implementasi Aktual

> Audit dilakukan 21 Juni 2026 dengan membandingkan setiap modul di `Plan Awal/fitur.md`,
> `Plan Awal/requirements.md`, dan `Plan Awal/overview.md` terhadap source code aktual di
> `apps/backend` dan `apps/web`.

---

## RINGKASAN EKSEKUTIF

| Kategori | Jumlah |
| --- | --- |
| BUG KRITIS (bisa merusak sistem) | 7 |
| Fitur WAJIB belum diimplementasi | 14 |
| Fitur SEBAIKNYA belum diimplementasi | 5 |
| Fitur sudah lengkap / sesuai Plan | 28 |

---

## BAGIAN A — BUG KRITIS (Harus Diperbaiki Segera)

Bug berikut sudah ada di codebase dan **akan menyebabkan error atau kerusakan data** jika tidak diperbaiki.

### A1 — `@fastify/multipart` Tidak Didaftarkan di Server

| | |
| --- | --- |
| **File** | `apps/backend/src/server.ts` |
| **Dampak** | `request.file()` di `media.routes.ts` dan `attachment.routes.ts` GAGAL saat runtime. Upload media dan lampiran via web **tidak berfungsi**. |
| **Penyebab** | File `media.routes.ts` dan `attachment.routes.ts` melakukan `import '@fastify/multipart'` (hanya untuk type augmentation), tetapi plugin `@fastify/multipart` **tidak pernah di-register** dengan `server.register(multipart)` di `server.ts`. |
| **Solusi** | Tambahkan `import multipart from '@fastify/multipart'` dan `await server.register(multipart, { limits: { fileSize: ... } })` di `server.ts` **sebelum** route di-register. |

### A2 — SHA-256 Tidak Dihitung pada Upload Multipart

| | |
| --- | --- |
| **File** | `apps/backend/src/modules/media/media.routes.ts` baris 189–258 |
| **Dampak** | File yang diupload via web UI **tidak memiliki `checksum_sha256`** di database. Integrity checker (`integrity_checker.ts`) tidak bisa memvalidasi file tersebut karena kolom `checksum_sha256` kosong. |
| **Ref Plan** | `FR-MED-12`: "SHA-256 hash dihitung dan disimpan sebelum sistem mengirim respons 201 Created" — **WAJIB** |
| **Solusi** | Hitung SHA-256 dari `fileBuffer` sebelum INSERT ke database. TUS upload path (`tus.routes.ts`) sudah melakukan ini dengan benar — salin logikanya. |

### A3 — IP Address Publik Disimpan Tanpa Hashing

| | |
| --- | --- |
| **File** | `apps/backend/src/modules/public/public.routes.ts` baris 40–43 |
| **Dampak** | IP address pengunjung QR disimpan mentah di tabel `qr_scan_logs`. Ini **melanggar prinsip UU PDP 2022** yang disyaratkan di Plan. |
| **Ref Plan** | `FR-SEC2-07`: "Scan QR di-log dengan IP ter-hash (SHA-1) untuk compliance UU PDP 2022" — **WAJIB** |
| **Solusi** | Ganti `request.ip` dengan `crypto.createHash('sha1').update(request.ip).digest('hex')` sebelum INSERT ke `qr_scan_logs`. |

### A4 — Public Attachment Download Tidak Mengirim Response Body

| | |
| --- | --- |
| **File** | `apps/backend/src/modules/public/public.routes.ts` baris 233–280 |
| **Dampak** | Route `GET /p/:token/attachments/:id/download` menyiapkan header dan stream, tapi **tidak ada `return reply.send(stream)`**. Request akan hang tanpa batas waktu. |
| **Solusi** | Tambahkan `return reply.send(stream)` setelah baris 279. |

### A5 — Worker Media Processing Tidak Ada Retry & Concurrency Limit

| | |
| --- | --- |
| **File** | `apps/backend/src/queues/media_processor.ts` baris 208–228 |
| **Dampak** | (1) Jika FFmpeg gagal, job langsung `ERROR` tanpa retry. Plan mewajibkan 3x retry otomatis. (2) Tidak ada `concurrency` limit — semua job FFmpeg bisa berjalan paralel dan membuat CPU spike / crash server. |
| **Ref Plan** | `NFR-REL-03`: "Background job di-retry otomatis hingga 3x jika gagal" — **WAJIB**. `NFR-SCALE-04`: "Bull queue mencegah CPU spike FFmpeg dengan membatasi max 2 job paralel" — **WAJIB**. |
| **Solusi** | Tambahkan `{ concurrency: 2 }` pada Worker constructor dan tambahkan `attempts: 3, backoff: { type: 'exponential', delay: 5000 }` pada saat `mediaQueue.add()`. |

### A6 — Export PDF & ZIP Berjalan Synchronous (Bukan Background Job)

| | |
| --- | --- |
| **File** | `apps/backend/src/modules/export/export.routes.ts` |
| **Dampak** | PDF dan ZIP dihasilkan secara synchronous di thread request. Untuk acara dengan ratusan foto, ini akan menyebabkan **request timeout** dan memblokir event loop Fastify, membuat server tidak responsif untuk user lain. |
| **Ref Plan** | `FR-EXP-01`/`FR-EXP-03`: "PDF di-generate sebagai background job; user mendapat notifikasi saat selesai" — **WAJIB**. `FR-EXP-04`: "File export otomatis dihapus dari server setelah 24 jam" — **WAJIB**. |
| **Solusi** | Buat BullMQ queue `export-processing`. Route hanya menambahkan job dan mengembalikan `job_id`. Frontend polling status sampai selesai, lalu download via URL sementara. Tambahkan cleanup cron job untuk TTL 24 jam. |

### A7 — VIEWER Role Dihapus Dari Sistem (DIBATALKAN)

| | |
| --- | --- |
| **File** | `apps/backend/src/migrations/004_fix_section_nullable_remove_viewer.sql` |
| **Dampak** | Plan Awal mendefinisikan 3 role: `SUPER_ADMIN`, `EDITOR`, `VIEWER`. Migration 004 menghapus VIEWER sepenuhnya. |
| **Ref Plan** | `FR-AUTH-04`: "Sistem mendukung tiga role: SUPER_ADMIN, EDITOR, VIEWER" — **WAJIB** |
| **Keputusan** | **Dibatalkan (Sesuai Konfirmasi User).** Role VIEWER tidak diperlukan karena audiens *viewer* (pihak eksternal) akan langsung menggunakan tautan QR Share yang bersifat publik dan *passwordless*. Plan Awal akan disesuaikan. |

---

## BAGIAN B — FITUR WAJIB YANG BELUM DIIMPLEMENTASI

### B1 — Pemilih Kualitas di Halaman Publik

| | |
| --- | --- |
| **Ref Plan** | `FR-PUB-03`, Modul 8 F8.2 |
| **Status** | Backend endpoint sudah mendukung parameter `?quality=` dengan opsi `preview`, `360p`, `720p`, `1080p`, `original`. Tetapi **frontend `PublicViewer.tsx` tidak menampilkan dropdown/selector kualitas apapun**. Download button tidak mengirim parameter quality. |
| **Dampak** | Publik tidak bisa memilih kualitas download; selalu download original (berpotensi file besar). |

### B2 — HTTP Range Request untuk Video Streaming

| | |
| --- | --- |
| **Ref Plan** | `FR-PUB-06`: "Video streaming mendukung HTTP Range Request (video dapat di-seek tanpa download penuh)" — **WAJIB** |
| **Status** | Route download di `public.routes.ts` langsung pipe stream MinIO tanpa menangani header `Range`. Video tidak bisa di-seek di browser. |
| **Dampak** | Video 4K harus didownload penuh sebelum bisa diputar; pengalaman pengguna buruk di mobile. |

### B3 — Reaktivasi QR Snapshot

| | |
| --- | --- |
| **Ref Plan** | `FR-QR-09`: "Admin dapat menonaktifkan (revoke) atau **mengaktifkan kembali** snapshot kapan saja" — **WAJIB** |
| **Status** | Hanya ada endpoint `PUT /api/sharing/:id/deactivate`. **Tidak ada endpoint reactivate** (`is_active = true`). Frontend juga tidak memiliki tombol "Aktifkan Kembali". |

### B4 — Label / Judul Snapshot & Mode Deskripsi

| | |
| --- | --- |
| **Ref Plan** | `FR-QR-04`: Label deskriptif untuk snapshot. `FR-QR-05`: Mode deskripsi NONE/AUTO/CUSTOM — **WAJIB** |
| **Status** | Backend schema `createSnapshotSchema` mendukung `title` dan `config`, tapi **frontend `ShareActivity.tsx` tidak menampilkan input field** untuk label snapshot maupun pemilih mode deskripsi. Snapshot dibuat tanpa judul. |

### B5 — Badge "Belum Diedit" pada Media

| | |
| --- | --- |
| **Ref Plan** | `FR-MED-07`: "Media yang judulnya dari template otomatis ditandai badge 'Belum diedit'" — **WAJIB** |
| **Status** | Field `is_edited` ada di database dan digunakan untuk filter. Tapi **tidak ada badge visual "Belum diedit"** yang dirender pada komponen media item (`SortableMediaItem.tsx` hanya menyimpan state internal, tidak menampilkan badge). |

### B6 — Hapus Seksi: Opsi Pindahkan Media

| | |
| --- | --- |
| **Ref Plan** | `FR-SEC-03`: "EDITOR dapat menghapus seksi dengan konfirmasi; memilih antara hapus media di dalamnya atau **pindahkan**" — **WAJIB** |
| **Status** | Route `DELETE /api/activities/:activityId/sections/:id` langsung menghapus seksi tanpa memeriksa media di dalamnya, dan tanpa memberikan opsi pindahkan. Media di dalam seksi yang dihapus bisa hilang jika ada CASCADE constraint, atau jadi orphan. |

### B7 — Full-Text Search

| | |
| --- | --- |
| **Ref Plan** | `FR-ACT-06`: "Acara dapat dicari berdasarkan judul (full-text search)" — **WAJIB** |
| **Status** | Pencarian menggunakan `ILIKE '%query%'` (baris 73 `activity.routes.ts`). Ini bukan FTS — tidak ada ranking relevansi, tidak toleran typo, dan sangat lambat di dataset besar karena tidak bisa pakai index. |

### B8 — SHA-256 Deduplication Sebelum Upload

| | |
| --- | --- |
| **Ref Plan** | `FR-OPT-04`: "Sebelum upload, hash lokal dicocokkan dengan server untuk deduplication — file duplikat tidak diupload ulang" — **WAJIB** |
| **Status** | Endpoint `GET /api/media/verify-upload` ada dan bisa digunakan untuk verifikasi setelah upload, tetapi **tidak ada endpoint deduplication check** yang menerima hash dan mengembalikan "file sudah ada, skip upload". Tidak ada logika di frontend/TUS yang mencegah upload duplikat. |

### B9 — QR Download Sebagai PNG/SVG

| | |
| --- | --- |
| **Ref Plan** | `FR-QR-11`: "QR dapat didownload sebagai PNG atau SVG" — **WAJIB** |
| **Status** | Perlu verifikasi apakah frontend `ShareActivity.tsx` menghasilkan QR code yang bisa didownload. Dari audit kode, tidak terlihat ada library QR generation (seperti `qrcode` atau `qrcode.react`) yang digunakan untuk menghasilkan file downloadable. |

### B10 — Attachment Rename

| | |
| --- | --- |
| **Ref Plan** | `FR-ATT-02`: "Lampiran memiliki display_name yang dapat diubah" — **WAJIB** |
| **Status** | Tabel `event_attachments` memiliki kolom `display_name`, tapi **tidak ada endpoint PUT** untuk mengubahnya. Frontend juga tidak memiliki UI rename lampiran. |

### B11 — Lampiran Level Seksi di Halaman Publik

| | |
| --- | --- |
| **Ref Plan** | `FR-ATT-04`: "Lampiran dapat dimasukkan dalam snapshot QR (opsional, pilih per lampiran)" — **WAJIB** |
| **Status** | Route publik `/p/:token/attachments` mengambil lampiran berdasarkan `activity_id` tanpa filter per-lampiran. Tidak ada mekanisme di snapshot untuk memilih lampiran individual. Config hanya punya `share_attachments: boolean` (semua atau tidak sama sekali). |

### B12 — Unarchive oleh SUPER_ADMIN

| | |
| --- | --- |
| **Ref Plan** | Plan mengizinkan EDITOR mengarsipkan dan SUPER_ADMIN menghapus. Tapi tidak ada jalur eksplisit untuk **mengembalikan** acara yang sudah diarsipkan. |
| **Status** | `PUT /api/activities/:id` dengan `{ is_archived: false }` secara teknis bisa bekerja, tapi route ini memerlukan `requireEditor` — dan tidak ada tombol "Unarchive" di UI Dashboard untuk acara yang sudah diarsipkan. |

### B13 — Video Preset 480p

| | |
| --- | --- |
| **Ref Plan** | `FR-MED-15`: "Preset kualitas video: **360p, 480p, 720p, 1080p**, original" — **WAJIB** |
| **Status** | Worker `media_processor.ts` hanya menghasilkan 360p, 720p, dan 1080p. **480p tidak ada**. |

### B14 — Foto Preset Lengkap (Thumbnail, Preview, Original)

| | |
| --- | --- |
| **Ref Plan** | `FR-MED-16`: "Preset kualitas foto: thumbnail (WebP kecil), **preview (WebP compressed)**, original" — **WAJIB** |
| **Status** | Worker menghasilkan thumbnail dan preview. Ini sudah benar. Tapi **frontend tidak menampilkan opsi untuk memilih kualitas download** (preview vs original) pada halaman publik maupun internal. |

---

## BAGIAN C — FITUR "SEBAIKNYA" YANG BELUM ADA

| # | Fitur | Ref Plan | Status |
| --- | --- | --- | --- |
| C1 | Jumlah parallel chunk upload bisa diatur user (1–6) di Settings | `FR-OPT-03` | Tidak ada UI Settings |
| C2 | Kompresi gambar ke WebP sebelum upload (opsional) | `FR-OPT-05` | Tidak diimplementasi |
| C3 | Tag orang dari daftar master persons | `FR-MED-09` | Backend ada, frontend persons list ada, tapi UX belum terintegrasi penuh |
| C4 | Version rollback UI | `FR-ACT-11` | Backend endpoint `POST /:id/versions/:versionId/restore` ada, tapi frontend `ActivityVersionsPage.tsx` **tidak memiliki tombol restore** |
| C5 | QR Analytics UI (grafik, top file) | Modul 11 F11.3 | Backend endpoint `/api/sharing/:id/analytics` ada, tapi frontend tidak menampilkan grafik/statistik |

---

## BAGIAN D — FITUR YANG SUDAH SESUAI PLAN ✓

| Modul | Fitur | Status |
| --- | --- | --- |
| Auth | Login email + password | ✓ |
| Auth | JWT dual-token (access 15min + refresh 7day HttpOnly cookie) | ✓ |
| Auth | Logout + invalidasi refresh token di Redis | ✓ |
| Auth | Brute force protection (lockout 5x / 10 menit) | ✓ |
| User | CRUD user oleh SUPER_ADMIN | ✓ |
| User | Reset password oleh SUPER_ADMIN | ✓ |
| User | Ganti password sendiri (konfirmasi lama) | ✓ |
| User | Edit profil (nama) | ✓ |
| Group | CRUD kecamatan/district | ✓ |
| Group | User terhubung ke satu unit kecamatan | ✓ |
| Acara | CRUD acara (judul, tanggal, deskripsi, lokasi, district) | ✓ |
| Acara | Toggle `use_sections` | ✓ |
| Acara | Filter: tanggal, rentang, bulan, tahun, kecamatan | ✓ |
| Acara | Soft delete (archive) + Hard delete (SUPER_ADMIN only) | ✓ |
| Acara | Version history (snapshot per edit) | ✓ |
| Seksi | CRUD seksi + auto sort_order | ✓ |
| Seksi | Reorder seksi | ✓ |
| Media | Upload foto & video (multipart + TUS) | ✓ (tapi multipart butuh fix A1) |
| Media | Rename display_name | ✓ |
| Media | Edit metadata (judul, deskripsi, rich text) | ✓ |
| Media | Filter "belum diedit" | ✓ (filter ada, badge belum — lihat B5) |
| Media | Drag-and-drop reorder & pindah antar seksi | ✓ |
| Media | Hapus media + cleanup MinIO | ✓ |
| Lampiran | Upload & download lampiran (level acara & seksi) | ✓ |
| QR | Panel sharing terpisah dari edit | ✓ |
| QR | Pemilihan konten per seksi & per media | ✓ |
| QR | Preview sebelum generate | ✓ |
| QR | Generate token UUID + URL publik | ✓ |
| QR | Deactivate (revoke) | ✓ |
| Publik | Halaman publik tanpa login | ✓ |
| Publik | Download per file | ✓ |
| Publik | Download semua (ZIP) | ✓ |
| Audit | Audit log append-only, semua aksi tulis | ✓ |
| Audit | Export CSV & PDF | ✓ |
| Integritas | SHA-256 background check setiap 6 jam | ✓ |
| Integritas | Status COMPROMISED + alert | ✓ |
| Infra | Rate limiting (200 req/jam) | ✓ |
| Infra | Route-level code splitting | ✓ |
| Infra | Docker Compose (PG, Redis, MinIO) | ✓ |
| Infra | CORS konfigurabel | ✓ |

---

## BAGIAN E — RISIKO KEAMANAN

| # | Risiko | Ref | Solusi |
| --- | --- | --- | --- |
| E1 | IP publik disimpan raw (bukan hashed) | `FR-SEC2-07` | Hash dengan SHA-1 sebelum simpan |
| E2 | Access token disimpan di Zustand persist (localStorage) | `NFR-SEC-01` | Pindahkan ke memory-only + auto-refresh on bootstrap |
| E3 | Content Security Policy belum di-set | `NFR-SEC-04` | Tambahkan CSP header ketat di route publik |
| E4 | Tidak ada sanitasi TipTap output di render publik | `NFR-SEC-03` | Gunakan node whitelist di RichTextViewer |
| E5 | MinIO credentials masih ada di `.env.example` | `NFR-SEC-06` | Ganti semua dengan placeholder `CHANGE_ME` |

---

## BAGIAN F — RENCANA PERBAIKAN (Urutan Prioritas)

### Fase 1 — Bug Kritis (SELESAI)

| # | Task | Ref | Status |
| --- | --- | --- | --- |
| 1 | Register `@fastify/multipart` di `server.ts` dengan file size limit | A1 | ~~Selesai~~ |
| 2 | Hitung SHA-256 pada multipart upload sebelum response 201 | A2 | ~~Selesai~~ |
| 3 | Hash IP dengan SHA-1 di `qr_scan_logs` INSERT | A3 | ~~Selesai~~ |
| 4 | Tambahkan `return reply.send(stream)` di public attachment download | A4 | ~~Selesai~~ |
| 5 | Tambahkan retry (3x) dan concurrency (2) di media worker | A5 | ~~Selesai~~ |
| 6 | Keputusan: kembalikan VIEWER role atau revisi Plan Awal | A7 | Dibatalkan (Tidak Perlu) |

### Fase 2 — Fitur Wajib Kritis (Estimasi: 3–5 hari)

| # | Task | Ref | Status |
| --- | --- | --- | --- |
| 7 | Implementasi quality selector dropdown di PublicViewer | B1 | ~~Selesai~~ |
| 8 | Implementasi HTTP Range Request untuk video streaming | B2 | ~~Selesai~~ |
| 9 | Tambahkan endpoint reactivate snapshot + tombol UI | B3 | ~~Selesai~~ |
| 10 | Tambahkan input label snapshot & mode deskripsi di ShareActivity | B4 | ~~Selesai~~ |
| 11 | Render badge "Belum diedit" di SortableMediaItem | B5 | ~~Selesai~~ |
| 12 | Tambahkan dialog konfirmasi "Hapus media atau pindahkan?" saat hapus seksi | B6 | ~~Selesai~~ |
| 13 | Tambahkan preset 480p di video worker | B13 | ~~Selesai~~ |

### Fase 3 — Fitur Wajib Pendukung (Estimasi: 3–5 hari)

| # | Task | Ref |
| --- | --- | --- |
| 14 | Migrasi pencarian dari ILIKE ke PostgreSQL FTS dengan `tsvector` | B7 |
| 15 | Implementasi deduplication check endpoint + frontend logic | B8 |
| 16 | QR code generation & download (PNG/SVG) di ShareActivity | B9 |
| 17 | Endpoint & UI rename lampiran | B10 |
| 18 | Seleksi per-lampiran di snapshot sharing | B11 |
| 19 | Tombol unarchive di Dashboard (tab arsip) | B12 |
| 20 | Quality selector untuk download internal (ActivityDetail) | B14 |

### Fase 4 — Export Refactor (Estimasi: 2–3 hari)

| # | Task | Ref |
| --- | --- | --- |
| 21 | Refactor PDF export ke BullMQ background job | A6 |
| 22 | Refactor ZIP export ke BullMQ background job | A6 |
| 23 | Implementasi TTL 24 jam + cron cleanup untuk export files | A6 |
| 24 | Frontend: polling job status + download notification | A6 |

### Fase 5 — Keamanan & Polish (Estimasi: 2–3 hari)

| # | Task | Ref |
| --- | --- | --- |
| 25 | Pindahkan access token ke memory-only | E2 |
| 26 | Tambahkan CSP header di route publik | E3 |
| 27 | Sanitasi TipTap output dengan node whitelist | E4 |
| 28 | Tombol restore di ActivityVersionsPage | C4 |
| 29 | QR Analytics UI (grafik scan/hari, top file) | C5 |

### Fase 6 — Desktop App (Estimasi: terpisah)

Desktop App (Tauri + Camera Offload) adalah proyek terpisah. Lihat class diagram di `docs/ARCHITECTURE.md`. Fitur yang termasuk:
- Deteksi drive kamera (`FR-DSK-01`)
- Copy cepat ke staging lokal (`FR-DSK-02`–`FR-DSK-03`)
- SQLite persistent upload queue (`FR-DSK-04`–`FR-DSK-05`)
- Auto-delete staging setelah hash match (`FR-DSK-06`–`FR-DSK-07`)
- Dynamic chunk size & parallel upload (`FR-OPT-01`–`FR-OPT-02`)
- Network speed indicator (`FR-OPT-06`)
- Batch upload acara (`FR-ACT-10`)

---

## BAGIAN G — CATATAN ARSITEKTUR

1. **Multipart upload (non-TUS)** akan mentok di file besar karena `toBuffer()` memuat seluruh file ke RAM. Untuk file > 100MB, gunakan TUS path. Pertimbangkan hapus multipart upload dan wajibkan TUS untuk semua upload media.

2. **Database transaction** di `media.routes.ts` (baris 310–327) melakukan `BEGIN/COMMIT/ROLLBACK` langsung di pool connection. Ini berbahaya jika connection yang sama dipakai request lain sebelum COMMIT. Gunakan `fastify.db.connect()` untuk mendapatkan dedicated client.

3. **BullMQ Worker** di `media_processor.ts` menggunakan `Client` (bukan pool) untuk database — ini benar untuk worker terpisah. Tapi jika worker crash dan restart, tidak ada mekanisme re-process file yang stuck di status `PROCESSING`.

4. **OpenAPI Spec** (`docs/openapi.yaml`) di-maintain manual. Harus di-auto-generate dari Fastify schema sebelum production (`NFR-MAINT-04`).

---

*Dokumen ini harus di-update setiap kali task dari Rencana Perbaikan diselesaikan.*

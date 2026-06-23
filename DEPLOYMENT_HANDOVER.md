# 🏢 ENTERPRISE DEPLOYMENT & HANDOVER DOCUMENT (REKAM)
**Klasifikasi Dokumen**: Rahasia/Internal  
**Ditujukan Untuk**: Tim DevOps, System Administrator, IT Infrastructure  

---

## 1. PENDAHULUAN & TOPOLOGI JARINGAN

Aplikasi **REKAM** dibangun menggunakan arsitektur *Monorepo* yang memisahkan beban kerja antara Backend API, Front-End Internal (Admin), dan Front-End Eksternal (Instansi Luar). 

Untuk memastikan aplikasi ini **TIDAK MENGHAMBAT JARINGAN LOKAL** perusahaan meskipun diserang trafik tinggi, kami telah menyiapkan arsitektur *Offloading*:
1. **Cloudflare Tunnel (Wajib digunakan)**: Menjadikan server offline menjadi online tanpa harus membuka port di Router/Firewall kantor. Cloudflare akan bertindak sebagai *Global CDN* sehingga file statis web (HTML, CSS, JS) akan di-cache di server Cloudflare luar negeri/lokal, bukan membebani bandwidth kantor Anda.
2. **Nginx Reverse Proxy dengan Rate Limiting**: Memblokir serangan bot (DDoS) secara langsung dari server.
3. **Chunked Upload (Tus Protocol)**: Upload file bergiga-giga tidak akan membuat server nge-hang karena file dikirim dalam potongan kecil (chunk).

---

## 2. STANDAR INSTALASI (ALL-IN-ONE AUTOMATION)

Kami menyarankan penggunaan **Docker** untuk instalasi *Database, Redis, dan MinIO* agar environment bersih dan tidak merusak server host.

### 🧰 A. Setup Infrastruktur Data (1 Menit)
Jalankan file `docker-compose.yml` yang sudah kami sediakan di root folder. File ini akan otomatis menginstal:
- PostgreSQL 15 (Port 5432)
- Redis 7 dengan pembatasan RAM maksimal 1GB (Port 6379)
- MinIO Object Storage (Port 9000 & 9001) beserta 4 bucket otomatis.

```bash
cd /opt/rekam
docker-compose up -d
```

### 🧰 B. Setup Aplikasi Node.js (Aplikasi REKAM)
Gunakan *script* otomatis yang telah kami sediakan:
```bash
chmod +x deploy-helper.sh
./deploy-helper.sh
```
*Script ini akan mem-build semua frontend, backend, menjalankan migrasi database, dan menyalakan aplikasi 24/7 menggunakan PM2 Process Manager.*

---

## 3. PENGATURAN JARINGAN & NGINX (SANGAT KRITIKAL)

File `rekam_nginx.conf` telah dibuat dengan standar *Enterprise* dan telah mempertimbangkan **Network Performance (Beban Jaringan)**.
Anda Wajib menyalin file tersebut ke Nginx:
```bash
sudo cp rekam_nginx.conf /etc/nginx/sites-available/rekam
sudo ln -s /etc/nginx/sites-available/rekam /etc/nginx/sites-enabled/
sudo systemctl reload nginx
```

**Penjelasan Optimasi Jaringan di dalam `rekam_nginx.conf`**:
- `gzip on;` -> Semua text/API dikompresi sehingga sangat ringan dikirim lewat internet.
- `limit_req zone=public_api burst=30;` -> Mencegah API diserang (Spam F5) yang dapat menghabiskan koneksi internet kantor.
- Cache 1 Tahun (`expires 1y`) untuk gambar & asset UI agar browser user tidak mendownload ulang setiap hari.

---

## 4. BAGAIMANA CARA SERVER INI DIAKSES DARI INTERNET?

Jika server fisik berada di kantor (Offline/Intranet), lakukan langkah ini:

### Menggunakan Cloudflare Tunnel (Tanpa Buka Port Router - Anti Hack)
1. Login ke [Cloudflare Zero Trust](https://one.dash.cloudflare.com/).
2. Pilih **Networks > Tunnels** -> Create a Tunnel.
3. Install konektor di server Ubuntu Anda sesuai perintah yang muncul (berupa `cloudflared service install ...`).
4. Pada tab **Public Hostname**, tambahkan rute:
   - `rekam.namakantor.go.id` -> arahkan ke `http://localhost:80`
   - `media.rekam.namakantor.go.id` -> arahkan ke `http://localhost:80`
5. Selesai. Website sudah online dengan HTTPS, dilindungi WAF (Web Application Firewall) Cloudflare, dan menggunakan bandwidth Cloudflare untuk caching UI.

---

## 5. CREDENTIALS & ENVIRONMENT

Semua kata sandi, token JWT, dan konfigurasi API berada di file:
- `apps/backend/.env.production`
- `apps/web/.env.production`
- `apps/media-web/.env.production`

> [!WARNING]
> Sebelum melakukan *Go-Live*, silakan buka `apps/backend/.env.production` dan ganti `JWT_ACCESS_SECRET` serta `GANTI_PASSWORD` pada string Database dan MinIO untuk mencegah kebocoran data.

---
**Dokumen Disahkan Oleh:**
Tim Developer Utama REKAM
*Siap diserahkan kepada tim infrastruktur untuk deployment skala produksi.*

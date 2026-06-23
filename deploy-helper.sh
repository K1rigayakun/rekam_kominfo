#!/bin/bash
echo "🚀 Memulai Proses Build & Deployment REKAM..."

echo "📦 1. Menginstal Dependencies..."
npm install

echo "⚙️ 2. Membangun Backend API..."
cd apps/backend
npm run build
cd ../..

echo "🌐 3. Membangun Frontend Web (Admin)..."
cd apps/web
npm run build
cd ../..

echo "📱 4. Membangun Frontend Media-Web (Eksternal)..."
cd apps/media-web
npm run build
cd ../..

echo "🔄 5. Menjalankan Migrasi Database..."
cd apps/backend
npm run db:migrate
cd ../..

echo "▶️ 6. Menjalankan Server Node.js dengan PM2..."
pm2 start ecosystem.config.js
pm2 save

echo "✅ Deployment selesai! Pastikan Nginx sudah dikonfigurasi menggunakan file rekam_nginx.conf."

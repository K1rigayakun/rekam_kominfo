import 'dotenv/config';
import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';
import { Client } from 'pg';
import * as Minio from 'minio';
import crypto from 'crypto';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const db = new Client({
  connectionString: process.env.DATABASE_URL,
});

const minio = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: Number(process.env.MINIO_PORT) || 9000,
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
});

const RAW_BUCKET = process.env.MINIO_BUCKET_RAW || 'rekam-raw';

async function performIntegrityCheck() {
  console.log('[IntegrityCheck] Memulai proses sinkronisasi database dan storage...');

  // 1. Ambil semua file dari database
  const { rows: mediaFiles } = await db.query(
    "SELECT id, storage_key_raw, status, checksum_sha256 FROM media_files WHERE status != 'ERROR'"
  );

  let missingInStorage = 0;
  let corrupted = 0;
  let ok = 0;

  for (const media of mediaFiles) {
    if (!media.storage_key_raw) continue;

    try {
      // Dapatkan stream file dari MinIO
      const stream = await minio.getObject(RAW_BUCKET, media.storage_key_raw);
      
      // Hitung SHA-256
      const hash = crypto.createHash('sha256');
      
      for await (const chunk of stream) {
        hash.update(chunk);
      }
      
      const fileHash = hash.digest('hex');

      if (media.checksum_sha256 && fileHash !== media.checksum_sha256) {
        corrupted++;
        console.warn(`[IntegrityCheck] COMPROMISED: SHA-256 mismatch untuk file ID ${media.id}`);
        
        await db.query(
          `UPDATE media_files SET status = 'ERROR', processing_error = 'COMPROMISED' WHERE id = $1`, 
          [media.id]
        );
        
        await db.query(
          `INSERT INTO audit_logs (action, entity_type, entity_id, details)
           VALUES ('UPDATE', 'media_file', $1, $2)`,
          [media.id, JSON.stringify({ error: 'COMPROMISED', expected: media.checksum_sha256, actual: fileHash })]
        );
      } else {
        ok++;
      }
    } catch (err: any) {
      if (err.code === 'NotFound') {
        missingInStorage++;
        console.warn(`[IntegrityCheck] WARNING: File hilang di storage (ID: ${media.id}, Key: ${media.storage_key_raw})`);
        
        await db.query(`UPDATE media_files SET status = 'ERROR', processing_error = 'FILE_NOT_FOUND' WHERE id = $1`, [media.id]);
        
        await db.query(
          `INSERT INTO audit_logs (action, entity_type, entity_id, details)
           VALUES ('UPDATE', 'media_file', $1, $2)`,
          [media.id, JSON.stringify({ error: 'FILE_NOT_FOUND', key: media.storage_key_raw })]
        );
      } else {
        console.error(`[IntegrityCheck] ERROR: Gagal akses file ${media.storage_key_raw}:`, err.message);
      }
    }
  }

  console.log(`[IntegrityCheck] Selesai. Total media diperiksa: ${mediaFiles.length}`);
  console.log(`[IntegrityCheck] OK: ${ok}, Hilang: ${missingInStorage}, Corrupted/Mismatch: ${corrupted}`);
}

const worker = new Worker(
  'integrity-check',
  async (job) => {
    console.log(`[Worker] Memulai job integrity check ${job.id}`);
    await performIntegrityCheck();
    console.log(`[Worker] Job integrity check ${job.id} selesai`);
  },
  { connection: redis as any }
);

worker.on('ready', () => {
  console.log('[Worker] Integrity Check worker started and listening...');
});

// Setup DB connection
db.connect().then(async () => {
  // Tambahkan job berulang setiap 6 jam
  const integrityQueue = new Queue('integrity-check', { connection: redis as any });
  await integrityQueue.add('periodic-check', {}, {
    repeat: {
      pattern: '0 */6 * * *'
    }
  });
  console.log('[Worker] Scheduled recurring integrity check job (0 */6 * * *)');
}).catch((err) => {
  console.error('[Worker] Failed to connect to DB', err);
  process.exit(1);
});

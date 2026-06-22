import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';

import crypto from 'crypto';

export default fp(async (fastify: FastifyInstance) => {
  // ─── 1. Cleanup Export Jobs (1 jam) ───
  const cleanupInterval = setInterval(async () => {
    try {
      fastify.log.info('[cron] Memulai pembersihan export jobs...');
      
      const { rows: expiredJobs } = await fastify.db.query(
        `SELECT id, storage_key FROM export_jobs WHERE expires_at < NOW()`
      );

      for (const job of expiredJobs) {
        if (job.storage_key) {
          try {
            await fastify.minio.removeObject(fastify.minioBuckets.exports, job.storage_key);
            fastify.log.info(`[cron] Menghapus file MinIO: ${job.storage_key}`);
          } catch (err) {
            fastify.log.warn(`[cron] Gagal menghapus file MinIO: ${job.storage_key}`);
          }
        }
      }

      const { rowCount } = await fastify.db.query(
        `DELETE FROM export_jobs WHERE expires_at < NOW()`
      );

      if (rowCount && rowCount > 0) {
        fastify.log.info(`[cron] Berhasil menghapus ${rowCount} export jobs yang kadaluarsa.`);
      }

    } catch (err: any) {
      fastify.log.error(err, '[cron] Terjadi kesalahan saat pembersihan export jobs');
    }
  }, 60 * 60 * 1000); // 1 jam

  // ─── 2. Verifikasi Integritas SHA-256 (6 Jam) ───
  // Mengecek sebagian kecil file secara bergiliran agar tidak memberatkan server
  const integrityInterval = setInterval(async () => {
    try {
      fastify.log.info('[cron] Memulai verifikasi integritas file SHA-256...');
      
      // Ambil 50 file terlama yang belum pernah di-scan atau sudah lama di-scan
      // Catatan: Karena kolom last_integrity_scan belum ada di skema, 
      // kita gunakan random sampling atau batasi limit agar tidak hang.
      // Di versi produksi yang sesungguhnya sebaiknya ada kolom last_scan_at.
      const { rows: filesToVerify } = await fastify.db.query(
        `SELECT id, storage_key_raw, checksum_sha256, file_size_bytes 
         FROM media_files 
         WHERE status = 'READY' 
         ORDER BY RANDOM() 
         LIMIT 50`
      );

      for (const file of filesToVerify) {
        try {
          if (!file.storage_key_raw) continue;
          
          // 1. Cek stat (apakah file ada dan ukurannya sama)
          const stat = await fastify.minio.statObject(fastify.minioBuckets.raw, file.storage_key_raw);
          
          if (stat.size !== parseInt(file.file_size_bytes)) {
            throw new Error(`Size mismatch: expected ${file.file_size_bytes}, got ${stat.size}`);
          }

          // 2. Jika ada checksum_sha256, verifikasi isi file
          if (file.checksum_sha256) {
            const stream = await fastify.minio.getObject(fastify.minioBuckets.raw, file.storage_key_raw);
            const hash = crypto.createHash('sha256');
            
            await new Promise((resolve, reject) => {
              stream.on('data', chunk => hash.update(chunk));
              stream.on('end', resolve);
              stream.on('error', reject);
            });
            
            const computedHash = hash.digest('hex');
            if (computedHash !== file.checksum_sha256) {
               throw new Error(`Hash mismatch: expected ${file.checksum_sha256}, got ${computedHash}`);
            }
          }
          
        } catch (err: any) {
          fastify.log.error(`[cron] Integritas gagal untuk file ${file.id}: ${err.message}`);
          // media_status enum tidak punya COMPROMISED; simpan detailnya di processing_error.
          await fastify.db.query(
            `UPDATE media_files SET status = 'ERROR', processing_error = 'COMPROMISED' WHERE id = $1`,
            [file.id]
          );
        }
      }
      
      fastify.log.info(`[cron] Selesai memverifikasi ${filesToVerify.length} file.`);
    } catch (err: any) {
      fastify.log.error(err, '[cron] Terjadi kesalahan saat verifikasi integritas file');
    }
  }, 6 * 60 * 60 * 1000); // 6 Jam

  fastify.addHook('onClose', (instance, done) => {
    clearInterval(cleanupInterval);
    clearInterval(integrityInterval);
    done();
  });
});

import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { Client } from 'pg';
import * as Minio from 'minio';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PassThrough } from 'stream';
const archiver = require('archiver');
import PDFDocument from 'pdfkit';

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} wajib diisi`);
  }
  return value;
}

function getQualityVariant(qualityVariants: any, quality: string) {
  if (!qualityVariants) return null;
  let variants = qualityVariants;
  if (typeof qualityVariants === 'string') {
    try {
      variants = JSON.parse(qualityVariants);
    } catch {
      return null;
    }
  }
  return variants?.[quality] || null;
}

function resolveDownloadTarget(file: any, quality: string) {
  if (quality === 'preview') {
    return {
      bucket: PROCESSED_BUCKET,
      key: file.storage_key_processed,
    };
  }
  if (['360p', '480p', '720p', '1080p'].includes(quality)) {
    return {
      bucket: PROCESSED_BUCKET,
      key: getQualityVariant(file.quality_variants, quality),
    };
  }
  return {
    bucket: RAW_BUCKET,
    key: file.storage_key_raw,
  };
}

const redis = new Redis(requireEnv('REDIS_URL'));

const db = new Client({
  connectionString: requireEnv('DATABASE_URL'),
});

const minio = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: Number(process.env.MINIO_PORT) || 9000,
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: requireEnv('MINIO_ACCESS_KEY'),
  secretKey: requireEnv('MINIO_SECRET_KEY'),
});

const RAW_BUCKET = process.env.MINIO_BUCKET_RAW || 'rekam-raw';
const PROCESSED_BUCKET = process.env.MINIO_BUCKET_PROCESSED || 'rekam-processed';
const EXPORT_BUCKET = process.env.MINIO_BUCKET_EXPORTS || 'rekam-exports';

async function processActivityZip(jobId: string, activityId: string, userId: string) {
  console.log(`[export] Memulai job ZIP untuk activity ${activityId}`);
  
  const { rows: activities } = await db.query(
    'SELECT title, event_date FROM activities WHERE id = $1',
    [activityId]
  );

  if (activities.length === 0) throw new Error('Acara tidak ditemukan');

  const activity = activities[0];
  const safeTitle = activity.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const dateStr = activity.event_date ? new Date(activity.event_date).toISOString().split('T')[0] : 'undated';
  const zipFilename = `REKAM_${safeTitle}_${dateStr}.zip`;
  
  const tmpPath = path.join(os.tmpdir(), `export_${jobId}.zip`);
  const output = fs.createWriteStream(tmpPath);
  
  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.pipe(output);

  const { rows: mediaList } = await db.query(
    `SELECT mf.original_filename, mf.storage_key_raw, es.title as section_title
     FROM media_files mf
     LEFT JOIN event_sections es ON es.id = mf.section_id
     WHERE mf.activity_id = $1
     ORDER BY es.sort_order, mf.sort_order`,
    [activityId]
  );

  for (const media of mediaList) {
    if (!media.storage_key_raw) continue;
    try {
      const stream = await minio.getObject(RAW_BUCKET, media.storage_key_raw);
      const folderName = media.section_title ? media.section_title.replace(/[^a-z0-9]/gi, '_') : 'Lainnya';
      archive.append(stream, { name: `${folderName}/${media.original_filename}` });
    } catch (err) {
      console.error(`Gagal stream file untuk export: ${media.storage_key_raw}`);
    }
  }

  await archive.finalize();

  // Tunggu sampai stream write selesai
  await new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    output.on('error', reject);
  });

  // Upload ke MinIO
  const storageKey = `zip/${jobId}/${zipFilename}`;
  await minio.fPutObject(EXPORT_BUCKET, storageKey, tmpPath, { 'Content-Type': 'application/zip' });
  
  // Update DB
  await db.query(
    `UPDATE export_jobs SET status = 'COMPLETED', storage_key = $1, file_name = $2, completed_at = NOW() WHERE id = $3`,
    [storageKey, zipFilename, jobId]
  );

  fs.unlinkSync(tmpPath);
  console.log(`[export] Selesai job ZIP untuk activity ${activityId}`);
}

async function processPublicZip(jobId: string, snapshotId: string, quality: string) {
  console.log(`[export] Memulai job Public ZIP untuk snapshot ${snapshotId}`);
  
  const { rows: snapshots } = await db.query(
    `SELECT ss.title, a.title as activity_title, a.event_date
     FROM sharing_snapshots ss
     JOIN activities a ON a.id = ss.activity_id
     WHERE ss.id = $1`,
    [snapshotId]
  );

  if (snapshots.length === 0) throw new Error('Snapshot tidak ditemukan');

  const snap = snapshots[0];
  const safeTitle = (snap.title || snap.activity_title).replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const dateStr = snap.event_date ? new Date(snap.event_date).toISOString().split('T')[0] : 'undated';
  const zipFilename = `REKAM_${safeTitle}_${dateStr}.zip`;
  
  const tmpPath = path.join(os.tmpdir(), `public_export_${jobId}.zip`);
  const output = fs.createWriteStream(tmpPath);
  
  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.pipe(output);

  const { rows: mediaList } = await db.query(
    `SELECT mf.id, mf.original_filename, mf.display_name, mf.media_type,
            mf.storage_key_raw, mf.storage_key_processed, mf.quality_variants,
            es.title as section_title
     FROM sharing_snapshot_items ssi
     JOIN media_files mf ON mf.id = ssi.media_id
     LEFT JOIN event_sections es ON es.id = mf.section_id
     WHERE ssi.snapshot_id = $1
     ORDER BY es.sort_order, mf.sort_order`,
    [snapshotId]
  );

  for (const media of mediaList) {
    const { bucket, key } = resolveDownloadTarget(media, quality);
    if (!key) continue;
    try {
      const stream = await minio.getObject(bucket, key);
      const folderName = media.section_title ? media.section_title.replace(/[^a-z0-9_]/gi, '_') : 'Media';
      const fileName = media.display_name || media.original_filename;
      archive.append(stream, { name: `${folderName}/${fileName}` });
    } catch (err) {
      console.error(`Gagal stream file untuk export: ${key}`);
    }
  }

  await archive.finalize();

  await new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    output.on('error', reject);
  });

  const storageKey = `zip/${jobId}/${zipFilename}`;
  await minio.fPutObject(EXPORT_BUCKET, storageKey, tmpPath, { 'Content-Type': 'application/zip' });
  
  await db.query(
    `UPDATE export_jobs SET status = 'COMPLETED', storage_key = $1, file_name = $2, completed_at = NOW() WHERE id = $3`,
    [storageKey, zipFilename, jobId]
  );

  fs.unlinkSync(tmpPath);
  console.log(`[export] Selesai job Public ZIP untuk snapshot ${snapshotId}`);
}

async function processActivityPdf(jobId: string, activityId: string, userId: string) {
  console.log(`[export] Memulai job PDF untuk activity ${activityId}`);
  
  const { rows: activities } = await db.query(
    `SELECT a.title, a.event_date, a.location, a.description, u.full_name as created_by_name, d.name as district_name
     FROM activities a
     LEFT JOIN users u ON u.id = a.created_by
     LEFT JOIN districts d ON d.id = a.district_id
     WHERE a.id = $1`,
    [activityId]
  );

  if (activities.length === 0) throw new Error('Acara tidak ditemukan');

  const activity = activities[0];
  const safeTitle = activity.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const dateStr = activity.event_date ? new Date(activity.event_date).toISOString().split('T')[0] : 'undated';
  const pdfFilename = `REKAM_${safeTitle}_${dateStr}.pdf`;
  const storageKey = `pdf/${jobId}/${pdfFilename}`;

  const { rows: mediaList } = await db.query(
    `SELECT mf.original_filename, mf.storage_key_thumbnail, es.title as section_title
     FROM media_files mf
     LEFT JOIN event_sections es ON es.id = mf.section_id
     WHERE mf.activity_id = $1
     ORDER BY es.sort_order, mf.sort_order`,
    [activityId]
  );

  return new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const passThrough = new PassThrough();

    minio.putObject(EXPORT_BUCKET, storageKey, passThrough).then(() => {
      return db.query(
        `UPDATE export_jobs SET status = 'COMPLETED', storage_key = $1, file_name = $2, completed_at = NOW() WHERE id = $3`,
        [storageKey, pdfFilename, jobId]
      );
    }).then(() => resolve(undefined)).catch(reject);

    doc.pipe(passThrough);

    doc.fontSize(18).font('Helvetica-Bold').text('KEMENTERIAN KOMUNIKASI DAN INFORMATIKA', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('Repositori Elektronik Kegiatan & Arsip Media (REKAM)', { align: 'center' });
    doc.moveDown(2);

    doc.fontSize(16).font('Helvetica-Bold').text(activity.title, { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(12).font('Helvetica-Bold').text('Detail Acara');
    doc.font('Helvetica');
    doc.text(`Tanggal: ${activity.event_date ? new Date(activity.event_date).toLocaleDateString('id-ID') : '-'}`);
    doc.text(`Kecamatan: ${activity.district_name || '-'}`);
    doc.text(`Lokasi: ${activity.location || '-'}`);
    doc.text(`Dibuat oleh: ${activity.created_by_name || '-'}`);
    doc.moveDown();

    if (activity.description) {
      doc.font('Helvetica-Bold').text('Deskripsi');
      doc.font('Helvetica').text(activity.description);
      doc.moveDown();
    }

    doc.font('Helvetica-Bold').text('Daftar Media Dokumentasi');
    doc.moveDown(0.5);

    if (mediaList.length === 0) {
      doc.font('Helvetica').text('Tidak ada media yang diunggah untuk acara ini.');
      doc.end();
      return;
    }

    // Grid rendering logic
    const margin = 50;
    const itemsPerRow = 3;
    const maxItemWidth = (doc.page.width - margin * 2) / itemsPerRow;
    const gap = 15;
    const thumbnailWidth = maxItemWidth - gap;
    const thumbnailHeight = thumbnailWidth; // Square thumbnail box
    
    let currentX = margin;
    let currentY = doc.y;
    let currentSection = '';

    const drawGridImages = async () => {
      for (const media of mediaList) {
        const sectionTitle = media.section_title || 'Lainnya';
        if (sectionTitle !== currentSection) {
          // New section header
          currentSection = sectionTitle;
          currentX = margin;
          if (currentY + 50 > doc.page.height - margin) {
            doc.addPage();
            currentY = margin;
          } else {
            currentY += gap;
          }
          doc.font('Helvetica-Bold').fontSize(12).text(`Seksi: ${sectionTitle}`, currentX, currentY);
          currentY += 20;
        }

        // Check if we need to wrap to next row
        if (currentX + thumbnailWidth > doc.page.width - margin) {
          currentX = margin;
          currentY += thumbnailHeight + gap + 25; // 25 for text
        }

        // Check page break
        if (currentY + thumbnailHeight + 25 > doc.page.height - margin) {
          doc.addPage();
          currentY = margin;
          currentX = margin;
        }

        // Draw bounding box
        doc.rect(currentX, currentY, thumbnailWidth, thumbnailHeight).stroke('#dddddd');

        // Draw image if available
        if (media.storage_key_thumbnail) {
          try {
            const dataStream = await minio.getObject(PROCESSED_BUCKET, media.storage_key_thumbnail);
            const chunks: any[] = [];
            for await (const chunk of dataStream) chunks.push(chunk);
            const imgBuffer = Buffer.concat(chunks);
            
            // PDFKit auto scales image to fit width/height
            doc.image(imgBuffer, currentX + 2, currentY + 2, {
              fit: [thumbnailWidth - 4, thumbnailHeight - 4],
              align: 'center',
              valign: 'center'
            });
          } catch (e) {
            doc.font('Helvetica').fontSize(10).fillColor('#999').text('Gambar tidak tersedia', currentX, currentY + thumbnailHeight / 2 - 5, { width: thumbnailWidth, align: 'center' });
            doc.fillColor('black');
          }
        } else {
          doc.font('Helvetica').fontSize(10).fillColor('#999').text('Format Video', currentX, currentY + thumbnailHeight / 2 - 5, { width: thumbnailWidth, align: 'center' });
          doc.fillColor('black');
        }

        // Caption
        let safeName = media.original_filename;
        if (safeName && safeName.length > 20) {
          safeName = safeName.substring(0, 17) + '...';
        }
        doc.font('Helvetica').fontSize(9).text(safeName || '-', currentX, currentY + thumbnailHeight + 5, {
          width: thumbnailWidth,
          align: 'center'
        });

        currentX += thumbnailWidth + gap;
      }
      doc.end();
    };

    drawGridImages().catch(err => {
      console.error('Error drawing PDF:', err);
      doc.end();
    });
  });
}

// ─── WORKER ────────────────────────────────────────────────────
async function start() {
  await db.connect();
  console.log('[export_processor] Terhubung ke database');

  const worker = new Worker('export-processing', async (job: Job) => {
    console.log(`[export-processor] Memproses job ${job.id} (Type: ${job.data.entityType})`);
    const { jobId, entityType, entityId, userId } = job.data;

    try {
      await db.query(`UPDATE export_jobs SET status = 'PROCESSING' WHERE id = $1`, [jobId]);

      if (entityType === 'activity_zip') {
        await processActivityZip(jobId, entityId, userId);
      } else if (entityType === 'activity_pdf') {
        await processActivityPdf(jobId, entityId, userId);
      } else if (entityType === 'public_zip_original') {
        await processPublicZip(jobId, entityId, 'original');
      } else if (entityType === 'public_zip_preview') {
        await processPublicZip(jobId, entityId, 'preview');
      } else {
        throw new Error(`Tipe ekspor tidak dikenali: ${entityType}`);
      }

      console.log(`[export-processor] Job ${jobId} selesai.`);
    } catch (err: any) {
      console.error(`[export-processor] Job ${jobId} gagal:`, err);
      await db.query(`UPDATE export_jobs SET status = 'FAILED', error_message = $1 WHERE id = $2`, [err.message, jobId]);
      throw err;
    }
  }, { 
    connection: redis as any,
    concurrency: Number(process.env.EXPORT_PROCESSING_CONCURRENCY || 2)
  });

  worker.on('failed', (job, err) => {
    console.error(`[export-processor] Job ${job?.id} failed in BullMQ:`, err);
  });

  console.log('[export_processor] Worker Export berjalan');
}

start().catch(console.error);

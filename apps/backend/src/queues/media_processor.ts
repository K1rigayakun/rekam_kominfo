import 'dotenv/config';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { Client } from 'pg';
import * as Minio from 'minio';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

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
const PROCESSED_BUCKET = process.env.MINIO_BUCKET_PROCESSED || 'rekam-processed';

async function processImage(mediaId: string, storageKeyRaw: string, activityId: string, sectionId: string) {
  const tmpRawPath = path.join(os.tmpdir(), `raw_${mediaId}`);
  await minio.fGetObject(RAW_BUCKET, storageKeyRaw, tmpRawPath);

  // Dapatkan metadata
  const metadata = await sharp(tmpRawPath).metadata();
  const width = metadata.width || null;
  const height = metadata.height || null;

  const uuid = randomUUID();

  // Buat preview (kompresi) - WEBP 1080p
  const processedKey = `${activityId}/${sectionId}/${uuid}_preview.webp`;
  const tmpProcessedPath = path.join(os.tmpdir(), `proc_${mediaId}.webp`);

  await sharp(tmpRawPath)
    .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(tmpProcessedPath);

  // Buat thumbnail - WEBP 400x400
  const thumbnailKey = `${activityId}/${sectionId}/${uuid}_thumb.webp`;
  const tmpThumbPath = path.join(os.tmpdir(), `thumb_${mediaId}.webp`);

  await sharp(tmpRawPath)
    .resize(400, 400, { fit: 'cover' })
    .webp({ quality: 60 })
    .toFile(tmpThumbPath);

  // Upload processed
  await minio.fPutObject(PROCESSED_BUCKET, processedKey, tmpProcessedPath, {
    'Content-Type': 'image/webp',
  });

  // Upload thumbnail
  await minio.fPutObject(PROCESSED_BUCKET, thumbnailKey, tmpThumbPath, {
    'Content-Type': 'image/webp',
  });

  // Update DB
  await db.query(
    `UPDATE media_files 
     SET status = 'READY', 
         storage_key_processed = $1, 
         storage_key_thumbnail = $2,
         width = $3, 
         height = $4,
         updated_at = NOW()
     WHERE id = $5`,
    [processedKey, thumbnailKey, width, height, mediaId]
  );

  // Cleanup
  fs.unlinkSync(tmpRawPath);
  fs.unlinkSync(tmpProcessedPath);
  fs.unlinkSync(tmpThumbPath);
}

const transcodeVideo = (inputPath: string, outputPath: string, resolution: string) => {
  return new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        `-vf scale=-2:${resolution}`,
        '-c:v libx264',
        '-preset fast',
        '-crf 28',
        '-c:a aac',
        '-b:a 128k'
      ])
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
};

async function processVideo(mediaId: string, storageKeyRaw: string, activityId: string, sectionId: string) {
  const tmpRawPath = path.join(os.tmpdir(), `raw_${mediaId}`);
  await minio.fGetObject(RAW_BUCKET, storageKeyRaw, tmpRawPath);

  const uuid = randomUUID();
  
  // Create thumbnail (WebP 400x400)
  const tmpThumbPath = path.join(os.tmpdir(), `thumb_${mediaId}.jpg`);
  const finalThumbPath = path.join(os.tmpdir(), `thumb_${mediaId}.webp`);
  const finalThumbKey = `${activityId}/${sectionId}/${uuid}_thumb.webp`;

  let defaultProcessedKey = '';
  const qualityVariants: Record<string, string> = {};

  return new Promise<void>((resolve, reject) => {
    ffmpeg(tmpRawPath)
      .on('end', async () => {
        try {
          // Convert thumb.jpg to thumb.webp using sharp
          await sharp(tmpThumbPath)
            .resize(400, 400, { fit: 'cover' })
            .webp({ quality: 60 })
            .toFile(finalThumbPath);

          // Upload thumbnail
          await minio.fPutObject(PROCESSED_BUCKET, finalThumbKey, finalThumbPath, {
            'Content-Type': 'image/webp',
          });

          // Transcoding to multiple resolutions
          const resolutions = [
            { label: '360p', height: '360' },
            { label: '480p', height: '480' },
            { label: '720p', height: '720' },
            { label: '1080p', height: '1080' }
          ];

          for (const res of resolutions) {
            const outPath = path.join(os.tmpdir(), `${mediaId}_${res.label}.mp4`);
            const outKey = `${activityId}/${sectionId}/${uuid}_${res.label}.mp4`;
            console.log(`[Worker] Transcoding video ${mediaId} to ${res.label}...`);
            await transcodeVideo(tmpRawPath, outPath, res.height);
            await minio.fPutObject(PROCESSED_BUCKET, outKey, outPath, { 'Content-Type': 'video/mp4' });
            qualityVariants[res.label] = outKey;
            
            // Set 720p or 360p as default processed key
            if (res.label === '720p' || (res.label === '360p' && !defaultProcessedKey)) {
                defaultProcessedKey = outKey;
            }
            fs.unlinkSync(outPath);
          }

          // Get metadata
          ffmpeg.ffprobe(tmpRawPath, async (err, metadata) => {
            let width = null;
            let height = null;
            let duration = null;

            if (!err && metadata) {
              const stream = metadata.streams.find((s) => s.codec_type === 'video');
              if (stream) {
                width = stream.width || null;
                height = stream.height || null;
              }
              duration = metadata.format.duration || null;
            }

            // Update DB
            await db.query(
              `UPDATE media_files 
               SET status = 'READY', 
                   storage_key_processed = $1, 
                   storage_key_thumbnail = $2,
                   quality_variants = $3,
                   width = $4, 
                   height = $5,
                   duration_seconds = $6,
                   updated_at = NOW()
               WHERE id = $7`,
              [defaultProcessedKey, finalThumbKey, JSON.stringify(qualityVariants), width, height, duration, mediaId]
            );

            // Cleanup
            fs.unlinkSync(tmpRawPath);
            fs.unlinkSync(tmpThumbPath);
            fs.unlinkSync(finalThumbPath);
            resolve();
          });
        } catch (error) {
          reject(error);
        }
      })
      .on('error', (err) => {
        reject(err);
      })
      .screenshots({
        timestamps: ['00:00:01'],
        filename: path.basename(tmpThumbPath),
        folder: path.dirname(tmpThumbPath),
        size: '1280x720',
      });
  });
}

const worker = new Worker(
  'media-processing',
  async (job) => {
    const { mediaId, mediaType, storageKeyRaw, activityId, sectionId } = job.data;
    console.log(`[Worker] Processing media ${mediaId} (${mediaType})`);

    try {
      if (mediaType === 'IMAGE') {
        await processImage(mediaId, storageKeyRaw, activityId, sectionId);
      } else if (mediaType === 'VIDEO') {
        await processVideo(mediaId, storageKeyRaw, activityId, sectionId);
      }
      console.log(`[Worker] Finished media ${mediaId}`);
    } catch (err: any) {
      console.error(`[Worker] Error processing media ${mediaId}:`, err);
      await db.query(`UPDATE media_files SET status = 'ERROR' WHERE id = $1`, [mediaId]);
      throw err;
    }
  },
  { 
    connection: redis as any,
    concurrency: 2
  }
);

worker.on('ready', () => {
  console.log('[Worker] Media processing worker started and listening...');
});

// Setup DB connection
db.connect().catch((err) => {
  console.error('[Worker] Failed to connect to DB', err);
  process.exit(1);
});

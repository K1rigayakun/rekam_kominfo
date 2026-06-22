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

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} wajib diisi`);
  }
  return value;
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
const IMAGE_PREVIEW_QUALITY = Number(process.env.IMAGE_PREVIEW_QUALITY || 90);
const IMAGE_THUMBNAIL_QUALITY = Number(process.env.IMAGE_THUMBNAIL_QUALITY || 75);
const VIDEO_CRF = process.env.VIDEO_CRF || '23';
const VIDEO_PRESET = process.env.VIDEO_PRESET || 'fast';

if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}
if (process.env.FFPROBE_PATH) {
  ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);
}

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
    .webp({ quality: IMAGE_PREVIEW_QUALITY })
    .toFile(tmpProcessedPath);

  // Buat thumbnail - WEBP 400x400
  const thumbnailKey = `${activityId}/${sectionId}/${uuid}_thumb.webp`;
  const tmpThumbPath = path.join(os.tmpdir(), `thumb_${mediaId}.webp`);

  await sharp(tmpRawPath)
    .resize(400, 400, { fit: 'cover' })
    .webp({ quality: IMAGE_THUMBNAIL_QUALITY })
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
        `-preset ${VIDEO_PRESET}`,
        `-crf ${VIDEO_CRF}`,
        '-c:a aac',
        '-b:a 160k',
        '-movflags +faststart',
        '-pix_fmt yuv420p'
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
    // 1. Get metadata first
    ffmpeg.ffprobe(tmpRawPath, async (err, metadata) => {
      let sourceWidth: number | null = null;
      let sourceHeight: number | null = null;
      let duration: number | null = null;

      if (!err && metadata) {
        const stream = metadata.streams.find((s) => s.codec_type === 'video');
        if (stream) {
          sourceWidth = stream.width || null;
          sourceHeight = stream.height || null;
        }
        duration = metadata.format.duration || null;
      }

      // Filter resolutions to prevent upscaling
      const allResolutions = [
        { label: '360p', height: 360 },
        { label: '480p', height: 480 },
        { label: '720p', height: 720 },
        { label: '1080p', height: 1080 }
      ];

      const resolutions = allResolutions.filter(res => {
        // If we can't determine source height, we allow up to 720p as fallback
        if (!sourceHeight) return res.height <= 720; 
        
        // Allow if target height is less than or slightly larger (to account for odd resolutions like 718p)
        return res.height <= sourceHeight + 10;
      });

      // If source is very small, ensure at least one resolution (e.g. 360p) is generated
      if (resolutions.length === 0) {
        resolutions.push(allResolutions[0]);
      }

      // 2. Extract thumbnail
      ffmpeg(tmpRawPath)
        .screenshots({
          count: 1,
          folder: os.tmpdir(),
          filename: `thumb_${mediaId}.jpg`,
          size: '400x400',
          timemarks: ['10%']
        })
        .on('end', async () => {
          try {
            // Convert thumb.jpg to thumb.webp using sharp
            if (fs.existsSync(tmpThumbPath)) {
              await sharp(tmpThumbPath)
                .resize(400, 400, { fit: 'cover' })
                .webp({ quality: IMAGE_THUMBNAIL_QUALITY })
                .toFile(finalThumbPath);

              // Upload thumbnail
              await minio.fPutObject(PROCESSED_BUCKET, finalThumbKey, finalThumbPath, {
                'Content-Type': 'image/webp',
              });
            }

            // 3. Transcoding to multiple resolutions
            for (const res of resolutions) {
              const outPath = path.join(os.tmpdir(), `${mediaId}_${res.label}.mp4`);
              const outKey = `${activityId}/${sectionId}/${uuid}_${res.label}.mp4`;
              console.log(`[Worker] Transcoding video ${mediaId} to ${res.label}... (Source height: ${sourceHeight})`);
              
              await transcodeVideo(tmpRawPath, outPath, res.height.toString());
              await minio.fPutObject(PROCESSED_BUCKET, outKey, outPath, { 'Content-Type': 'video/mp4' });
              qualityVariants[res.label] = outKey;
              
              // Set the highest available as default processed key
              defaultProcessedKey = outKey;
              
              fs.unlinkSync(outPath);
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
              [
                defaultProcessedKey, 
                fs.existsSync(finalThumbPath) ? finalThumbKey : null, 
                JSON.stringify(qualityVariants), 
                sourceWidth, 
                sourceHeight, 
                duration, 
                mediaId
              ]
            );

            // Cleanup
            if (fs.existsSync(tmpRawPath)) fs.unlinkSync(tmpRawPath);
            if (fs.existsSync(tmpThumbPath)) fs.unlinkSync(tmpThumbPath);
            if (fs.existsSync(finalThumbPath)) fs.unlinkSync(finalThumbPath);

            resolve();
          } catch (err) {
            reject(err);
          }
        })
        .on('error', (err) => {
          reject(err);
        });
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
    concurrency: Number(process.env.MEDIA_PROCESSING_CONCURRENCY || 2)
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

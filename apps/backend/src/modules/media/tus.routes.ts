import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Server, EVENTS } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

const TUS_DIR = path.join(os.tmpdir(), 'rekam-tus-upload');
if (!fs.existsSync(TUS_DIR)) {
  fs.mkdirSync(TUS_DIR, { recursive: true });
}

export async function tusRoutes(fastify: FastifyInstance) {
  const tusServer = new Server({
    path: '/api/upload/tus',
    datastore: new FileStore({ directory: TUS_DIR }),
    respectForwardedHeaders: true,
    relativeLocation: true,
  });

  tusServer.on(EVENTS.POST_FINISH, async (req, res, upload) => {
    try {
      const metadata = upload.metadata || {};
      const { activity_id, section_id, mime_type, filename } = metadata;
      const uploaded_by = req.headers['x-user-id'] as string; // Akan di-inject oleh auth hook

      if (!activity_id || !section_id) {
        fastify.log.warn('TUS upload selesai tapi tanpa metadata activity_id/section_id');
        return;
      }

      const mime = mime_type || 'application/octet-stream';
      const isImage = mime.startsWith('image/');
      const isVideo = mime.startsWith('video/');
      const mediaType = isImage ? 'IMAGE' : 'VIDEO';
      const fileExt = path.extname(filename || upload.id);
      const storageKey = `${activity_id}/${section_id}/${randomUUID()}${fileExt}`;

      const filePath = path.join(TUS_DIR, upload.id);
      if (!fs.existsSync(filePath)) {
        fastify.log.error(`File TUS tidak ditemukan di disk: ${filePath}`);
        return;
      }

      // Upload ke MinIO (raw bucket)
      const fileStream = fs.createReadStream(filePath);
      const stat = fs.statSync(filePath);
      
      await fastify.minio.putObject(
        fastify.minioBuckets.raw, 
        storageKey, 
        fileStream, 
        stat.size, 
        { 'Content-Type': mime_type }
      );

      // Simpan record di database
      const { rows } = await fastify.db.query(
        `INSERT INTO media_files 
         (section_id, activity_id, original_filename, media_type, mime_type, 
          file_size_bytes, storage_key_raw, status, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PROCESSING', $8)
         RETURNING id`,
        [
          section_id, activity_id, filename || upload.id, mediaType, mime || 'application/octet-stream',
          stat.size, storageKey, uploaded_by,
        ]
      );

      const mediaId = rows[0].id;

      // Tambahkan job ke antrean BullMQ
      await fastify.mediaQueue.add('process-media', {
        mediaId,
        activityId: activity_id,
        sectionId: section_id,
        mimeType: mime || 'application/octet-stream',
        mediaType,
        storageKeyRaw: storageKey,
      });

      // Hapus file sementara
      fs.unlinkSync(filePath);
      const infoPath = `${filePath}.info`;
      if (fs.existsSync(infoPath)) {
        fs.unlinkSync(infoPath);
      }

      fastify.log.info(`TUS upload komplit dan diproses ke MinIO: ${upload.id}`);
    } catch (err) {
      fastify.log.error(err, 'Gagal memproses TUS upload ke MinIO');
    }
  });

  // Karena TUS butuh auth, kita set hook manual untuk mengecek token, 
  // lalu inject ke req headers agar terbaca di event POST_FINISH
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/upload/tus')) {
      try {
        await request.jwtVerify();
        if (request.user && (request.user as any).id) {
          request.raw.headers['x-user-id'] = (request.user as any).id;
        }
      } catch (err) {
        // TUS preflight CORS option req doesn't need auth, but POST/PATCH does
        if (request.method !== 'OPTIONS') {
          return reply.status(401).send({ error: 'Unauthorized' });
        }
      }
    }
  });

  // Menangkap semua request ke /api/upload/tus
  fastify.all('/api/upload/tus', async (request, reply) => {
    tusServer.handle(request.raw, reply.raw);
    reply.hijack();
  });

  fastify.all('/api/upload/tus/*', async (request, reply) => {
    tusServer.handle(request.raw, reply.raw);
    reply.hijack();
  });
}

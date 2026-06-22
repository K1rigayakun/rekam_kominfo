import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Server } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { createHash, randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

const TUS_DIR = process.env.TUS_STORE_PATH
  ? path.resolve(process.env.TUS_STORE_PATH)
  : path.join(os.tmpdir(), 'rekam-tus-upload');
if (!fs.existsSync(TUS_DIR)) {
  fs.mkdirSync(TUS_DIR, { recursive: true });
}

async function sha256File(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function cleanupTusFiles(uploadId: string) {
  const filePath = path.join(TUS_DIR, uploadId);
  const infoPath = `${filePath}.info`;

  for (const candidate of [filePath, infoPath]) {
    if (fs.existsSync(candidate)) {
      fs.unlinkSync(candidate);
    }
  }
}

function tusError(statusCode: number, body: string) {
  return { status_code: statusCode, body };
}

export async function tusRoutes(fastify: FastifyInstance) {
  function activityAccessCondition(alias: string, userIdParam: number, districtIdParam: number) {
    return `(
      ${alias}.created_by = $${userIdParam}
      OR (${alias}.district_id IS NOT NULL AND ${alias}.district_id = $${districtIdParam})
      OR EXISTS (
        SELECT 1 FROM team_members tm
        WHERE tm.team_id = ${alias}.team_id
          AND tm.user_id = $${userIdParam}
      )
    )`;
  }

  async function canAccessActivity(activityId: string, user: { id: string; role: string; district_id: string | null }) {
    if (user.role === 'SUPER_ADMIN') return true;

    const { rowCount } = await fastify.db.query(
      `SELECT 1
       FROM activities a
       WHERE a.id = $1
         AND ${activityAccessCondition('a', 2, 3)}
       LIMIT 1`,
      [activityId, user.id, user.district_id]
    );

    return Number(rowCount) > 0;
  }

  async function sectionBelongsToActivity(sectionId: string | undefined, activityId: string) {
    if (!sectionId) return true;

    const { rowCount } = await fastify.db.query(
      'SELECT 1 FROM event_sections WHERE id = $1 AND activity_id = $2 LIMIT 1',
      [sectionId, activityId]
    );

    return Number(rowCount) > 0;
  }

  const tusServer = new Server({
    path: '/api/upload/tus',
    datastore: new FileStore({ directory: TUS_DIR }),
    respectForwardedHeaders: true,
    relativeLocation: true,
    onUploadFinish: async (req, res, upload) => {
      const metadata = upload.metadata || {};
      const {
        activity_id,
        section_id,
        filename,
        auto_naming,
      } = metadata;
      const normalizedSectionId = section_id && !['null', 'flat'].includes(section_id) ? section_id : undefined;
      const mime = metadata.mime_type || metadata.filetype || 'application/octet-stream';
      const sha256Local = metadata.sha256_local || metadata.checksum_sha256 || '';
      const uploaded_by = req.headers['x-user-id'] as string;
      const uploadUser = {
        id: uploaded_by,
        role: (req.headers['x-user-role'] as string) || '',
        district_id: (req.headers['x-user-district-id'] as string) || null,
      };

      if (!activity_id) {
        throw tusError(400, 'Metadata activity_id wajib disertakan');
      }

      if (!uploadUser.id) {
        cleanupTusFiles(upload.id);
        throw tusError(401, 'Unauthorized');
      }

      if (!['SUPER_ADMIN', 'EDITOR'].includes(uploadUser.role)) {
        cleanupTusFiles(upload.id);
        throw tusError(403, 'Akses ditolak: hanya EDITOR atau lebih tinggi');
      }

      if (!(await canAccessActivity(activity_id, uploadUser))) {
        cleanupTusFiles(upload.id);
        throw tusError(403, 'Akses acara ditolak');
      }

      if (!(await sectionBelongsToActivity(normalizedSectionId, activity_id))) {
        cleanupTusFiles(upload.id);
        throw tusError(400, 'Seksi tidak ditemukan pada acara ini');
      }

      const isImage = mime.startsWith('image/');
      const isVideo = mime.startsWith('video/');
      if (!isImage && !isVideo) {
        cleanupTusFiles(upload.id);
        throw tusError(400, 'Hanya file gambar atau video yang diterima');
      }

      const mediaType = isImage ? 'IMAGE' : 'VIDEO';
      const fileExt = path.extname(filename || upload.id);
      const storageKey = `${activity_id}/${normalizedSectionId || 'unsectioned'}/${randomUUID()}${fileExt}`;

      const filePath = path.join(TUS_DIR, upload.id);
      if (!fs.existsSync(filePath)) {
        throw tusError(500, 'File TUS tidak ditemukan setelah upload selesai');
      }

      const checksumSha256 = await sha256File(filePath);
      if (sha256Local && checksumSha256 !== sha256Local) {
        fastify.log.error(
          { upload_id: upload.id, checksumSha256, sha256_local: sha256Local },
          'SHA-256 upload TUS tidak cocok'
        );
        await fastify.db.query(
          `INSERT INTO audit_logs (user_id, action, entity_type, details, ip_address)
           VALUES ($1, 'UPLOAD', 'media_file', $2, $3)`,
          [
            uploaded_by || null,
            JSON.stringify({
              status: 'REJECTED_SHA256_MISMATCH',
              filename: filename || upload.id,
              checksum_server: checksumSha256,
              checksum_local: sha256Local,
            }),
            req.socket.remoteAddress || null,
          ]
        );
        cleanupTusFiles(upload.id);
        throw tusError(409, 'SHA-256 upload tidak cocok. File ditolak.');
      }

      // Upload ke MinIO (raw bucket)
      const fileStream = fs.createReadStream(filePath);
      const stat = fs.statSync(filePath);
      
      await fastify.minio.putObject(
        fastify.minioBuckets.raw, 
        storageKey, 
        fileStream, 
        stat.size, 
        { 'Content-Type': mime }
      );

      let autoTitle: string | null = null;
      let titleIsAutoGen = false;

      if (auto_naming === 'true') {
        const { rows: actRows } = await fastify.db.query('SELECT title FROM activities WHERE id = $1', [activity_id]);
        if (actRows.length > 0) {
           const actTitle = actRows[0].title;
           const prefix = isVideo ? 'Video' : 'Foto';
           
           let sectionTitle = '';
           if (normalizedSectionId) {
             const { rows: secRows } = await fastify.db.query('SELECT title FROM event_sections WHERE id = $1', [normalizedSectionId]);
             if (secRows.length > 0) {
               sectionTitle = ` - ${secRows[0].title}`;
             }
           }
           
           // Count existing media of same type in the same section (or activity if no section)
           let countQuery = 'SELECT COUNT(*) as count FROM media_files WHERE activity_id = $1 AND media_type = $2';
           let countParams: any[] = [activity_id, mediaType];
           if (normalizedSectionId) {
             countQuery += ' AND section_id = $3';
             countParams.push(normalizedSectionId);
           } else {
             countQuery += ' AND section_id IS NULL';
           }
           
           const { rows: countRows } = await fastify.db.query(countQuery, countParams);
           const currentCount = parseInt(countRows[0].count, 10);
           
           autoTitle = `${actTitle}${sectionTitle} - ${prefix} ${String(currentCount + 1).padStart(2, '0')}`;
           titleIsAutoGen = true;
        }
      }

      // Simpan record di database
      const { rows } = await fastify.db.query(
        `INSERT INTO media_files 
         (section_id, activity_id, original_filename, media_type, mime_type, 
          file_size_bytes, storage_key_raw, checksum_sha256, status, uploaded_by, title, title_is_auto_gen)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PROCESSING', $9, $10, $11)
         RETURNING id`,
        [
          normalizedSectionId || null, activity_id, filename || upload.id, mediaType, mime || 'application/octet-stream',
          stat.size, storageKey, checksumSha256, uploaded_by, autoTitle, titleIsAutoGen
        ]
      );

      const mediaId = rows[0].id;

      // Tambahkan job ke antrean BullMQ
      await fastify.mediaQueue.add('process-media', {
        mediaId,
        activityId: activity_id,
        sectionId: normalizedSectionId || null,
        mimeType: mime || 'application/octet-stream',
        mediaType,
        storageKeyRaw: storageKey,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }
      });

      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'UPLOAD', 'media_file', $2, $3, $4)`,
        [
          uploaded_by || null,
          mediaId,
          JSON.stringify({
            filename: filename || upload.id,
            media_type: mediaType,
            checksum_sha256: checksumSha256,
            upload_protocol: 'tus',
          }),
          req.socket.remoteAddress || null,
        ]
      );

      // Hapus file sementara
      cleanupTusFiles(upload.id);

      fastify.log.info(`TUS upload komplit dan diproses ke MinIO: ${upload.id}`);
      return { res };
    },
  });

  // Karena TUS memakai raw handler, auth diverifikasi di hook ini lalu user id
  // dioper ke request raw agar bisa dipakai saat onUploadFinish berjalan.
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/upload/tus')) {
      try {
        await request.jwtVerify();
        if (request.user && (request.user as any).id) {
          const user = request.user as any;
          request.raw.headers['x-user-id'] = user.id;
          request.raw.headers['x-user-role'] = user.role || '';
          request.raw.headers['x-user-district-id'] = user.district_id || '';
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

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import archiver from 'archiver';
import { createHash, randomUUID } from 'crypto';
import path from 'path';

/**
 * Public routes — TANPA autentikasi.
 * Diakses oleh siapa pun yang memiliki token dari QR code.
 */
export async function publicRoutes(fastify: FastifyInstance) {
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
    if (quality === 'thumbnail') {
      return {
        bucket: fastify.minioBuckets.processed,
        key: file.storage_key_thumbnail || file.storage_key_processed,
        contentType: 'image/webp',
      };
    }

    if (quality === 'preview') {
      return {
        bucket: fastify.minioBuckets.processed,
        key: file.storage_key_processed,
        contentType: file.media_type === 'VIDEO' ? 'video/mp4' : 'image/webp',
      };
    }

    if (['360p', '480p', '720p', '1080p'].includes(quality)) {
      return {
        bucket: fastify.minioBuckets.processed,
        key: getQualityVariant(file.quality_variants, quality),
        contentType: 'video/mp4',
      };
    }

    return {
      bucket: fastify.minioBuckets.raw,
      key: file.storage_key_raw,
      contentType: file.mime_type,
    };
  }

  function applyDefaultPublicQuality(downloadQuality: string, requestedQuality?: string) {
    if (requestedQuality) return requestedQuality;
    return downloadQuality === 'PREVIEW' ? 'preview' : 'original';
  }

  function isPublicQualityAllowed(downloadQuality: string, quality: string) {
    if (quality === 'thumbnail') return true;
    if (downloadQuality === 'BOTH') return true;
    if (downloadQuality === 'ORIGINAL') return quality === 'original';
    if (downloadQuality === 'PREVIEW') return quality !== 'original';
    return false;
  }

  function parseByteRange(rangeHeader: string | string[] | undefined, fileSize: number) {
    const range = Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader;
    if (!range) return { valid: true, range: null };

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      return { valid: false, range: null };
    }

    let start: number;
    let end: number;

    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        return { valid: false, range: null };
      }
      start = Math.max(fileSize - suffixLength, 0);
      end = fileSize - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : fileSize - 1;
    }

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      start >= fileSize
    ) {
      return { valid: false, range: null };
    }

    end = Math.min(end, fileSize - 1);
    return { valid: true, range: { start, end, length: end - start + 1 } };
  }

  // ─── GET /p/:token/info ────────────────────
  // Mendapatkan info snapshot (tanpa file, hanya metadata)
  fastify.get('/:token/info', async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    const { token } = request.params;

    const { rows: snapshot } = await fastify.db.query(
      `SELECT ss.id, ss.title, ss.download_quality, ss.is_active, ss.expires_at, ss.config,
              a.title as activity_title, a.event_date, a.location, a.description_json as activity_description_json
       FROM sharing_snapshots ss
       JOIN activities a ON a.id = ss.activity_id
       WHERE ss.token = $1`,
      [token]
    );

    if (snapshot.length === 0) {
      return reply.status(404).send({ error: 'Halaman tidak ditemukan' });
    }

    const snap = snapshot[0];

    // Cek apakah aktif
    if (!snap.is_active) {
      return reply.status(410).send({ error: 'Link ini sudah tidak aktif' });
    }

    // Cek apakah sudah expired
    if (snap.expires_at && new Date(snap.expires_at) < new Date()) {
      return reply.status(410).send({ error: 'Link ini sudah kedaluwarsa' });
    }

    // Log scan
    const ipHash = createHash('sha1').update(request.ip).digest('hex');
    await fastify.db.query(
      `INSERT INTO qr_scan_logs (snapshot_id, ip_address, user_agent)
       VALUES ($1, $2, $3)`,
      [snap.id, ipHash, request.headers['user-agent'] || '']
    );

    // Update total_scans
    await fastify.db.query(
      'UPDATE sharing_snapshots SET total_scans = total_scans + 1 WHERE id = $1',
      [snap.id]
    );

    return reply.send({ data: snap });
  });

  // ─── GET /p/:token/media ───────────────────
  // Mendapatkan daftar media yang di-share dalam snapshot ini
  fastify.get('/:token/media', async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    const { token } = request.params;

    // Verifikasi snapshot aktif
    const { rows: snapshot } = await fastify.db.query(
      'SELECT id, is_active, expires_at, download_quality, config FROM sharing_snapshots WHERE token = $1',
      [token]
    );

    if (snapshot.length === 0 || !snapshot[0].is_active) {
      return reply.status(404).send({ error: 'Halaman tidak ditemukan' });
    }

    if (snapshot[0].expires_at && new Date(snapshot[0].expires_at) < new Date()) {
      return reply.status(410).send({ error: 'Link ini sudah kedaluwarsa' });
    }

    const snapshotId = snapshot[0].id;

    // Ambil items yang di-share, join dengan media_files dan sections
    const { rows: items } = await fastify.db.query(
      `SELECT ssi.sort_order,
              es.id as section_id, es.title as section_title,
              mf.id as media_id, mf.display_name, mf.original_filename, 
              mf.media_type, mf.mime_type, mf.title as media_title,
              mf.duration_seconds, mf.status, mf.quality_variants,
              (SELECT json_agg(json_build_object('id', p.id, 'full_name', p.full_name))
               FROM media_person_tags mpt
               JOIN persons p ON p.id = mpt.person_id
               WHERE mpt.media_id = mf.id) as persons
       FROM sharing_snapshot_items ssi
       LEFT JOIN event_sections es ON es.id = ssi.section_id
       LEFT JOIN media_files mf ON mf.id = ssi.media_id
       WHERE ssi.snapshot_id = $1
       ORDER BY ssi.sort_order`,
      [snapshotId]
    );

    // Kelompokkan berdasarkan section
    const sections: Record<string, any> = {};
    for (const item of items) {
      const secId = item.section_id || 'unsectioned';
      if (!sections[secId]) {
        sections[secId] = {
          id: item.section_id,
          title: item.section_title || '',
          media: [],
        };
      }
      if (item.media_id) {
        sections[secId].media.push({
          id: item.media_id,
          display_name: item.display_name || item.original_filename,
          media_type: item.media_type,
          title: item.media_title,
          description: item.media_description,
          width: item.width,
          height: item.height,
          duration_seconds: item.duration_seconds,
          quality_variants: item.quality_variants,
          persons: item.persons || [],
        });
      }
    }

    return reply.send({
      data: {
        download_quality: snapshot[0].download_quality,
        config: snapshot[0].config,
        sections: Object.values(sections),
      },
    });
  });

  // ─── POST /p/:token/download-batch/zip ──────────────────
  fastify.post('/:token/download-batch/zip', async (request: FastifyRequest<{ Params: { token: string }; Body: { quality?: string; media_ids: string[] } }>, reply: FastifyReply) => {
    const { token } = request.params;
    const { quality: requestedQuality, media_ids } = request.body || {};

    if (!Array.isArray(media_ids) || media_ids.length === 0) {
      return reply.status(400).send({ error: 'Tidak ada media yang dipilih' });
    }

    // Verifikasi snapshot aktif
    const { rows: snapshot } = await fastify.db.query(
      `SELECT ss.id, ss.title, ss.download_quality, ss.is_active, ss.expires_at,
              a.title as activity_title, a.event_date
       FROM sharing_snapshots ss
       JOIN activities a ON a.id = ss.activity_id
       WHERE ss.token = $1`,
      [token]
    );

    if (snapshot.length === 0 || !snapshot[0].is_active) {
      return reply.status(404).send({ error: 'Link tidak ditemukan' });
    }

    const snap = snapshot[0];
    if (snap.expires_at && new Date(snap.expires_at) < new Date()) {
      return reply.status(410).send({ error: 'Link ini sudah kedaluwarsa' });
    }

    const quality = applyDefaultPublicQuality(snap.download_quality, requestedQuality);
    if (!isPublicQualityAllowed(snap.download_quality, quality)) {
      return reply.status(403).send({ error: 'Kualitas download ini tidak diizinkan untuk link publik' });
    }

    // 1. Buat record export_job
    const entityType = quality === 'preview' ? 'public_batch_zip_preview' : 'public_batch_zip_original';
    
    const { rows: jobs } = await fastify.db.query(
      `INSERT INTO export_jobs (user_id, entity_type, entity_id, expires_at)
       VALUES (NULL, $1, $2, NOW() + INTERVAL '24 hours') RETURNING id`,
      [entityType, snap.id]
    );

    const jobId = jobs[0].id;

    // 2. Masukkan ke queue
    await fastify.exportQueue.add('export-zip', {
      jobId,
      entityType,
      entityId: snap.id,
      quality,
      token,
      mediaIds: media_ids
    });

    // 3. Log export request
    await fastify.db.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, details, ip_address)
       VALUES ('EXPORT', 'snapshot', $1, $2, $3)`,
      [snap.id, JSON.stringify({ type: 'BATCH_ZIP_REQUEST', via: 'public', token, quality, count: media_ids.length }), request.ip]
    );

    return reply.status(202).send({ message: 'Proses ekspor batch ZIP dimulai', job_id: jobId });
  });

  // ─── GET /p/:token/download/:mediaId ───────
  // Download satu file media dari halaman publik
  fastify.get(
    '/:token/download/:mediaId',
    async (
      request: FastifyRequest<{ Params: { token: string; mediaId: string }; Querystring: { quality?: string; inline?: string } }>,
      reply: FastifyReply
    ) => {
      const { token, mediaId } = request.params;
      const requestedQuality = (request.query as any).quality as string | undefined;

      // Verifikasi snapshot aktif
      const { rows: snapshot } = await fastify.db.query(
        'SELECT id, is_active, expires_at, download_quality FROM sharing_snapshots WHERE token = $1',
        [token]
      );

      if (snapshot.length === 0 || !snapshot[0].is_active) {
        return reply.status(404).send({ error: 'Link tidak ditemukan' });
      }

      if (snapshot[0].expires_at && new Date(snapshot[0].expires_at) < new Date()) {
        return reply.status(410).send({ error: 'Link ini sudah kedaluwarsa' });
      }

      const quality = applyDefaultPublicQuality(snapshot[0].download_quality, requestedQuality);
      if (!isPublicQualityAllowed(snapshot[0].download_quality, quality)) {
        return reply.status(403).send({ error: 'Kualitas download ini tidak diizinkan untuk link publik' });
      }

      // Cek apakah media ini termasuk dalam snapshot
      const { rows: snapshotItem } = await fastify.db.query(
        'SELECT id FROM sharing_snapshot_items WHERE snapshot_id = $1 AND media_id = $2',
        [snapshot[0].id, mediaId]
      );

      if (snapshotItem.length === 0) {
        return reply.status(403).send({ error: 'Media ini tidak termasuk dalam link yang dibagikan' });
      }

      // Ambil file
      const { rows: media } = await fastify.db.query(
        'SELECT * FROM media_files WHERE id = $1',
        [mediaId]
      );

      if (media.length === 0) {
        return reply.status(404).send({ error: 'Media tidak ditemukan' });
      }

      const file = media[0];
      const { bucket, key, contentType } = resolveDownloadTarget(file, quality);

      if (!key) {
        return reply.status(404).send({ error: 'File resolusi tersebut tidak tersedia' });
      }

      const stat = await fastify.minio.statObject(bucket, key);
      const fileSize = stat.size;

      reply.header('Content-Type', contentType);
      const disposition = request.query.inline === 'true' ? 'inline' : 'attachment';
      reply.header(
        'Content-Disposition',
        `${disposition}; filename="${file.display_name || file.original_filename}"`
      );

      let stream;
      const parsedRange = parseByteRange(request.headers.range, fileSize);

      if (!parsedRange.valid) {
        return reply
          .status(416)
          .header('Content-Range', `bytes */${fileSize}`)
          .send({ error: 'Range tidak valid' });
      }

      if (parsedRange.range) {
        reply.code(206);
        reply.header('Content-Range', `bytes ${parsedRange.range.start}-${parsedRange.range.end}/${fileSize}`);
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Content-Length', parsedRange.range.length);

        stream = await fastify.minio.getPartialObject(bucket, key, parsedRange.range.start, parsedRange.range.length);
      } else {
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Content-Length', fileSize);
        stream = await fastify.minio.getObject(bucket, key);
      }

      // Log download
      await fastify.db.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, details, ip_address)
         VALUES ('DOWNLOAD', 'media_file', $1, $2, $3)`,
        [mediaId, JSON.stringify({ via: 'public', token, range: Boolean(parsedRange.range) }), request.ip]
      );

      return reply.send(stream);
    }
  );

  // ─── GET /p/:token/attachments ─────────────
  // Mendapatkan daftar lampiran jika diizinkan di config
  fastify.get('/:token/attachments', async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    const { token } = request.params;

    const { rows: snapshot } = await fastify.db.query(
      'SELECT id, activity_id, is_active, expires_at, config FROM sharing_snapshots WHERE token = $1',
      [token]
    );

    if (snapshot.length === 0 || !snapshot[0].is_active) {
      return reply.send({ data: [] });
    }

    if (snapshot[0].expires_at && new Date(snapshot[0].expires_at) < new Date()) {
      return reply.send({ data: [] });
    }

    const config = snapshot[0].config || {};
    if (!config.share_attachments) {
      return reply.send({ data: [] });
    }

    const { rows } = await fastify.db.query(
      `SELECT id, original_filename, display_name, file_size_bytes 
       FROM event_attachments 
       WHERE activity_id = $1
       ORDER BY created_at ASC`,
      [snapshot[0].activity_id]
    );

    // Filter by allowed_attachment_ids if it exists
    let finalRows = rows;
    if (Array.isArray(config.allowed_attachment_ids) && config.allowed_attachment_ids.length > 0) {
      finalRows = rows.filter((r: any) => config.allowed_attachment_ids.includes(r.id));
    }

    return reply.send({ data: finalRows });
  });

  // ─── GET /p/:token/attachments/:id/download 
  // Download lampiran dari public view
  fastify.get('/:token/attachments/:id/download', async (request: FastifyRequest<{ Params: { token: string; id: string } }>, reply: FastifyReply) => {
    const { token, id } = request.params;

    const { rows: snapshot } = await fastify.db.query(
      'SELECT activity_id, is_active, expires_at, config FROM sharing_snapshots WHERE token = $1',
      [token]
    );

    if (snapshot.length === 0 || !snapshot[0].is_active) {
      return reply.status(404).send({ error: 'Link tidak ditemukan' });
    }

    if (snapshot[0].expires_at && new Date(snapshot[0].expires_at) < new Date()) {
      return reply.status(410).send({ error: 'Link ini sudah kedaluwarsa' });
    }

    const config = snapshot[0].config || {};
    if (!config.share_attachments) {
      return reply.status(403).send({ error: 'Lampiran tidak dibagikan' });
    }

    if (Array.isArray(config.allowed_attachment_ids) && config.allowed_attachment_ids.length > 0) {
      if (!config.allowed_attachment_ids.includes(id)) {
        return reply.status(403).send({ error: 'Lampiran ini tidak dibagikan' });
      }
    }

    const { rows: attachments } = await fastify.db.query(
      'SELECT * FROM event_attachments WHERE id = $1 AND activity_id = $2',
      [id, snapshot[0].activity_id]
    );

    if (attachments.length === 0) {
      return reply.status(404).send({ error: 'Lampiran tidak ditemukan' });
    }

    const file = attachments[0];
    const stream = await fastify.minio.getObject(
      fastify.minioBuckets.attach,
      file.storage_key
    );

    reply.header('Content-Type', file.mime_type);
    reply.header(
      'Content-Disposition',
      `attachment; filename="${file.display_name || file.original_filename}"`
    );

    // Log audit
    await fastify.db.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, details, ip_address)
       VALUES ('DOWNLOAD', 'attachment', $1, $2, $3)`,
      [id, JSON.stringify({ via: 'public', token }), request.ip]
    );

    return reply.send(stream);
  });

  // ─── GET /p/:token/download-all/zip ─────────
  fastify.get('/:token/download-all/zip', async (request: FastifyRequest<{ Params: { token: string }; Querystring: { quality?: string } }>, reply: FastifyReply) => {
    const { token } = request.params;
    const requestedQuality = (request.query as any).quality as string | undefined;

    // Verifikasi snapshot aktif
    const { rows: snapshot } = await fastify.db.query(
      `SELECT ss.id, ss.title, ss.download_quality, ss.is_active, ss.expires_at,
              a.title as activity_title, a.event_date
       FROM sharing_snapshots ss
       JOIN activities a ON a.id = ss.activity_id
       WHERE ss.token = $1`,
      [token]
    );

    if (snapshot.length === 0 || !snapshot[0].is_active) {
      return reply.status(404).send({ error: 'Link tidak ditemukan' });
    }

    const snap = snapshot[0];
    if (snap.expires_at && new Date(snap.expires_at) < new Date()) {
      return reply.status(410).send({ error: 'Link ini sudah kedaluwarsa' });
    }

    const quality = applyDefaultPublicQuality(snap.download_quality, requestedQuality);
    if (!isPublicQualityAllowed(snap.download_quality, quality)) {
      return reply.status(403).send({ error: 'Kualitas download ini tidak diizinkan untuk link publik' });
    }

    // 1. Buat record export_job
    const entityType = quality === 'preview' ? 'public_zip_preview' : 'public_zip_original';
    
    const { rows: jobs } = await fastify.db.query(
      `INSERT INTO export_jobs (user_id, entity_type, entity_id, expires_at)
       VALUES (NULL, $1, $2, NOW() + INTERVAL '24 hours') RETURNING id`,
      [entityType, snap.id]
    );

    const jobId = jobs[0].id;

    // 2. Masukkan ke queue
    await fastify.exportQueue.add('export-zip', {
      jobId,
      entityType,
      entityId: snap.id,
      quality,
      token
    });

    // 3. Log export request
    await fastify.db.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, details, ip_address)
       VALUES ('EXPORT', 'snapshot', $1, $2, $3)`,
      [snap.id, JSON.stringify({ type: 'ZIP_REQUEST', via: 'public', token, quality }), request.ip]
    );

    return reply.status(202).send({ message: 'Proses ekspor ZIP dimulai', job_id: jobId });
  });

  // ─── GET /p/:token/export-jobs/:jobId ────────
  fastify.get('/:token/export-jobs/:jobId', async (request: FastifyRequest<{ Params: { token: string; jobId: string } }>, reply: FastifyReply) => {
    const { token, jobId } = request.params;
    
    const { rows: snapshot } = await fastify.db.query('SELECT id, is_active FROM sharing_snapshots WHERE token = $1', [token]);
    if (snapshot.length === 0 || !snapshot[0].is_active) {
      return reply.status(404).send({ error: 'Link tidak ditemukan' });
    }

    const { rows: jobs } = await fastify.db.query(
      `SELECT status, error_message FROM export_jobs WHERE id = $1 AND entity_id = $2`,
      [jobId, snapshot[0].id]
    );

    if (jobs.length === 0) return reply.status(404).send({ error: 'Job tidak ditemukan' });

    return reply.send(jobs[0]);
  });

  // ─── GET /p/:token/export-jobs/:jobId/download 
  fastify.get('/:token/export-jobs/:jobId/download', async (request: FastifyRequest<{ Params: { token: string; jobId: string } }>, reply: FastifyReply) => {
    const { token, jobId } = request.params;

    const { rows: snapshot } = await fastify.db.query('SELECT id, is_active FROM sharing_snapshots WHERE token = $1', [token]);
    if (snapshot.length === 0 || !snapshot[0].is_active) return reply.status(404).send({ error: 'Link tidak ditemukan' });

    const { rows: jobs } = await fastify.db.query(
      `SELECT status, storage_key, file_name, entity_type FROM export_jobs WHERE id = $1 AND entity_id = $2`,
      [jobId, snapshot[0].id]
    );

    if (jobs.length === 0) return reply.status(404).send({ error: 'Job tidak ditemukan' });

    const job = jobs[0];
    if (job.status !== 'COMPLETED' || !job.storage_key) {
      return reply.status(400).send({ error: 'File export belum siap atau gagal diproses' });
    }

    try {
      const stream = await fastify.minio.getObject(fastify.minioBuckets.exports, job.storage_key);
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${job.file_name}"`);
      
      await fastify.db.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, details, ip_address)
         VALUES ('DOWNLOAD', $1, $2, $3, $4)`,
        [job.entity_type, snapshot[0].id, JSON.stringify({ via: 'public', token, jobId }), request.ip]
      );

      return reply.send(stream);
    } catch (err: any) {
      return reply.status(500).send({ error: 'Gagal mengambil file export' });
    }
  });

  // ─── POST /p/:token/upload ─────────────────
  // Upload publik hanya aktif untuk snapshot QR yang mengizinkannya.
  fastify.post('/:token/upload', async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    const { token } = request.params;

    const { rows: snapshot } = await fastify.db.query(
      'SELECT id, activity_id, is_active, expires_at, config FROM sharing_snapshots WHERE token = $1',
      [token]
    );

    if (snapshot.length === 0 || !snapshot[0].is_active) {
      return reply.status(404).send({ error: 'Link tidak ditemukan' });
    }

    if (snapshot[0].expires_at && new Date(snapshot[0].expires_at) < new Date()) {
      return reply.status(410).send({ error: 'Link ini sudah kedaluwarsa' });
    }

    const config = snapshot[0].config || {};
    if (!config.allow_upload) {
      return reply.status(403).send({ error: 'Upload publik tidak diizinkan untuk link ini' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'File wajib disertakan' });
    }

    const sectionId = (data.fields as any).section_id?.value || null;
    const activityId = snapshot[0].activity_id;
    const publicUploadLimitBytes = Number(process.env.PUBLIC_UPLOAD_MAX_BYTES || 100 * 1024 * 1024);
    const contentLength = Number(request.headers['content-length'] || 0);

    if (contentLength > publicUploadLimitBytes) {
      return reply.status(413).send({ error: 'Ukuran file melebihi batas upload publik' });
    }

    if (sectionId) {
      const { rowCount } = await fastify.db.query(
        `SELECT 1
         FROM event_sections es
         JOIN sharing_snapshot_items ssi ON ssi.section_id = es.id
         WHERE es.id = $1 AND es.activity_id = $2 AND ssi.snapshot_id = $3
         LIMIT 1`,
        [sectionId, activityId, snapshot[0].id]
      );
      if (Number(rowCount) === 0) {
        return reply.status(400).send({ error: 'Seksi tidak tersedia pada link publik ini' });
      }
    }

    const mimeType = data.mimetype;
    const isImage = mimeType.startsWith('image/');
    const isVideo = mimeType.startsWith('video/');
    if (!isImage && !isVideo) {
      return reply.status(400).send({ error: 'Hanya file gambar atau video yang diterima' });
    }

    const fileBuffer = await data.toBuffer();
    if (fileBuffer.length > publicUploadLimitBytes) {
      return reply.status(413).send({ error: 'Ukuran file melebihi batas upload publik' });
    }

    const mediaType = isImage ? 'IMAGE' : 'VIDEO';
    const fileExt = path.extname(data.filename);
    const storageKey = `${activityId}/${sectionId || 'public-upload'}/${randomUUID()}${fileExt}`;
    const checksumSha256 = createHash('sha256').update(fileBuffer).digest('hex');

    await fastify.minio.putObject(fastify.minioBuckets.raw, storageKey, fileBuffer, fileBuffer.length, {
      'Content-Type': mimeType,
    });

    const { rows } = await fastify.db.query(
      `INSERT INTO media_files 
       (section_id, activity_id, original_filename, media_type, mime_type,
        file_size_bytes, storage_key_raw, checksum_sha256, status, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PROCESSING', NULL)
       RETURNING id, activity_id, original_filename, media_type, mime_type, file_size_bytes, status, created_at`,
      [
        sectionId, activityId, data.filename, mediaType, mimeType,
        fileBuffer.length, storageKey, checksumSha256,
      ]
    );

    const mediaId = rows[0].id;
    await fastify.mediaQueue.add('process-media', {
      mediaId,
      activityId,
      sectionId,
      mimeType,
      mediaType,
      storageKeyRaw: storageKey,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    await fastify.db.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, details, ip_address)
       VALUES ('UPLOAD', 'media_file', $1, $2, $3)`,
      [mediaId, JSON.stringify({ via: 'public', token, snapshot_id: snapshot[0].id, filename: data.filename }), request.ip]
    );

    return reply.status(201).send({ data: rows[0] });
  });
}

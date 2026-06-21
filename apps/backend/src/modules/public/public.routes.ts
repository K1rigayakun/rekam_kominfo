import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import archiver from 'archiver';
import { createHash } from 'crypto';

/**
 * Public routes — TANPA autentikasi.
 * Diakses oleh siapa pun yang memiliki token dari QR code.
 */
export async function publicRoutes(fastify: FastifyInstance) {
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
              mf.description as media_description, mf.width, mf.height,
              mf.duration_seconds, mf.status, mf.quality_variants
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

  // ─── GET /p/:token/download/:mediaId ───────
  // Download satu file media dari halaman publik
  fastify.get(
    '/:token/download/:mediaId',
    async (
      request: FastifyRequest<{ Params: { token: string; mediaId: string }; Querystring: { quality?: string } }>,
      reply: FastifyReply
    ) => {
      const { token, mediaId } = request.params;
      const quality = (request.query as any).quality || 'original';

      // Verifikasi snapshot aktif
      const { rows: snapshot } = await fastify.db.query(
        'SELECT id, is_active, expires_at, download_quality FROM sharing_snapshots WHERE token = $1',
        [token]
      );

      if (snapshot.length === 0 || !snapshot[0].is_active) {
        return reply.status(404).send({ error: 'Link tidak ditemukan' });
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
      let bucket = fastify.minioBuckets.raw;
      let key = file.storage_key_raw;

      if (quality === 'preview') {
        bucket = fastify.minioBuckets.processed;
        key = file.storage_key_processed;
      } else if (quality === '360p' || quality === '720p' || quality === '1080p') {
        bucket = fastify.minioBuckets.processed;
        key = file.quality_variants && file.quality_variants[quality] ? file.quality_variants[quality] : null;
      }

      if (!key) {
        return reply.status(404).send({ error: 'File resolusi tersebut tidak tersedia' });
      }

      const stat = await fastify.minio.statObject(bucket, key);
      const fileSize = stat.size;

      const contentType = quality === 'original' ? file.mime_type : (file.media_type === 'VIDEO' ? 'video/mp4' : 'image/webp');
      reply.header('Content-Type', contentType);
      reply.header(
        'Content-Disposition',
        `attachment; filename="${file.display_name || file.original_filename}"`
      );

      const range = request.headers.range;
      let stream;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;

        reply.code(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Content-Length', chunksize);

        stream = await fastify.minio.getPartialObject(bucket, key, start, chunksize);
      } else {
        reply.header('Content-Length', fileSize);
        stream = await fastify.minio.getObject(bucket, key);
      }

      // Log download
      await fastify.db.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, details, ip_address)
         VALUES ('DOWNLOAD', 'media_file', $1, $2, $3)`,
        [mediaId, JSON.stringify({ via: 'public', token, range: !!range }), request.ip]
      );

      return reply.send(stream);
    }
  );

  // ─── GET /p/:token/attachments ─────────────
  // Mendapatkan daftar lampiran jika diizinkan di config
  fastify.get('/:token/attachments', async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    const { token } = request.params;

    const { rows: snapshot } = await fastify.db.query(
      'SELECT id, activity_id, is_active, config FROM sharing_snapshots WHERE token = $1',
      [token]
    );

    if (snapshot.length === 0 || !snapshot[0].is_active) {
      return reply.send({ data: [] });
    }

    const config = snapshot[0].config || {};
    if (!config.share_attachments) {
      return reply.send({ data: [] });
    }

    const { rows } = await fastify.db.query(
      `SELECT id, original_filename, display_name, file_size_bytes 
       FROM attachments 
       WHERE activity_id = $1
       ORDER BY created_at ASC`,
      [snapshot[0].activity_id]
    );

    return reply.send({ data: rows });
  });

  // ─── GET /p/:token/attachments/:id/download 
  // Download lampiran dari public view
  fastify.get('/:token/attachments/:id/download', async (request: FastifyRequest<{ Params: { token: string; id: string } }>, reply: FastifyReply) => {
    const { token, id } = request.params;

    const { rows: snapshot } = await fastify.db.query(
      'SELECT activity_id, is_active, config FROM sharing_snapshots WHERE token = $1',
      [token]
    );

    if (snapshot.length === 0 || !snapshot[0].is_active) {
      return reply.status(404).send({ error: 'Link tidak ditemukan' });
    }

    const config = snapshot[0].config || {};
    if (!config.share_attachments) {
      return reply.status(403).send({ error: 'Lampiran tidak dibagikan' });
    }

    const { rows: attachments } = await fastify.db.query(
      'SELECT * FROM attachments WHERE id = $1 AND activity_id = $2',
      [id, snapshot[0].activity_id]
    );

    if (attachments.length === 0) {
      return reply.status(404).send({ error: 'Lampiran tidak ditemukan' });
    }

    const file = attachments[0];
    const stream = await fastify.minio.getObject(
      process.env.MINIO_BUCKET_ATTACH || 'rekam-attach',
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
    const quality = (request.query as any).quality || 'original';

    // Verifikasi snapshot aktif
    const { rows: snapshot } = await fastify.db.query(
      `SELECT ss.id, ss.title, ss.download_quality, ss.is_active, 
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
    const safeTitle = (snap.title || snap.activity_title).replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const dateStr = snap.event_date ? new Date(snap.event_date).toISOString().split('T')[0] : 'undated';
    const zipFilename = `REKAM_${safeTitle}_${dateStr}.zip`;

    // Ambil media dalam snapshot
    const { rows: items } = await fastify.db.query(
      `SELECT mf.id, mf.original_filename, mf.display_name, mf.media_type,
              mf.storage_key_raw, mf.storage_key_processed, mf.quality_variants,
              es.title as section_title
       FROM sharing_snapshot_items ssi
       JOIN media_files mf ON mf.id = ssi.media_id
       LEFT JOIN event_sections es ON es.id = mf.section_id
       WHERE ssi.snapshot_id = $1
       ORDER BY es.sort_order, mf.sort_order`,
      [snap.id]
    );

    if (items.length === 0) {
      return reply.status(400).send({ error: 'Tidak ada media untuk didownload' });
    }

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${zipFilename}"`);

    // @ts-ignore
    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(reply.raw);

    for (const media of items) {
      let bucket = fastify.minioBuckets.raw;
      let key = media.storage_key_raw;

      if (quality === 'preview') {
        bucket = fastify.minioBuckets.processed;
        key = media.storage_key_processed;
      } else if (quality === '360p' || quality === '720p' || quality === '1080p') {
        bucket = fastify.minioBuckets.processed;
        key = media.quality_variants && media.quality_variants[quality] ? media.quality_variants[quality] : null;
      }

      if (!key) continue;

      try {
        const stream = await fastify.minio.getObject(bucket, key);
        const folderName = media.section_title ? media.section_title.replace(/[^a-z0-9_]/gi, '_') : 'Media';
        const fileName = media.display_name || media.original_filename;
        archive.append(stream, { name: `${folderName}/${fileName}` });
      } catch (err) {
        console.error(`Error adding ${key} to zip:`, err);
      }
    }

    // Log audit
    await fastify.db.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, details, ip_address)
       VALUES ('EXPORT', 'snapshot', $1, $2, $3)`,
      [snap.id, JSON.stringify({ type: 'ZIP', via: 'public', token, quality }), request.ip]
    );

    await archive.finalize();
  });
}

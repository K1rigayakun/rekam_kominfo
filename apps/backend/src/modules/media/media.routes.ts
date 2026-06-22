import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomUUID, createHash } from 'crypto';
import path from 'path';
import '@fastify/multipart';

const updateMediaSchema = z.object({
  display_name: z.string().max(500).optional(),
  title: z.string().max(500).optional(),
  description: z.string().optional(),
  description_json: z.any().optional(),
  section_id: z.string().uuid().nullable().optional(),
  person_ids: z.array(z.string().uuid()).optional(),
  team_ids: z.array(z.string().uuid()).optional(),
});

const listMediaQuerySchema = z.object({
  section_id: z.string().uuid().optional(),
  activity_id: z.string().uuid().optional(),
  status: z.enum(['UPLOADING', 'PROCESSING', 'READY', 'ERROR']).optional(),
  is_edited: z.coerce.boolean().optional(),
  media_type: z.enum(['IMAGE', 'VIDEO']).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

const reorderMediaSchema = z.object({
  updates: z.array(z.object({
    id: z.string().uuid(),
    section_id: z.string().uuid().nullable().optional(),
    sort_order: z.number().int()
  }))
});

const duplicateBatchSchema = z.object({
  activity_id: z.string().uuid(),
  hashes: z.array(z.string().length(64)).optional(),
  files: z.array(z.object({
    id: z.string().min(1),
    checksum_sha256: z.string().length(64),
  })).optional(),
});

const attachDuplicateSchema = z.object({
  activity_id: z.string().uuid(),
  section_id: z.string().uuid().nullable().optional(),
  checksum_sha256: z.string().length(64),
  filename: z.string().min(1).max(500),
  mime_type: z.string().min(1).max(100).optional(),
});

function mediaTypeFromMime(mimeType: string) {
  if (mimeType.startsWith('image/')) return 'IMAGE';
  if (mimeType.startsWith('video/')) return 'VIDEO';
  return null;
}

export async function mediaRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

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

  async function canAccessActivity(activityId: string, user: NonNullable<FastifyRequest['currentUser']>) {
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

  async function canAccessMedia(mediaId: string, user: NonNullable<FastifyRequest['currentUser']>) {
    if (user.role === 'SUPER_ADMIN') return true;

    const { rowCount } = await fastify.db.query(
      `SELECT 1
       FROM media_files mf
       JOIN activities a ON a.id = mf.activity_id
       WHERE mf.id = $1
         AND ${activityAccessCondition('a', 2, 3)}
       LIMIT 1`,
      [mediaId, user.id, user.district_id]
    );

    return Number(rowCount) > 0;
  }

  async function sectionBelongsToActivity(sectionId: string | null | undefined, activityId: string) {
    if (!sectionId) return true;

    const { rowCount } = await fastify.db.query(
      'SELECT 1 FROM event_sections WHERE id = $1 AND activity_id = $2 LIMIT 1',
      [sectionId, activityId]
    );

    return Number(rowCount) > 0;
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

  function resolveDownloadTarget(media: any, quality: string) {
    if (quality === 'preview') {
      return {
        bucket: fastify.minioBuckets.processed,
        key: media.storage_key_processed,
        contentType: media.media_type === 'VIDEO' ? 'video/mp4' : 'image/webp',
      };
    }

    if (['360p', '480p', '720p', '1080p'].includes(quality)) {
      return {
        bucket: fastify.minioBuckets.processed,
        key: getQualityVariant(media.quality_variants, quality),
        contentType: 'video/mp4',
      };
    }

    return {
      bucket: fastify.minioBuckets.raw,
      key: media.storage_key_raw,
      contentType: media.mime_type,
    };
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

  // ─── GET /api/media ────────────────────────
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listMediaQuerySchema.parse(request.query);
    const offset = (query.page - 1) * query.limit;
    const user = request.currentUser!;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let idx = 1;

    if (user.role !== 'SUPER_ADMIN') {
      whereClause += ` AND EXISTS (
        SELECT 1 FROM activities a
        WHERE a.id = mf.activity_id
          AND ${activityAccessCondition('a', idx, idx + 1)}
      )`;
      params.push(user.id, user.district_id);
      idx += 2;
    }

    if (query.section_id) {
      whereClause += ` AND mf.section_id = $${idx}`;
      params.push(query.section_id);
      idx++;
    }
    if (query.activity_id) {
      whereClause += ` AND mf.activity_id = $${idx}`;
      params.push(query.activity_id);
      idx++;
    }
    if (query.status) {
      whereClause += ` AND mf.status = $${idx}`;
      params.push(query.status);
      idx++;
    }
    if (query.is_edited !== undefined) {
      whereClause += ` AND mf.is_edited = $${idx}`;
      params.push(query.is_edited);
      idx++;
    }
    if (query.media_type) {
      whereClause += ` AND mf.media_type = $${idx}`;
      params.push(query.media_type);
      idx++;
    }

    const countResult = await fastify.db.query(
      `SELECT COUNT(*) as total FROM media_files mf ${whereClause}`,
      params
    );

    const { rows } = await fastify.db.query(
      `SELECT mf.*, u.full_name as uploaded_by_name,
        (SELECT json_agg(
            json_build_object('id', p.id, 'full_name', p.full_name, 'position', p.position)
          )
         FROM media_person_tags mpt
         JOIN persons p ON p.id = mpt.person_id
         WHERE mpt.media_id = mf.id) as persons,
        (SELECT json_agg(
            json_build_object('id', t.id, 'name', t.name, 'district_id', t.district_id)
          )
         FROM media_team_tags mtt
         JOIN teams t ON t.id = mtt.team_id
         WHERE mtt.media_id = mf.id) as teams
         
       FROM media_files mf
       LEFT JOIN users u ON u.id = mf.uploaded_by
       ${whereClause}
       ORDER BY mf.sort_order, mf.created_at
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, query.limit, offset]
    );

    return reply.send({
      data: rows,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: Number(countResult.rows[0].total),
      },
    });
  });

  // ─── GET /api/media/check-duplicate ──────────
  fastify.get('/check-duplicate', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = z.object({ hash: z.string().min(1) }).parse(request.query);
    const user = request.currentUser!;

    const params: any[] = [query.hash];
    let accessClause = '';
    if (user.role !== 'SUPER_ADMIN') {
      accessClause = ` AND ${activityAccessCondition('a', 2, 3)}`;
      params.push(user.id, user.district_id);
    }
    
    const { rows } = await fastify.db.query(
      `SELECT mf.id, mf.display_name
       FROM media_files mf
       JOIN activities a ON a.id = mf.activity_id
       WHERE mf.checksum_sha256 = $1
         ${accessClause}
       LIMIT 1`,
      params
    );

    if (rows.length > 0) {
      return reply.send({ exists: true, message: 'File sudah ada di sistem' });
    }
    return reply.send({ exists: false });
  });

  // ─── POST /api/media/check-duplicate-batch ───
  fastify.post('/check-duplicate-batch', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = duplicateBatchSchema.parse(request.body);
    const user = request.currentUser!;
    const files = body.files || (body.hashes || []).map((hash) => ({ id: hash, checksum_sha256: hash }));
    const hashes = [...new Set(files.map((file) => file.checksum_sha256))];

    if (hashes.length === 0) {
      return reply.send({ existing_hashes: [], data: { results: {} } });
    }

    if (!(await canAccessActivity(body.activity_id, user))) {
      return reply.status(403).send({ error: 'Akses acara ditolak' });
    }

    const accessParams: any[] = [hashes, body.activity_id];
    let accessClause = '';
    if (user.role !== 'SUPER_ADMIN') {
      accessClause = ` AND ${activityAccessCondition('a', 3, 4)}`;
      accessParams.push(user.id, user.district_id);
    }

    const { rows } = await fastify.db.query(
      `SELECT DISTINCT ON (mf.checksum_sha256)
              mf.id, mf.activity_id, mf.checksum_sha256, mf.original_filename, mf.mime_type,
              mf.file_size_bytes, mf.storage_key_raw, mf.status, mf.created_at
       FROM media_files mf
       JOIN activities a ON a.id = mf.activity_id
       WHERE mf.checksum_sha256 = ANY($1::text[])
         AND mf.storage_key_raw IS NOT NULL
         AND mf.status IN ('PROCESSING', 'READY')
         ${accessClause}
       ORDER BY mf.checksum_sha256, (mf.activity_id = $2) DESC, mf.created_at DESC`,
      accessParams
    );

    const byHash = new Map(rows.map((row) => [row.checksum_sha256, row]));
    const existingHashes = rows
      .filter((row) => row.activity_id === body.activity_id)
      .map((row) => row.checksum_sha256);

    const results: Record<string, any> = {};
    for (const file of files) {
      const match = byHash.get(file.checksum_sha256);
      results[file.id] = {
        checksum_sha256: file.checksum_sha256,
        exists_in_activity: Boolean(match && match.activity_id === body.activity_id),
        reusable: Boolean(match),
        source_media_id: match?.id || null,
      };
    }

    return reply.send({
      existing_hashes: existingHashes,
      data: { results },
    });
  });

  // ─── POST /api/media/attach-duplicate ─────
  // Reuse an already uploaded raw object by copying it to a new storage key.
  // The copied raw object keeps hard-delete safe because each media record owns its own MinIO keys.
  fastify.post('/attach-duplicate', { preHandler: [fastify.requireEditor] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = attachDuplicateSchema.parse(request.body);
    const user = request.currentUser!;

    if (!(await canAccessActivity(body.activity_id, user))) {
      return reply.status(403).send({ error: 'Akses acara ditolak' });
    }

    if (!(await sectionBelongsToActivity(body.section_id, body.activity_id))) {
      return reply.status(400).send({ error: 'Seksi tidak ditemukan pada acara ini' });
    }

    const sourceParams: any[] = [body.checksum_sha256];
    let sourceAccessClause = '';
    if (user.role !== 'SUPER_ADMIN') {
      sourceAccessClause = ` AND ${activityAccessCondition('a', 2, 3)}`;
      sourceParams.push(user.id, user.district_id);
    }

    const { rows: sourceRows } = await fastify.db.query(
      `SELECT mf.*
       FROM media_files mf
       JOIN activities a ON a.id = mf.activity_id
       WHERE mf.checksum_sha256 = $1
         AND mf.storage_key_raw IS NOT NULL
         AND mf.status IN ('PROCESSING', 'READY')
         ${sourceAccessClause}
       ORDER BY mf.created_at DESC
       LIMIT 1`,
      sourceParams
    );

    if (sourceRows.length === 0) {
      return reply.status(404).send({ error: 'File sumber duplikat tidak ditemukan' });
    }

    const source = sourceRows[0];
    const mimeType = body.mime_type || source.mime_type || 'application/octet-stream';
    const mediaType = mediaTypeFromMime(mimeType);
    if (!mediaType) {
      return reply.status(400).send({ error: 'Hanya file gambar atau video yang diterima' });
    }

    const fileExt = path.extname(body.filename || source.original_filename);
    const storageKey = `${body.activity_id}/${body.section_id || 'unsectioned'}/${randomUUID()}${fileExt}`;
    const rawStream = await fastify.minio.getObject(fastify.minioBuckets.raw, source.storage_key_raw);

    await fastify.minio.putObject(
      fastify.minioBuckets.raw,
      storageKey,
      rawStream,
      Number(source.file_size_bytes),
      { 'Content-Type': mimeType }
    );

    const { rows } = await fastify.db.query(
      `INSERT INTO media_files 
       (section_id, activity_id, original_filename, media_type, mime_type, 
        file_size_bytes, storage_key_raw, checksum_sha256, status, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PROCESSING', $9)
       RETURNING *`,
      [
        body.section_id || null,
        body.activity_id,
        body.filename,
        mediaType,
        mimeType,
        Number(source.file_size_bytes),
        storageKey,
        body.checksum_sha256,
        user.id,
      ]
    );

    const media = rows[0];
    await fastify.mediaQueue.add('process-media', {
      mediaId: media.id,
      activityId: body.activity_id,
      sectionId: body.section_id || null,
      mimeType,
      mediaType,
      storageKeyRaw: storageKey,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, 'UPLOAD', 'media_file', $2, $3, $4)`,
      [
        user.id,
        media.id,
        JSON.stringify({
          filename: body.filename,
          media_type: mediaType,
          checksum_sha256: body.checksum_sha256,
          duplicated_from: source.id,
        }),
        request.ip,
      ]
    );

    return reply.status(201).send({ data: media, duplicated_from: source.id });
  });

  // ─── PUT /api/media/reorder ────────────────
  fastify.put('/reorder', { preHandler: [fastify.requireEditor] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = reorderMediaSchema.parse(request.body);

    for (const update of body.updates) {
      if (update.section_id !== undefined) {
        await fastify.db.query(
          'UPDATE media_files SET section_id = $1, sort_order = $2 WHERE id = $3',
          [update.section_id, update.sort_order, update.id]
        );
      } else {
        await fastify.db.query(
          'UPDATE media_files SET sort_order = $1 WHERE id = $2',
          [update.sort_order, update.id]
        );
      }
    }

    return reply.send({ message: 'Urutan media berhasil diperbarui' });
  });

  // ─── GET /api/media/verify-upload ─────────
  // Desktop app calls this after TUS upload before deleting local staging.
  fastify.get('/verify-upload', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = z.object({
      activity_id: z.string().uuid(),
      filename: z.string().min(1),
      sha256: z.string().length(64),
    }).parse(request.query);
    const user = request.currentUser!;

    if (!(await canAccessActivity(query.activity_id, user))) {
      return reply.status(403).send({ error: 'Akses acara ditolak' });
    }

    const { rows } = await fastify.db.query(
      `SELECT id, checksum_sha256, status, created_at
       FROM media_files
       WHERE activity_id = $1
         AND original_filename = $2
         AND checksum_sha256 = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [query.activity_id, query.filename, query.sha256]
    );

    return reply.send({
      verified: rows.length > 0,
      data: rows[0] || null,
    });
  });

  // ─── GET /api/media/:id ────────────────────
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const user = request.currentUser!;

    const { rows } = await fastify.db.query(
      `SELECT mf.*, u.full_name as uploaded_by_name,
        (SELECT json_agg(
            json_build_object('id', p.id, 'full_name', p.full_name, 'position', p.position)
          )
         FROM media_person_tags mpt
         JOIN persons p ON p.id = mpt.person_id
         WHERE mpt.media_id = mf.id) as persons,
        (SELECT json_agg(
            json_build_object('id', t.id, 'name', t.name, 'district_id', t.district_id)
          )
         FROM media_team_tags mtt
         JOIN teams t ON t.id = mtt.team_id
         WHERE mtt.media_id = mf.id) as teams
       FROM media_files mf
       LEFT JOIN users u ON u.id = mf.uploaded_by
       WHERE mf.id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Media tidak ditemukan' });
    }

    if (!(await canAccessMedia(id, user))) {
      return reply.status(403).send({ error: 'Akses media ditolak' });
    }

    return reply.send({ data: rows[0] });
  });

  // ─── POST /api/media/upload ────────────────
  // Upload file menggunakan multipart (sederhana, non-tus)
  fastify.post('/upload', { preHandler: [fastify.requireEditor] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: 'File wajib disertakan' });
    }

    const user = request.currentUser!;
    const sectionId = (data.fields as any).section_id?.value || null;
    const activityId = (data.fields as any).activity_id?.value;
    const multipartLimitBytes = Number(process.env.MEDIA_MULTIPART_MAX_BYTES || 100 * 1024 * 1024);

    if (!activityId) {
      return reply.status(400).send({ error: 'activity_id wajib disertakan' });
    }

    const contentLength = Number(request.headers['content-length'] || 0);
    if (contentLength > multipartLimitBytes) {
      return reply.status(413).send({ error: 'File besar wajib diunggah melalui TUS resumable upload' });
    }

    if (!(await canAccessActivity(activityId, user))) {
      return reply.status(403).send({ error: 'Akses acara ditolak' });
    }

    if (sectionId) {
      const { rowCount } = await fastify.db.query(
        'SELECT 1 FROM event_sections WHERE id = $1 AND activity_id = $2 LIMIT 1',
        [sectionId, activityId]
      );
      if (Number(rowCount) === 0) {
        return reply.status(400).send({ error: 'Seksi tidak ditemukan pada acara ini' });
      }
    }

    // Tentukan media type
    const mimeType = data.mimetype;
    const isImage = mimeType.startsWith('image/');
    const isVideo = mimeType.startsWith('video/');

    if (!isImage && !isVideo) {
      return reply.status(400).send({ error: 'Hanya file gambar atau video yang diterima' });
    }

    const mediaType = isImage ? 'IMAGE' : 'VIDEO';
    const fileExt = path.extname(data.filename);
    const storageKey = `${activityId}/${sectionId || 'unsectioned'}/${randomUUID()}${fileExt}`;

    // Upload ke MinIO (raw bucket)
    const fileBuffer = await data.toBuffer();

    // Hitung SHA-256
    const hash = createHash('sha256');
    hash.update(fileBuffer);
    const checksumSha256 = hash.digest('hex');

    await fastify.minio.putObject(fastify.minioBuckets.raw, storageKey, fileBuffer, fileBuffer.length, {
      'Content-Type': mimeType,
    });

    // Simpan record di database
    const { rows } = await fastify.db.query(
      `INSERT INTO media_files 
       (section_id, activity_id, original_filename, media_type, mime_type, 
        file_size_bytes, storage_key_raw, checksum_sha256, status, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PROCESSING', $9)
       RETURNING *`,
      [
        sectionId, activityId, data.filename, mediaType, mimeType,
        fileBuffer.length, storageKey, checksumSha256, user.id,
      ]
    );

    const mediaId = rows[0].id;

    // Tambahkan job ke antrean BullMQ
    await fastify.mediaQueue.add('process-media', {
      mediaId,
      activityId,
      sectionId,
      mimeType,
      mediaType,
      storageKeyRaw: storageKey,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 }
    });

    // Log audit
    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, 'UPLOAD', 'media_file', $2, $3, $4)`,
      [user.id, mediaId, JSON.stringify({ filename: data.filename, media_type: mediaType }), request.ip]
    );

    return reply.status(201).send({ data: rows[0] });
  });

  // ─── PUT /api/media/:id ────────────────────
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [fastify.requireEditor] }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = updateMediaSchema.parse(request.body);
    const user = request.currentUser!;

    const { rows: existingMedia } = await fastify.db.query('SELECT id FROM media_files WHERE id = $1', [id]);
    if (existingMedia.length === 0) {
      return reply.status(404).send({ error: 'Media tidak ditemukan' });
    }
    if (!(await canAccessMedia(id, user))) {
      return reply.status(403).send({ error: 'Akses media ditolak' });
    }

    // Pisahkan person_ids dan team_ids dari update body
    const { person_ids, team_ids, ...restBody } = body;

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(restBody)) {
      if (value !== undefined) {
        updates.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }

    // Tandai sebagai edited jika title, description, atau display_name diisi
    if (restBody.title !== undefined || restBody.description !== undefined || restBody.display_name !== undefined) {
      if (!updates.includes(`is_edited = true`)) {
         updates.push(`is_edited = true`);
      }
    }

    let mediaData: any = null;

    if (updates.length > 0) {
      values.push(id);
      const { rows } = await fastify.db.query(
        `UPDATE media_files SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Media tidak ditemukan' });
      }
      mediaData = rows[0];
    } else {
      const { rows } = await fastify.db.query('SELECT * FROM media_files WHERE id = $1', [id]);
      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Media tidak ditemukan' });
      }
      mediaData = rows[0];
    }

    // Update person tags jika person_ids diberikan
    if (person_ids !== undefined) {
      const client = await fastify.db.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM media_person_tags WHERE media_id = $1', [id]);
        for (const personId of person_ids) {
          await client.query(
            'INSERT INTO media_person_tags (media_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, personId]
          );
        }
        await client.query('COMMIT');
        
        // Tandai sebagai diedit jika ngetag orang
        await fastify.db.query('UPDATE media_files SET is_edited = true WHERE id = $1', [id]);
        mediaData.is_edited = true;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // Update team tags jika team_ids diberikan
    if (team_ids !== undefined) {
      const client = await fastify.db.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM media_team_tags WHERE media_id = $1', [id]);
        for (const teamId of team_ids) {
          await client.query(
            'INSERT INTO media_team_tags (media_id, team_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, teamId]
          );
        }
        await client.query('COMMIT');
        
        // Tandai sebagai diedit jika ngetag tim
        await fastify.db.query('UPDATE media_files SET is_edited = true WHERE id = $1', [id]);
        mediaData.is_edited = true;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // Log audit
    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, 'UPDATE', 'media_file', $2, $3, $4)`,
      [user.id, id, JSON.stringify(body), request.ip]
    );

    return reply.send({ data: mediaData });
  });

  // ─── DELETE /api/media/:id ─────────────────
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [fastify.requireEditor] }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const user = request.currentUser!;

    // Ambil info file sebelum hapus
    const { rows: mediaRows } = await fastify.db.query(
      'SELECT storage_key_raw, storage_key_processed, storage_key_thumbnail, quality_variants FROM media_files WHERE id = $1',
      [id]
    );

    if (mediaRows.length === 0) {
      return reply.status(404).send({ error: 'Media tidak ditemukan' });
    }

    if (!(await canAccessMedia(id, user))) {
      return reply.status(403).send({ error: 'Akses media ditolak' });
    }

    // Hapus file dari MinIO
    const media = mediaRows[0];
    try {
      if (media.storage_key_raw) {
        await fastify.minio.removeObject(fastify.minioBuckets.raw, media.storage_key_raw);
      }
      if (media.storage_key_processed) {
        await fastify.minio.removeObject(fastify.minioBuckets.processed, media.storage_key_processed);
      }
      if (media.storage_key_thumbnail) {
        await fastify.minio.removeObject(fastify.minioBuckets.processed, media.storage_key_thumbnail);
      }
      let variants: Record<string, unknown> = {};
      try {
        variants = typeof media.quality_variants === 'string'
          ? JSON.parse(media.quality_variants)
          : media.quality_variants || {};
      } catch {
        variants = {};
      }
      for (const key of Object.values(variants)) {
        if (typeof key === 'string') {
          await fastify.minio.removeObject(fastify.minioBuckets.processed, key);
        }
      }
    } catch (err) {
      fastify.log.warn(err, 'Gagal menghapus file dari MinIO');
    }

    await fastify.db.query('DELETE FROM media_files WHERE id = $1', [id]);

    // Log audit
    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
       VALUES ($1, 'DELETE', 'media_file', $2, $3)`,
      [user.id, id, request.ip]
    );

    return reply.send({ message: 'Media berhasil dihapus' });
  });

  // ─── GET /api/media/:id/download ───────────
  fastify.get(
    '/:id/download',
    async (request: FastifyRequest<{ Params: { id: string }; Querystring: { quality?: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const quality = (request.query as any).quality || 'original';
      const user = request.currentUser!;

      const { rows } = await fastify.db.query('SELECT * FROM media_files WHERE id = $1', [id]);

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Media tidak ditemukan' });
      }

      const media = rows[0];
      if (!(await canAccessMedia(id, user))) {
        return reply.status(403).send({ error: 'Akses media ditolak' });
      }

      const { bucket, key, contentType } = resolveDownloadTarget(media, quality);

      if (!key) {
        return reply.status(404).send({ error: 'File tidak tersedia untuk kualitas yang diminta' });
      }

      const stat = await fastify.minio.statObject(bucket, key);
      const fileSize = stat.size;
      const parsedRange = parseByteRange(request.headers.range, fileSize);

      if (!parsedRange.valid) {
        return reply
          .status(416)
          .header('Content-Range', `bytes */${fileSize}`)
          .send({ error: 'Range tidak valid' });
      }

      let stream;
      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `attachment; filename="${media.display_name || media.original_filename}"`);

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

      return reply.send(stream);
    }
  );
}

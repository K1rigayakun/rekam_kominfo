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

export async function mediaRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ─── GET /api/media ────────────────────────
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listMediaQuerySchema.parse(request.query);
    const offset = (query.page - 1) * query.limit;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let idx = 1;

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

  // ─── PUT /api/media/reorder ────────────────
  fastify.put('/reorder', async (request: FastifyRequest, reply: FastifyReply) => {
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

    return reply.send({ data: rows[0] });
  });

  // ─── POST /api/media/upload ────────────────
  // Upload file menggunakan multipart (sederhana, non-tus)
  fastify.post('/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: 'File wajib disertakan' });
    }

    const user = request.currentUser!;
    const sectionId = (data.fields as any).section_id?.value || null;
    const activityId = (data.fields as any).activity_id?.value;

    if (!activityId) {
      return reply.status(400).send({ error: 'activity_id wajib disertakan' });
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
  fastify.put('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = updateMediaSchema.parse(request.body);
    const user = request.currentUser!;

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
      await fastify.db.query('BEGIN');
      try {
        await fastify.db.query('DELETE FROM media_person_tags WHERE media_id = $1', [id]);
        for (const personId of person_ids) {
          await fastify.db.query(
            'INSERT INTO media_person_tags (media_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, personId]
          );
        }
        await fastify.db.query('COMMIT');
        
        // Tandai sebagai diedit jika ngetag orang
        await fastify.db.query('UPDATE media_files SET is_edited = true WHERE id = $1', [id]);
        mediaData.is_edited = true;
      } catch (err) {
        await fastify.db.query('ROLLBACK');
        throw err;
      }
    }

    // Update team tags jika team_ids diberikan
    if (team_ids !== undefined) {
      await fastify.db.query('BEGIN');
      try {
        await fastify.db.query('DELETE FROM media_team_tags WHERE media_id = $1', [id]);
        for (const teamId of team_ids) {
          await fastify.db.query(
            'INSERT INTO media_team_tags (media_id, team_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, teamId]
          );
        }
        await fastify.db.query('COMMIT');
        
        // Tandai sebagai diedit jika ngetag tim
        await fastify.db.query('UPDATE media_files SET is_edited = true WHERE id = $1', [id]);
        mediaData.is_edited = true;
      } catch (err) {
        await fastify.db.query('ROLLBACK');
        throw err;
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
  fastify.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const user = request.currentUser!;

    // Ambil info file sebelum hapus
    const { rows: mediaRows } = await fastify.db.query(
      'SELECT storage_key_raw, storage_key_processed, storage_key_thumbnail FROM media_files WHERE id = $1',
      [id]
    );

    if (mediaRows.length === 0) {
      return reply.status(404).send({ error: 'Media tidak ditemukan' });
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

      const { rows } = await fastify.db.query('SELECT * FROM media_files WHERE id = $1', [id]);

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Media tidak ditemukan' });
      }

      const media = rows[0];
      const bucket = quality === 'preview' ? fastify.minioBuckets.processed : fastify.minioBuckets.raw;
      const key = quality === 'preview' ? media.storage_key_processed : media.storage_key_raw;

      if (!key) {
        return reply.status(404).send({ error: 'File tidak tersedia untuk kualitas yang diminta' });
      }

      const stream = await fastify.minio.getObject(bucket, key);

      reply.header('Content-Type', media.mime_type);
      reply.header('Content-Disposition', `attachment; filename="${media.display_name || media.original_filename}"`);

      return reply.send(stream);
    }
  );
}

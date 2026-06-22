import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash, randomUUID } from 'crypto';
import path from 'path';
import '@fastify/multipart';

export async function attachmentRoutes(fastify: FastifyInstance) {
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

  async function canAccessAttachment(attachmentId: string, user: NonNullable<FastifyRequest['currentUser']>) {
    if (user.role === 'SUPER_ADMIN') return true;

    const { rowCount } = await fastify.db.query(
      `SELECT 1
       FROM event_attachments ea
       JOIN activities a ON a.id = ea.activity_id
       WHERE ea.id = $1
         AND ${activityAccessCondition('a', 2, 3)}
       LIMIT 1`,
      [attachmentId, user.id, user.district_id]
    );

    return Number(rowCount) > 0;
  }

  async function sectionBelongsToActivity(sectionId: string | undefined, activityId: string) {
    if (!sectionId || sectionId === 'null') return true;

    const { rowCount } = await fastify.db.query(
      'SELECT 1 FROM event_sections WHERE id = $1 AND activity_id = $2 LIMIT 1',
      [sectionId, activityId]
    );

    return Number(rowCount) > 0;
  }

  // ─── GET /api/attachments?activity_id=... ──
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const activityId = (request.query as any).activity_id;
    const sectionId = (request.query as any).section_id;
    const user = request.currentUser!;

    if (!activityId) {
      return reply.status(400).send({ error: 'activity_id wajib disertakan' });
    }

    if (!(await canAccessActivity(activityId, user))) {
      return reply.status(403).send({ error: 'Akses acara ditolak' });
    }

    let query = `
      SELECT ea.*, u.full_name as uploaded_by_name
      FROM event_attachments ea
      LEFT JOIN users u ON u.id = ea.uploaded_by
      WHERE ea.activity_id = $1
    `;
    const params: any[] = [activityId];

    if (sectionId === 'null') {
      query += ` AND ea.section_id IS NULL`;
    } else if (sectionId) {
      query += ` AND ea.section_id = $2`;
      params.push(sectionId);
    }

    query += ` ORDER BY ea.created_at`;

    const { rows } = await fastify.db.query(query, params);

    return reply.send({ data: rows });
  });

  // ─── POST /api/attachments/upload ──────────
  fastify.post('/upload', { preHandler: [fastify.requireEditor] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: 'File wajib disertakan' });
    }

    const user = request.currentUser!;
    const activityId = (data.fields as any).activity_id?.value;
    const sectionId = (data.fields as any).section_id?.value;
    const attachmentLimitBytes = Number(process.env.ATTACHMENT_MAX_BYTES || 100 * 1024 * 1024);

    if (!activityId) {
      return reply.status(400).send({ error: 'activity_id wajib disertakan' });
    }

    const contentLength = Number(request.headers['content-length'] || 0);
    if (contentLength > attachmentLimitBytes) {
      return reply.status(413).send({ error: 'Lampiran melebihi batas ukuran upload' });
    }

    if (!(await canAccessActivity(activityId, user))) {
      return reply.status(403).send({ error: 'Akses acara ditolak' });
    }

    if (!(await sectionBelongsToActivity(sectionId, activityId))) {
      return reply.status(400).send({ error: 'Seksi tidak ditemukan pada acara ini' });
    }

    const fileExt = path.extname(data.filename);
    const storageKey = `${activityId}/attachments/${randomUUID()}${fileExt}`;

    const fileBuffer = await data.toBuffer();
    const checksumSha256 = createHash('sha256').update(fileBuffer).digest('hex');
    await fastify.minio.putObject(fastify.minioBuckets.attach, storageKey, fileBuffer, fileBuffer.length, {
      'Content-Type': data.mimetype,
    });

    const { rows } = await fastify.db.query(
      `INSERT INTO event_attachments 
       (activity_id, section_id, original_filename, mime_type, file_size_bytes, checksum_sha256, storage_key, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [activityId, sectionId || null, data.filename, data.mimetype, fileBuffer.length, checksumSha256, storageKey, user.id]
    );

    // Log audit
    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, 'UPLOAD', 'event_attachment', $2, $3, $4)`,
      [user.id, rows[0].id, JSON.stringify({ filename: data.filename }), request.ip]
    );

    return reply.status(201).send({ data: rows[0] });
  });

  // ─── PUT /api/attachments/:id ──────────────
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [fastify.requireEditor] }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { display_name } = request.body as { display_name: string };
    const user = request.currentUser!;

    if (!display_name) {
      return reply.status(400).send({ error: 'display_name wajib diisi' });
    }

    const { rows: existing } = await fastify.db.query('SELECT id FROM event_attachments WHERE id = $1', [id]);
    if (existing.length === 0) {
      return reply.status(404).send({ error: 'Lampiran tidak ditemukan' });
    }

    if (!(await canAccessAttachment(id, user))) {
      return reply.status(403).send({ error: 'Akses lampiran ditolak' });
    }

    const { rows } = await fastify.db.query(
      `UPDATE event_attachments 
       SET display_name = $1 
       WHERE id = $2 
       RETURNING *`,
      [display_name, id]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Lampiran tidak ditemukan' });
    }

    return reply.send({ data: rows[0] });
  });

  // ─── GET /api/attachments/:id/download ─────
  fastify.get(
    '/:id/download',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const user = request.currentUser!;

      const { rows } = await fastify.db.query(
        'SELECT * FROM event_attachments WHERE id = $1',
        [id]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Lampiran tidak ditemukan' });
      }

      if (!(await canAccessAttachment(id, user))) {
        return reply.status(403).send({ error: 'Akses lampiran ditolak' });
      }

      const attachment = rows[0];
      const stream = await fastify.minio.getObject(fastify.minioBuckets.attach, attachment.storage_key);

      reply.header('Content-Type', attachment.mime_type);
      reply.header(
        'Content-Disposition',
        `attachment; filename="${attachment.display_name || attachment.original_filename}"`
      );

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
         VALUES ($1, 'DOWNLOAD', 'event_attachment', $2, $3)`,
        [user.id, id, request.ip]
      );

      return reply.send(stream);
    }
  );

  // ─── DELETE /api/attachments/:id ───────────
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.requireEditor] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const user = request.currentUser!;

      const { rows } = await fastify.db.query(
        'SELECT storage_key FROM event_attachments WHERE id = $1',
        [id]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Lampiran tidak ditemukan' });
      }

      if (!(await canAccessAttachment(id, user))) {
        return reply.status(403).send({ error: 'Akses lampiran ditolak' });
      }

      try {
        await fastify.minio.removeObject(fastify.minioBuckets.attach, rows[0].storage_key);
      } catch (err) {
        fastify.log.warn(err, 'Gagal menghapus file lampiran dari MinIO');
      }

      await fastify.db.query('DELETE FROM event_attachments WHERE id = $1', [id]);

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
         VALUES ($1, 'DELETE', 'event_attachment', $2, $3)`,
        [user.id, id, request.ip]
      );

      return reply.send({ message: 'Lampiran berhasil dihapus' });
    }
  );
}

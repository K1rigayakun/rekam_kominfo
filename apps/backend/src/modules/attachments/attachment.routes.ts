import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import path from 'path';
import '@fastify/multipart';

export async function attachmentRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ─── GET /api/attachments?activity_id=... ──
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const activityId = (request.query as any).activity_id;
    const sectionId = (request.query as any).section_id;

    if (!activityId) {
      return reply.status(400).send({ error: 'activity_id wajib disertakan' });
    }

    let query = `
      SELECT ea.*, u.full_name as uploaded_by_name
      FROM event_attachments ea
      LEFT JOIN users u ON u.id = ea.uploaded_by
      WHERE ea.activity_id = $1
    `;
    const params: any[] = [activityId];

    if (sectionId) {
      query += ` AND ea.section_id = $2`;
      params.push(sectionId);
    } else if (sectionId === 'null') {
      query += ` AND ea.section_id IS NULL`;
    }

    query += ` ORDER BY ea.created_at`;

    const { rows } = await fastify.db.query(query, params);

    return reply.send({ data: rows });
  });

  // ─── POST /api/attachments/upload ──────────
  fastify.post('/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: 'File wajib disertakan' });
    }

    const user = request.currentUser!;
    const activityId = (data.fields as any).activity_id?.value;
    const sectionId = (data.fields as any).section_id?.value;

    if (!activityId) {
      return reply.status(400).send({ error: 'activity_id wajib disertakan' });
    }

    const fileExt = path.extname(data.filename);
    const storageKey = `${activityId}/attachments/${randomUUID()}${fileExt}`;

    const fileBuffer = await data.toBuffer();
    await fastify.minio.putObject(fastify.minioBuckets.attach, storageKey, fileBuffer, fileBuffer.length, {
      'Content-Type': data.mimetype,
    });

    const { rows } = await fastify.db.query(
      `INSERT INTO event_attachments 
       (activity_id, section_id, original_filename, mime_type, file_size_bytes, storage_key, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [activityId, sectionId || null, data.filename, data.mimetype, fileBuffer.length, storageKey, user.id]
    );

    // Log audit
    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, 'UPLOAD', 'event_attachment', $2, $3, $4)`,
      [user.id, rows[0].id, JSON.stringify({ filename: data.filename }), request.ip]
    );

    return reply.status(201).send({ data: rows[0] });
  });

  // ─── GET /api/attachments/:id/download ─────
  fastify.get(
    '/:id/download',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const { rows } = await fastify.db.query(
        'SELECT * FROM event_attachments WHERE id = $1',
        [id]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Lampiran tidak ditemukan' });
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
        [request.currentUser!.id, id, request.ip]
      );

      return reply.send(stream);
    }
  );

  // ─── DELETE /api/attachments/:id ───────────
  fastify.delete(
    '/:id',
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

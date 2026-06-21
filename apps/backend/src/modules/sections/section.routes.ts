import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

const createSectionSchema = z.object({
  title: z.string().min(1, 'Judul seksi wajib diisi').max(500),
  description: z.string().optional(),
  description_json: z.any().optional(),
  sort_order: z.number().int().optional(),
});

const updateSectionSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().nullable().optional(),
  description_json: z.any().nullable().optional(),
  sort_order: z.number().int().optional(),
});

const reorderSchema = z.object({
  section_ids: z.array(z.string().uuid()),
});

export async function sectionRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ─── GET /api/activities/:activityId/sections ─
  fastify.get(
    '/:activityId/sections',
    async (request: FastifyRequest<{ Params: { activityId: string } }>, reply: FastifyReply) => {
      const { activityId } = request.params;

      const { rows } = await fastify.db.query(
        `SELECT es.*, 
                (SELECT COUNT(*) FROM media_files mf WHERE mf.section_id = es.id) as media_count
         FROM event_sections es
         WHERE es.activity_id = $1
         ORDER BY es.sort_order, es.created_at`,
        [activityId]
      );

      return reply.send({ data: rows });
    }
  );

  // ─── POST /api/activities/:activityId/sections ─
  fastify.post(
    '/:activityId/sections',
    async (request: FastifyRequest<{ Params: { activityId: string } }>, reply: FastifyReply) => {
      const { activityId } = request.params;
      const body = createSectionSchema.parse(request.body);
      const user = request.currentUser!;

      // Hitung sort_order berikutnya jika tidak disediakan
      let sortOrder = body.sort_order;
      if (sortOrder === undefined) {
        const { rows } = await fastify.db.query(
          'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM event_sections WHERE activity_id = $1',
          [activityId]
        );
        sortOrder = rows[0].next_order;
      }

      const { rows } = await fastify.db.query(
        `INSERT INTO event_sections (activity_id, title, description, description_json, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [activityId, body.title, body.description || null, body.description_json ? JSON.stringify(body.description_json) : null, sortOrder, user.id]
      );

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'CREATE', 'event_section', $2, $3, $4)`,
        [user.id, rows[0].id, JSON.stringify({ title: body.title, activity_id: activityId }), request.ip]
      );

      return reply.status(201).send({ data: rows[0] });
    }
  );

  // ─── PUT /api/activities/:activityId/sections/:id ─
  fastify.put(
    '/:activityId/sections/:id',
    async (
      request: FastifyRequest<{ Params: { activityId: string; id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const body = updateSectionSchema.parse(request.body);
      const user = request.currentUser!;

      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (body.title !== undefined) {
        updates.push(`title = $${idx}`);
        values.push(body.title);
        idx++;
      }
      if (body.description !== undefined) {
        updates.push(`description = $${idx}`);
        values.push(body.description);
        idx++;
      }
      if (body.description_json !== undefined) {
        updates.push(`description_json = $${idx}`);
        values.push(body.description_json ? JSON.stringify(body.description_json) : null);
        idx++;
      }
      if (body.sort_order !== undefined) {
        updates.push(`sort_order = $${idx}`);
        values.push(body.sort_order);
        idx++;
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Tidak ada data yang diubah' });
      }

      values.push(id);
      const { rows } = await fastify.db.query(
        `UPDATE event_sections SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Seksi tidak ditemukan' });
      }

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'UPDATE', 'event_section', $2, $3, $4)`,
        [user.id, id, JSON.stringify(body), request.ip]
      );

      return reply.send({ data: rows[0] });
    }
  );

  // ─── PUT /api/activities/:activityId/sections/reorder ─
  fastify.put(
    '/:activityId/sections/reorder',
    async (request: FastifyRequest<{ Params: { activityId: string } }>, reply: FastifyReply) => {
      const body = reorderSchema.parse(request.body);

      // Update sort_order berdasarkan posisi di array
      for (let i = 0; i < body.section_ids.length; i++) {
        await fastify.db.query(
          'UPDATE event_sections SET sort_order = $1 WHERE id = $2',
          [i, body.section_ids[i]]
        );
      }

      return reply.send({ message: 'Urutan seksi berhasil diperbarui' });
    }
  );

  // ─── DELETE /api/activities/:activityId/sections/:id ─
  fastify.delete(
    '/:activityId/sections/:id',
    async (
      request: FastifyRequest<{ Params: { activityId: string; id: string }; Body: { action?: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const user = request.currentUser!;
      const action = request.body?.action;

      if (action === 'MOVE_MEDIA_TO_UNSECTIONED') {
        await fastify.db.query('UPDATE media_files SET section_id = NULL WHERE section_id = $1', [id]);
        await fastify.db.query('UPDATE event_attachments SET section_id = NULL WHERE section_id = $1', [id]);
      } else if (action === 'DELETE_MEDIA') {
        // Find media to delete from MinIO
        const { rows: media } = await fastify.db.query('SELECT storage_key_raw FROM media_files WHERE section_id = $1', [id]);
        for (const m of media) {
          try {
             await fastify.minio.removeObject(fastify.minioBuckets.raw, m.storage_key_raw).catch(() => {});
          } catch(e) {}
        }
        // DB deletion will be handled by CASCADE
      }

      const { rowCount } = await fastify.db.query('DELETE FROM event_sections WHERE id = $1', [id]);

      if (rowCount === 0) {
        return reply.status(404).send({ error: 'Seksi tidak ditemukan' });
      }

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
         VALUES ($1, 'DELETE', 'event_section', $2, $3)`,
        [user.id, id, request.ip]
      );

      return reply.send({ message: 'Seksi berhasil dihapus' });
    }
  );
}

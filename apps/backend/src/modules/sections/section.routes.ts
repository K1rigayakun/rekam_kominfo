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

  async function removeMinioObject(bucket: string, key: string | null | undefined) {
    if (!key) return;
    try {
      await fastify.minio.removeObject(bucket, key);
    } catch (err) {
      fastify.log.warn({ err, bucket, key }, 'Gagal menghapus object MinIO saat hapus seksi');
    }
  }

  function qualityVariantKeys(qualityVariants: any) {
    if (!qualityVariants) return [];
    try {
      const variants = typeof qualityVariants === 'string' ? JSON.parse(qualityVariants) : qualityVariants;
      return Object.values(variants).filter((key): key is string => typeof key === 'string');
    } catch {
      return [];
    }
  }

  // ─── GET /api/activities/:activityId/sections ─
  fastify.get(
    '/:activityId/sections',
    async (request: FastifyRequest<{ Params: { activityId: string } }>, reply: FastifyReply) => {
      const { activityId } = request.params;
      const user = request.currentUser!;

      if (!(await canAccessActivity(activityId, user))) {
        return reply.status(403).send({ error: 'Akses acara ditolak' });
      }

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
  fastify.post<{ Params: { activityId: string } }>(
    '/:activityId/sections',
    { preHandler: [fastify.requireEditor] },
    async (request: FastifyRequest<{ Params: { activityId: string } }>, reply: FastifyReply) => {
      const { activityId } = request.params;
      const body = createSectionSchema.parse(request.body);
      const user = request.currentUser!;

      if (!(await canAccessActivity(activityId, user))) {
        return reply.status(403).send({ error: 'Akses acara ditolak' });
      }

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
  fastify.put<{ Params: { activityId: string; id: string } }>(
    '/:activityId/sections/:id',
    { preHandler: [fastify.requireEditor] },
    async (
      request: FastifyRequest<{ Params: { activityId: string; id: string } }>,
      reply: FastifyReply
    ) => {
      const { activityId, id } = request.params;
      const body = updateSectionSchema.parse(request.body);
      const user = request.currentUser!;

      if (!(await canAccessActivity(activityId, user))) {
        return reply.status(403).send({ error: 'Akses acara ditolak' });
      }

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
        `UPDATE event_sections SET ${updates.join(', ')} WHERE id = $${idx} AND activity_id = $${idx + 1} RETURNING *`,
        [...values, activityId]
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
  fastify.put<{ Params: { activityId: string } }>(
    '/:activityId/sections/reorder',
    { preHandler: [fastify.requireEditor] },
    async (request: FastifyRequest<{ Params: { activityId: string } }>, reply: FastifyReply) => {
      const { activityId } = request.params;
      const user = request.currentUser!;
      const body = reorderSchema.parse(request.body);

      if (!(await canAccessActivity(activityId, user))) {
        return reply.status(403).send({ error: 'Akses acara ditolak' });
      }

      // Update sort_order berdasarkan posisi di array
      for (let i = 0; i < body.section_ids.length; i++) {
        await fastify.db.query(
          'UPDATE event_sections SET sort_order = $1 WHERE id = $2 AND activity_id = $3',
          [i, body.section_ids[i], activityId]
        );
      }

      return reply.send({ message: 'Urutan seksi berhasil diperbarui' });
    }
  );

  // ─── DELETE /api/activities/:activityId/sections/:id ─
  fastify.delete<{ Params: { activityId: string; id: string }; Body: { action?: string } }>(
    '/:activityId/sections/:id',
    { preHandler: [fastify.requireEditor] },
    async (
      request: FastifyRequest<{ Params: { activityId: string; id: string }; Body: { action?: string } }>,
      reply: FastifyReply
    ) => {
      const { activityId, id } = request.params;
      const user = request.currentUser!;
      const action = request.body?.action;

      if (!(await canAccessActivity(activityId, user))) {
        return reply.status(403).send({ error: 'Akses acara ditolak' });
      }

      const { rowCount: sectionExists } = await fastify.db.query(
        'SELECT 1 FROM event_sections WHERE id = $1 AND activity_id = $2 LIMIT 1',
        [id, activityId]
      );
      if (Number(sectionExists) === 0) {
        return reply.status(404).send({ error: 'Seksi tidak ditemukan' });
      }

      if (action === 'MOVE_MEDIA_TO_UNSECTIONED') {
        await fastify.db.query('UPDATE media_files SET section_id = NULL WHERE section_id = $1 AND activity_id = $2', [id, activityId]);
        await fastify.db.query('UPDATE event_attachments SET section_id = NULL WHERE section_id = $1 AND activity_id = $2', [id, activityId]);
      } else if (action === 'DELETE_MEDIA') {
        const { rows: media } = await fastify.db.query(
          `SELECT storage_key_raw, storage_key_processed, storage_key_thumbnail, quality_variants
           FROM media_files
           WHERE section_id = $1 AND activity_id = $2`,
          [id, activityId]
        );
        for (const m of media) {
          await removeMinioObject(fastify.minioBuckets.raw, m.storage_key_raw);
          await removeMinioObject(fastify.minioBuckets.processed, m.storage_key_processed);
          await removeMinioObject(fastify.minioBuckets.processed, m.storage_key_thumbnail);
          for (const key of qualityVariantKeys(m.quality_variants)) {
            await removeMinioObject(fastify.minioBuckets.processed, key);
          }
        }
        // DB deletion will be handled by CASCADE
      }

      const { rowCount } = await fastify.db.query('DELETE FROM event_sections WHERE id = $1 AND activity_id = $2', [id, activityId]);

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

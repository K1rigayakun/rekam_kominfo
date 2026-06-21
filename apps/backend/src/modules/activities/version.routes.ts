import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function versionRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ─── GET /api/activities/:id/versions ──────
  fastify.get(
    '/:id/versions',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const { rows } = await fastify.db.query(
        `SELECT v.id, v.version_number, v.created_at, u.full_name as created_by_name
         FROM activity_versions v
         LEFT JOIN users u ON u.id = v.created_by
         WHERE v.activity_id = $1
         ORDER BY v.version_number DESC`,
        [id]
      );

      return reply.send({ data: rows });
    }
  );

  // ─── GET /api/activities/:id/versions/:versionId ──────
  fastify.get(
    '/:id/versions/:versionId',
    async (request: FastifyRequest<{ Params: { id: string; versionId: string } }>, reply: FastifyReply) => {
      const { id, versionId } = request.params;

      const { rows } = await fastify.db.query(
        `SELECT v.*, u.full_name as created_by_name
         FROM activity_versions v
         LEFT JOIN users u ON u.id = v.created_by
         WHERE v.activity_id = $1 AND v.id = $2`,
        [id, versionId]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Versi tidak ditemukan' });
      }

      return reply.send({ data: rows[0] });
    }
  );

  // ─── POST /api/activities/:id/versions/:versionId/restore ──────
  fastify.post<{ Params: { id: string; versionId: string } }>(
    '/:id/versions/:versionId/restore',
    { preHandler: [fastify.requireEditor] },
    async (request, reply: FastifyReply) => {
      const { id, versionId } = request.params;
      const user = request.currentUser!;

      // Cek apakah acara ada dan bukan diarsipkan
      const { rows: activityRes } = await fastify.db.query(
        'SELECT id FROM activities WHERE id = $1 AND is_archived = false',
        [id]
      );
      if (activityRes.length === 0) {
        return reply.status(404).send({ error: 'Acara tidak ditemukan atau sudah diarsipkan' });
      }

      // Cek apakah versi ada
      const { rows: versionRes } = await fastify.db.query(
        'SELECT snapshot_data FROM activity_versions WHERE activity_id = $1 AND id = $2',
        [id, versionId]
      );
      if (versionRes.length === 0) {
        return reply.status(404).send({ error: 'Versi tidak ditemukan' });
      }

      const snap = versionRes[0].snapshot_data;
      if (!snap) {
         return reply.status(400).send({ error: 'Data versi kosong' });
      }

      // Restore data ke tabel activities (hanya text fields, sections/media TIDAK direstore)
      const { rows: updatedActivity } = await fastify.db.query(
        `UPDATE activities 
         SET title = $1, 
             description = $2, 
             description_json = $3, 
             event_date = $4, 
             event_end_date = $5, 
             location = $6, 
             use_sections = $7,
             district_id = $8
         WHERE id = $9 RETURNING *`,
        [
          snap.title,
          snap.description || null,
          snap.description_json ? JSON.stringify(snap.description_json) : null,
          snap.event_date,
          snap.event_end_date || null,
          snap.location || null,
          snap.use_sections,
          snap.district_id || null,
          id
        ]
      );

      // Simpan log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'UPDATE', 'activity', $2, $3, $4)`,
        [user.id, id, JSON.stringify({ action: 'restore_version', version_id: versionId }), request.ip]
      );

      // Simpan ini sebagai versi baru juga (version history berlanjut, bukan terhapus)
      const { rows: nextVersionRes } = await fastify.db.query(
        'SELECT COALESCE(MAX(version_number), 0) + 1 as next_version FROM activity_versions WHERE activity_id = $1',
        [id]
      );
      const nextVersion = nextVersionRes[0].next_version;

      await fastify.db.query(
        `INSERT INTO activity_versions (activity_id, version_number, snapshot_data, created_by)
         VALUES ($1, $2, $3, $4)`,
        [id, nextVersion, JSON.stringify(updatedActivity[0]), user.id]
      );

      return reply.send({ message: 'Versi berhasil dipulihkan', data: updatedActivity[0] });
    }
  );
}

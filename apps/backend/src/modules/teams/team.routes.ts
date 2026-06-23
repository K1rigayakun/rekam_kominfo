import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

const createTeamSchema = z.object({
  name: z.string().min(1, 'Nama tim wajib diisi').max(255),
  description: z.string().optional(),
  tag_id: z.string().uuid().optional().nullable(),
});

const updateTeamSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  tag_id: z.string().uuid().optional().nullable(),
});

export async function teamRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ─── GET /api/teams ───────────────────────
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    let query = 'SELECT t.*, tg.name as tag_name, COUNT(tm.user_id)::int as member_count FROM teams t LEFT JOIN tags tg ON tg.id = t.tag_id LEFT JOIN team_members tm ON tm.team_id = t.id GROUP BY t.id, tg.name ORDER BY t.name';
    const { rows } = await fastify.db.query(query);
    return reply.send({ data: rows });
  });

  // ─── GET /api/teams/:id ───────────────────
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { rows: team } = await fastify.db.query(
      'SELECT t.*, tg.name as tag_name FROM teams t LEFT JOIN tags tg ON tg.id = t.tag_id WHERE t.id = $1',
      [id]
    );

    if (team.length === 0) {
      return reply.status(404).send({ error: 'Tim tidak ditemukan' });
    }

    // Ambil anggota tim
    const { rows: members } = await fastify.db.query(
      `SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.last_login_at, d.name as district_name
       FROM users u
       JOIN team_members tm ON tm.user_id = u.id
       LEFT JOIN districts d ON d.id = u.district_id
       WHERE tm.team_id = $1 ORDER BY u.full_name`,
      [id]
    );

    return reply.send({ data: { ...team[0], members } });
  });

  // ─── POST /api/teams ─────────────────────
  fastify.post(
    '/',
    { preHandler: [fastify.requireSuperAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createTeamSchema.parse(request.body);
      const user = request.currentUser!;

      // Cek nama unik
      const { rows: existing } = await fastify.db.query(
        'SELECT id FROM teams WHERE name = $1', [body.name]
      );
      if (existing.length > 0) {
        return reply.status(409).send({ error: 'Nama tim sudah digunakan' });
      }

      const { rows } = await fastify.db.query(
        `INSERT INTO teams (name, description, tag_id)
         VALUES ($1, $2, $3) RETURNING *`,
        [body.name, body.description || null, body.tag_id || null]
      );

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'CREATE', 'team', $2, $3, $4)`,
        [user.id, rows[0].id, JSON.stringify({ name: body.name }), request.ip]
      );

      return reply.status(201).send({ data: rows[0] });
    }
  );

  // ─── PUT /api/teams/:id ──────────────────
  fastify.put<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.requireSuperAdmin] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const body = updateTeamSchema.parse(request.body);
      const user = request.currentUser!;

      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;

      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined) {
          updates.push(`${key} = $${idx}`);
          values.push(value);
          idx++;
        }
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Tidak ada data yang diubah' });
      }

      values.push(id);
      const { rows } = await fastify.db.query(
        `UPDATE teams SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Tim tidak ditemukan' });
      }

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'UPDATE', 'team', $2, $3, $4)`,
        [user.id, id, JSON.stringify(body), request.ip]
      );

      return reply.send({ data: rows[0] });
    }
  );

  const addMembersSchema = z.object({
    user_ids: z.array(z.string().uuid()),
  });

  // ─── POST /api/teams/:id/members ───────────
  fastify.post<{ Params: { id: string } }>(
    '/:id/members',
    { preHandler: [fastify.requireSuperAdmin] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const body = addMembersSchema.parse(request.body);
      const user = request.currentUser!;

      // Verifikasi tim ada
      const { rowCount: teamExists } = await fastify.db.query('SELECT 1 FROM teams WHERE id = $1', [id]);
      if (teamExists === 0) {
        return reply.status(404).send({ error: 'Tim tidak ditemukan' });
      }

      // Insert member, ignore duplicates
      for (const userId of body.user_ids) {
        await fastify.db.query(
          `INSERT INTO team_members (team_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT (team_id, user_id) DO NOTHING`,
          [id, userId]
        );
      }

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'ADD_MEMBERS', 'team', $2, $3, $4)`,
        [user.id, id, JSON.stringify({ added_users: body.user_ids }), request.ip]
      );

      return reply.status(201).send({ message: 'Anggota berhasil ditambahkan' });
    }
  );

  // ─── DELETE /api/teams/:id/members/:userId ─
  fastify.delete<{ Params: { id: string; userId: string } }>(
    '/:id/members/:userId',
    { preHandler: [fastify.requireSuperAdmin] },
    async (request: FastifyRequest<{ Params: { id: string; userId: string } }>, reply: FastifyReply) => {
      const { id, userId } = request.params;
      const user = request.currentUser!;

      const { rowCount } = await fastify.db.query(
        'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
        [id, userId]
      );

      if (rowCount === 0) {
        return reply.status(404).send({ error: 'Anggota tidak ditemukan di tim ini' });
      }

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'REMOVE_MEMBER', 'team', $2, $3, $4)`,
        [user.id, id, JSON.stringify({ removed_user: userId }), request.ip]
      );

      return reply.send({ message: 'Anggota berhasil dihapus dari tim' });
    }
  );

  // ─── DELETE /api/teams/:id ─────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.requireSuperAdmin] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const user = request.currentUser!;

      const { rowCount } = await fastify.db.query('DELETE FROM teams WHERE id = $1', [id]);

      if (rowCount === 0) {
        return reply.status(404).send({ error: 'Tim tidak ditemukan' });
      }

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'DELETE', 'team', $2, $3, $4)`,
        [user.id, id, '{}', request.ip]
      );

      return reply.send({ message: 'Tim berhasil dihapus' });
    }
  );
}

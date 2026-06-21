import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

const createTeamSchema = z.object({
  name: z.string().min(1, 'Nama tim wajib diisi').max(255),
  description: z.string().optional(),
});

const updateTeamSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
});

export async function teamRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ─── GET /api/teams ───────────────────────
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    let query = 'SELECT t.*, COUNT(tm.user_id)::int as member_count FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id GROUP BY t.id ORDER BY t.name';
    const { rows } = await fastify.db.query(query);
    return reply.send({ data: rows });
  });

  // ─── GET /api/teams/:id ───────────────────
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { rows: team } = await fastify.db.query(
      'SELECT * FROM teams WHERE id = $1',
      [id]
    );

    if (team.length === 0) {
      return reply.status(404).send({ error: 'Tim tidak ditemukan' });
    }

    // Ambil anggota tim
    const { rows: members } = await fastify.db.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.last_login_at, d.name as district_name
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
        `INSERT INTO teams (name, description)
         VALUES ($1, $2) RETURNING *`,
        [body.name, body.description || null]
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
}

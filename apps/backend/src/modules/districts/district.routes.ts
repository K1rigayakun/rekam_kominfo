import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

const createDistrictSchema = z.object({
  name: z.string().min(1, 'Nama kecamatan wajib diisi').max(255),
});

const updateDistrictSchema = z.object({
  name: z.string().min(1).max(255),
});

export async function districtRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ─── GET /api/districts ───────────────────────
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    let query = 'SELECT * FROM districts ORDER BY name';
    const { rows } = await fastify.db.query(query);
    return reply.send({ data: rows });
  });

  // ─── GET /api/districts/:id ───────────────────
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { rows: district } = await fastify.db.query(
      'SELECT * FROM districts WHERE id = $1',
      [id]
    );

    if (district.length === 0) {
      return reply.status(404).send({ error: 'Kecamatan tidak ditemukan' });
    }

    // Ambil user di kecamatan ini
    const { rows: users } = await fastify.db.query(
      `SELECT id, email, full_name, role, is_active, last_login_at
       FROM users 
       WHERE district_id = $1 ORDER BY full_name`,
      [id]
    );

    return reply.send({ data: { ...district[0], users } });
  });

  // ─── POST /api/districts ─────────────────────
  fastify.post(
    '/',
    { preHandler: [fastify.requireSuperAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createDistrictSchema.parse(request.body);
      const user = request.currentUser!;

      // Cek nama unik
      const { rows: existing } = await fastify.db.query(
        'SELECT id FROM districts WHERE name = $1', [body.name]
      );
      if (existing.length > 0) {
        return reply.status(409).send({ error: 'Nama kecamatan sudah ada' });
      }

      const { rows } = await fastify.db.query(
        `INSERT INTO districts (name)
         VALUES ($1) RETURNING *`,
        [body.name]
      );

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'CREATE', 'district', $2, $3, $4)`,
        [user.id, rows[0].id, JSON.stringify({ name: body.name }), request.ip]
      );

      return reply.status(201).send({ data: rows[0] });
    }
  );

  // ─── PUT /api/districts/:id ──────────────────
  fastify.put<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.requireSuperAdmin] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const body = updateDistrictSchema.parse(request.body);
      const user = request.currentUser!;

      // Cek existing
      const { rows: existing } = await fastify.db.query(
        'SELECT id FROM districts WHERE id = $1', [id]
      );
      if (existing.length === 0) {
        return reply.status(404).send({ error: 'Kecamatan tidak ditemukan' });
      }

      // Cek conflict
      const { rows: conflict } = await fastify.db.query(
        'SELECT id FROM districts WHERE name = $1 AND id != $2', [body.name, id]
      );
      if (conflict.length > 0) {
        return reply.status(409).send({ error: 'Nama kecamatan sudah digunakan' });
      }

      const { rows } = await fastify.db.query(
        `UPDATE districts SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [body.name, id]
      );

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'UPDATE', 'district', $2, $3, $4)`,
        [user.id, id, JSON.stringify(body), request.ip]
      );

      return reply.send({ data: rows[0] });
    }
  );

  // ─── DELETE /api/districts/:id ───────────────
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.requireSuperAdmin] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const user = request.currentUser!;

      const { rows: existing } = await fastify.db.query(
        'SELECT id FROM districts WHERE id = $1', [id]
      );
      if (existing.length === 0) {
        return reply.status(404).send({ error: 'Kecamatan tidak ditemukan' });
      }

      // Cek pengguna yang terikat
      const { rows: users } = await fastify.db.query(
        'SELECT id FROM users WHERE district_id = $1 LIMIT 1', [id]
      );
      
      if (users.length > 0) {
        return reply.status(400).send({ error: 'Kecamatan tidak bisa dihapus karena masih ada pengguna yang terikat' });
      }

      await fastify.db.query('DELETE FROM districts WHERE id = $1', [id]);

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
         VALUES ($1, 'DELETE', 'district', $2, $3)`,
        [user.id, id, request.ip]
      );

      return reply.send({ message: 'Kecamatan berhasil dihapus' });
    }
  );
}

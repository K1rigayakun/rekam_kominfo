import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

const createTagSchema = z.object({
  name: z.string().min(1).max(255),
});

const updateTagSchema = z.object({
  name: z.string().min(1).max(255),
});

export const tagsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { rows } = await fastify.db.query(
      `SELECT t.*, u.full_name as created_by_name
       FROM tags t
       LEFT JOIN users u ON u.id = t.created_by
       ORDER BY t.created_at DESC`
    );
    return reply.send({ data: rows });
  });

  fastify.post('/', { preHandler: [fastify.authenticate, fastify.requireSuperAdmin] }, async (request, reply) => {
    const body = createTagSchema.parse(request.body);
    const user = request.currentUser!;

    const { rows } = await fastify.db.query(
      `INSERT INTO tags (name, created_by) VALUES ($1, $2) RETURNING *`,
      [body.name, user.id]
    );

    return reply.status(201).send({ data: rows[0] });
  });

  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [fastify.authenticate, fastify.requireSuperAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const body = updateTagSchema.parse(request.body);

    const { rows } = await fastify.db.query(
      `UPDATE tags SET name = $1 WHERE id = $2 RETURNING *`,
      [body.name, id]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Tag tidak ditemukan' });
    }

    return reply.send({ data: rows[0] });
  });

  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [fastify.authenticate, fastify.requireSuperAdmin] }, async (request, reply) => {
    const { id } = request.params;

    const { rowCount } = await fastify.db.query(
      `DELETE FROM tags WHERE id = $1`,
      [id]
    );

    if (rowCount === 0) {
      return reply.status(404).send({ error: 'Tag tidak ditemukan' });
    }

    return reply.send({ message: 'Tag berhasil dihapus' });
  });
};

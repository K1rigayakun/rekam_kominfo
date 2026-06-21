import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

const createPersonSchema = z.object({
  full_name: z.string().min(1, 'Nama wajib diisi').max(255),
  position: z.string().max(255).optional(),
  organization: z.string().max(255).optional(),
});

const listQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export async function personRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ─── GET /api/persons ──────────────────────
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listQuerySchema.parse(request.query);

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let idx = 1;

    if (query.search) {
      whereClause += ` AND full_name ILIKE $${idx}`;
      params.push(`%${query.search}%`);
      idx++;
    }

    const { rows } = await fastify.db.query(
      `SELECT * FROM persons
       ${whereClause}
       ORDER BY full_name ASC
       LIMIT $${idx}`,
      [...params, query.limit]
    );

    return reply.send({ data: rows });
  });

  // ─── POST /api/persons ─────────────────────
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createPersonSchema.parse(request.body);

    const { rows } = await fastify.db.query(
      `INSERT INTO persons (full_name, position, organization)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [body.full_name, body.position, body.organization]
    );

    return reply.status(201).send({ data: rows[0] });
  });
}

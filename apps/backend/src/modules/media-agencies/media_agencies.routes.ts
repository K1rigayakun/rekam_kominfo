import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

const mediaAgencySchema = z.object({
  name: z.string().min(1, 'Nama media wajib diisi'),
  website_url: z.string().optional().or(z.literal('')),
  media_type: z.enum(['ONLINE', 'OFFLINE', 'BOTH']),
});

export async function mediaAgenciesRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ─── GET /api/media-agencies ──────────────────
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { rows } = await fastify.db.query(
      `SELECT * FROM media_agencies ORDER BY name ASC`
    );
    return reply.send(rows);
  });

  // ─── POST /api/media-agencies ─────────────────
  fastify.post(
    '/',
    { preHandler: [fastify.requireEditor] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const data = mediaAgencySchema.parse(request.body);
      
      try {
        const { rows } = await fastify.db.query(
          `INSERT INTO media_agencies (name, website_url, media_type)
           VALUES ($1, $2, $3) RETURNING *`,
          [data.name, data.website_url || null, data.media_type]
        );
        return reply.status(201).send(rows[0]);
      } catch (err: any) {
        if (err.code === '23505') {
          return reply.status(400).send({ error: 'Nama media sudah ada' });
        }
        throw err;
      }
    }
  );

  // ─── PUT /api/media-agencies/:id ──────────────
  fastify.put<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.requireEditor] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const data = mediaAgencySchema.parse(request.body);
      
      try {
        const { rows } = await fastify.db.query(
          `UPDATE media_agencies 
           SET name = $1, website_url = $2, media_type = $3 
           WHERE id = $4 RETURNING *`,
          [data.name, data.website_url || null, data.media_type, request.params.id]
        );
        
        if (rows.length === 0) {
          return reply.status(404).send({ error: 'Media tidak ditemukan' });
        }
        return reply.send(rows[0]);
      } catch (err: any) {
        if (err.code === '23505') {
          return reply.status(400).send({ error: 'Nama media sudah ada' });
        }
        throw err;
      }
    }
  );

  // ─── DELETE /api/media-agencies/:id ───────────
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.requireSuperAdmin] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { rows } = await fastify.db.query(
        `DELETE FROM media_agencies WHERE id = $1 RETURNING id`,
        [request.params.id]
      );
      
      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Media tidak ditemukan' });
      }
      return reply.send({ message: 'Media berhasil dihapus' });
    }
  );
}

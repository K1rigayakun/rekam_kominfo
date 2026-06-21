import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

const auditQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
  user_id: z.string().uuid().optional(),
  action: z.string().optional(),
  entity_type: z.string().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
});

export async function auditRoutes(fastify: FastifyInstance) {
  // Hanya SUPER_ADMIN yang bisa melihat audit log
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireSuperAdmin);

  // ─── GET /api/audit ────────────────────────
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = auditQuerySchema.parse(request.query);
    const offset = (query.page - 1) * query.limit;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let idx = 1;

    if (query.user_id) {
      whereClause += ` AND al.user_id = $${idx}`;
      params.push(query.user_id);
      idx++;
    }
    if (query.action) {
      whereClause += ` AND al.action = $${idx}`;
      params.push(query.action);
      idx++;
    }
    if (query.entity_type) {
      whereClause += ` AND al.entity_type = $${idx}`;
      params.push(query.entity_type);
      idx++;
    }
    if (query.from_date) {
      whereClause += ` AND al.created_at >= $${idx}`;
      params.push(query.from_date);
      idx++;
    }
    if (query.to_date) {
      whereClause += ` AND al.created_at <= $${idx}`;
      params.push(query.to_date);
      idx++;
    }

    const countResult = await fastify.db.query(
      `SELECT COUNT(*) as total FROM audit_logs al ${whereClause}`,
      params
    );

    const { rows } = await fastify.db.query(
      `SELECT al.*, u.full_name as user_name, u.email as user_email
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, query.limit, offset]
    );

    return reply.send({
      data: rows,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: Number(countResult.rows[0].total),
        total_pages: Math.ceil(Number(countResult.rows[0].total) / query.limit),
      },
    });
  });

  // ─── GET /api/audit/export/csv ────────────────
  fastify.get('/export/csv', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = auditQuerySchema.parse({ ...request.query as any, page: 1, limit: 100000 });

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let idx = 1;

    if (query.user_id) {
      whereClause += ` AND al.user_id = $${idx}`;
      params.push(query.user_id);
      idx++;
    }
    if (query.action) {
      whereClause += ` AND al.action = $${idx}`;
      params.push(query.action);
      idx++;
    }
    if (query.entity_type) {
      whereClause += ` AND al.entity_type = $${idx}`;
      params.push(query.entity_type);
      idx++;
    }
    if (query.from_date) {
      whereClause += ` AND al.created_at >= $${idx}`;
      params.push(query.from_date);
      idx++;
    }
    if (query.to_date) {
      whereClause += ` AND al.created_at <= $${idx}`;
      params.push(query.to_date);
      idx++;
    }

    const { rows } = await fastify.db.query(
      `SELECT al.*, u.full_name as user_name, u.email as user_email
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${whereClause}
       ORDER BY al.created_at DESC`,
      params
    );

    // Build CSV
    const headers = ['Waktu', 'User', 'Email', 'Aksi', 'Entitas', 'Entity ID', 'Detail', 'IP'];
    const csvRows = rows.map((r: any) => [
      r.created_at ? new Date(r.created_at).toISOString() : '',
      (r.user_name || '').replace(/"/g, '""'),
      (r.user_email || '').replace(/"/g, '""'),
      r.action || '',
      r.entity_type || '',
      r.entity_id || '',
      r.details ? JSON.stringify(r.details).replace(/"/g, '""') : '',
      r.ip_address || '',
    ].map(v => `"${v}"`).join(','));

    const csv = [headers.join(','), ...csvRows].join('\n');

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="audit_log_${new Date().toISOString().split('T')[0]}.csv"`);
    return reply.send(csv);
  });
}

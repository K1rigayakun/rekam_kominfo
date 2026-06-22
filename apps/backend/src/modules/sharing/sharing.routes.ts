import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'crypto';

const createSnapshotSchema = z.object({
  activity_id: z.string().uuid(),
  title: z.string().max(500).optional(),
  download_quality: z.enum(['PREVIEW', 'ORIGINAL', 'BOTH']).default('BOTH'),
  expires_at: z.string().optional(), // ISO datetime
  items: z.array(
    z.object({
      section_id: z.string().uuid().optional(),
      media_id: z.string().uuid().optional(),
      sort_order: z.number().int().default(0),
    })
  ),
  config: z.any().optional(), // Tambahkan validasi Zod untuk config
});

export async function sharingRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireSuperAdmin);

  // ─── GET /api/sharing?activity_id=... ──────
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const activityId = (request.query as any).activity_id;

    if (!activityId) {
      return reply.status(400).send({ error: 'activity_id wajib disertakan' });
    }

    const { rows } = await fastify.db.query(
      `SELECT ss.*, u.full_name as created_by_name
       FROM sharing_snapshots ss
       LEFT JOIN users u ON u.id = ss.created_by
       WHERE ss.activity_id = $1
       ORDER BY ss.created_at DESC`,
      [activityId]
    );

    return reply.send({ data: rows });
  });

  // ─── GET /api/sharing/:id ─────────────────
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { rows: snapshot } = await fastify.db.query(
      'SELECT * FROM sharing_snapshots WHERE id = $1',
      [id]
    );

    if (snapshot.length === 0) {
      return reply.status(404).send({ error: 'Snapshot tidak ditemukan' });
    }

    const { rows: items } = await fastify.db.query(
      `SELECT ssi.*, es.title as section_title, mf.display_name, mf.original_filename, mf.media_type
       FROM sharing_snapshot_items ssi
       LEFT JOIN event_sections es ON es.id = ssi.section_id
       LEFT JOIN media_files mf ON mf.id = ssi.media_id
       WHERE ssi.snapshot_id = $1
       ORDER BY ssi.sort_order`,
      [id]
    );

    return reply.send({ data: { ...snapshot[0], items } });
  });

  // ─── POST /api/sharing ────────────────────
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createSnapshotSchema.parse(request.body);
    const user = request.currentUser!;

    if (user.role !== 'SUPER_ADMIN') {
      return reply.status(403).send({ error: 'Akses ditolak: Hanya Admin yang dapat membuat Tautan/QR Code' });
    }

    // Generate token unik untuk URL publik
    const token = randomBytes(32).toString('hex');

    // Buat snapshot
    const { rows: snapshotRows } = await fastify.db.query(
      `INSERT INTO sharing_snapshots 
       (activity_id, token, title, download_quality, expires_at, created_by, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        body.activity_id,
        token,
        body.title || null,
        body.download_quality,
        body.expires_at || null,
        user.id,
        body.config || {},
      ]
    );

    const snapshotId = snapshotRows[0].id;

    // Buat items
    for (const item of body.items) {
      await fastify.db.query(
        `INSERT INTO sharing_snapshot_items (snapshot_id, section_id, media_id, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [snapshotId, item.section_id || null, item.media_id || null, item.sort_order]
      );
    }

    // Log audit
    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, 'SHARE', 'sharing_snapshot', $2, $3, $4)`,
      [user.id, snapshotId, JSON.stringify({ token, items_count: body.items.length }), request.ip]
    );

    return reply.status(201).send({
      data: snapshotRows[0],
      public_url: `${process.env.PUBLIC_BASE_URL || 'http://localhost:5173'}/p/${token}`,
    });
  });

  // ─── PUT /api/sharing/:id/deactivate ──────
  fastify.put(
    '/:id/deactivate',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const user = request.currentUser!;

      if (user.role !== 'SUPER_ADMIN') {
        return reply.status(403).send({ error: 'Akses ditolak: Hanya Admin yang dapat menonaktifkan tautan' });
      }

      const { rows } = await fastify.db.query(
        `UPDATE sharing_snapshots SET is_active = false WHERE id = $1 RETURNING *`,
        [id]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Snapshot tidak ditemukan' });
      }

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
         VALUES ($1, 'UNSHARE', 'sharing_snapshot', $2, $3)`,
        [user.id, id, request.ip]
      );

      return reply.send({ data: rows[0] });
    }
  );

  // ─── PUT /api/sharing/:id/reactivate ──────
  fastify.put(
    '/:id/reactivate',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const user = request.currentUser!;

      if (user.role !== 'SUPER_ADMIN') {
        return reply.status(403).send({ error: 'Akses ditolak: Hanya Admin yang dapat mengaktifkan tautan' });
      }

      const { rows } = await fastify.db.query(
        `UPDATE sharing_snapshots SET is_active = true WHERE id = $1 RETURNING *`,
        [id]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Snapshot tidak ditemukan' });
      }

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
         VALUES ($1, 'SHARE', 'sharing_snapshot', $2, $3)`,
        [user.id, id, request.ip]
      );

      return reply.send({ data: rows[0] });
    }
  );

  // ─── GET /api/sharing/:id/analytics ───────
  fastify.get(
    '/:id/analytics',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const user = request.currentUser!;

      if (user.role !== 'SUPER_ADMIN') {
        return reply.status(403).send({ error: 'Akses ditolak: Hanya Admin yang dapat melihat analitik' });
      }

      // 1. Total Scans
      const { rows: totalRows } = await fastify.db.query(
        'SELECT COUNT(*) as total_scans FROM qr_scan_logs WHERE snapshot_id = $1',
        [id]
      );

      // 2. Daily trend (Last 30 days)
      const { rows: dailyRows } = await fastify.db.query(
        `SELECT DATE(scanned_at) as scan_date, COUNT(*) as count
         FROM qr_scan_logs
         WHERE snapshot_id = $1 AND scanned_at >= NOW() - INTERVAL '30 days'
         GROUP BY DATE(scanned_at)
         ORDER BY scan_date ASC`,
        [id]
      );

      // 3. Recent 10 scans
      const { rows: recentRows } = await fastify.db.query(
        `SELECT ip_address, user_agent, scanned_at
         FROM qr_scan_logs
         WHERE snapshot_id = $1
         ORDER BY scanned_at DESC
         LIMIT 10`,
        [id]
      );

      return reply.send({
        data: {
          total_scans: Number(totalRows[0].total_scans),
          daily_trend: dailyRows.map((r: any) => ({
            date: r.scan_date.toISOString().split('T')[0], // format YYYY-MM-DD
            count: Number(r.count)
          })),
          recent_scans: recentRows
        }
      });
    }
  );
}

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { withTransaction } from '../../plugins/db';

const uuidOrEmpty = z.string().uuid().or(z.literal('')).transform((value) => value || undefined);

const snapshotItemSchema = z.object({
  section_id: uuidOrEmpty.optional(),
  media_id: uuidOrEmpty.optional(),
  sort_order: z.coerce.number().int().default(0),
}).refine((item) => Boolean(item.section_id || item.media_id), {
  message: 'section_id atau media_id wajib diisi',
});

const createSnapshotSchema = z.object({
  activity_id: z.string().uuid(),
  title: z.string().max(500).optional(),
  download_quality: z.preprocess(
    (value) => typeof value === 'string' ? value.toUpperCase() : value,
    z.enum(['PREVIEW', 'ORIGINAL', 'BOTH'])
  ).default('BOTH'),
  expires_at: z.string().or(z.literal('')).transform((value) => value === '' ? undefined : value).optional(),
  items: z.array(snapshotItemSchema).optional(),
  media_ids: z.array(z.string().uuid()).optional(),
  section_ids: z.array(z.string().uuid()).optional(),
  config: z.any().optional(),
}).transform((body) => {
  const legacyItems: Array<{ section_id?: string; media_id?: string; sort_order: number }> = [
    ...(body.section_ids || []).map((sectionId, index) => ({
      section_id: sectionId,
      sort_order: index,
    })),
    ...(body.media_ids || []).map((mediaId, index) => ({
      media_id: mediaId,
      sort_order: (body.section_ids?.length || 0) + index,
    })),
  ];

  return {
    ...body,
    items: body.items || legacyItems,
  };
}).superRefine((body, ctx) => {
  const sharesAttachments = Boolean(body.config?.share_attachments);
  if (body.items.length === 0 && !sharesAttachments) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items'],
      message: 'Pilih setidaknya satu seksi, media, atau lampiran untuk dibagikan',
    });
  }
});

function resolvePublicBaseUrl(request: FastifyRequest) {
  const forwardedHost = String(request.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const host = forwardedHost || request.headers.host || 'localhost:5173';
  const proto = forwardedProto || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  const configured = process.env.PUBLIC_BASE_URL?.split(',')[0]?.trim();

  if (configured) {
    try {
      const configuredUrl = new URL(configured);
      const requestUrl = new URL(`${proto}://${host}`);
      const configuredIsLoopback = ['localhost', '127.0.0.1', '::1'].includes(configuredUrl.hostname);
      const requestIsLoopback = ['localhost', '127.0.0.1', '::1'].includes(requestUrl.hostname);

      if (!configuredIsLoopback || requestIsLoopback) {
        return configuredUrl.origin;
      }
    } catch {
      return configured.replace(/\/$/, '');
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    try {
      const url = new URL(`${proto}://${host}`);
      if (url.port === '3000') {
        url.port = '5173';
        return url.origin;
      }
    } catch {
      return 'http://localhost:5173';
    }
  }

  return `${proto}://${host}`;
}

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
    const parsed = createSnapshotSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validasi gagal',
        details: parsed.error.issues,
      });
    }

    const body = parsed.data;
    const user = request.currentUser!;

    if (user.role !== 'SUPER_ADMIN') {
      return reply.status(403).send({ error: 'Akses ditolak: Hanya Admin yang dapat membuat Tautan/QR Code' });
    }

    // Generate token unik untuk URL publik
    const token = randomBytes(32).toString('hex');

    const snapshot = await withTransaction(fastify.db, async (client) => {
      const { rowCount: activityCount } = await client.query(
        'SELECT 1 FROM activities WHERE id = $1',
        [body.activity_id]
      );

      if (activityCount === 0) {
        return reply.status(404).send({ error: 'Acara tidak ditemukan' });
      }

      const sectionIds = body.items.map((item) => item.section_id).filter(Boolean);
      if (sectionIds.length > 0) {
        const { rows } = await client.query(
          'SELECT id FROM event_sections WHERE activity_id = $1 AND id = ANY($2::uuid[])',
          [body.activity_id, sectionIds]
        );
        if (rows.length !== new Set(sectionIds).size) {
          return reply.status(400).send({ error: 'Ada seksi yang tidak termasuk dalam acara ini' });
        }
      }

      const mediaIds = body.items.map((item) => item.media_id).filter(Boolean);
      if (mediaIds.length > 0) {
        const { rows } = await client.query(
          'SELECT id FROM media_files WHERE activity_id = $1 AND id = ANY($2::uuid[])',
          [body.activity_id, mediaIds]
        );
        if (rows.length !== new Set(mediaIds).size) {
          return reply.status(400).send({ error: 'Ada media yang tidak termasuk dalam acara ini' });
        }
      }

      const allowedAttachmentIds = body.config?.allowed_attachment_ids;
      if (Array.isArray(allowedAttachmentIds) && allowedAttachmentIds.length > 0) {
        const { rows } = await client.query(
          'SELECT id FROM event_attachments WHERE activity_id = $1 AND id = ANY($2::uuid[])',
          [body.activity_id, allowedAttachmentIds]
        );
        if (rows.length !== new Set(allowedAttachmentIds).size) {
          return reply.status(400).send({ error: 'Ada lampiran yang tidak termasuk dalam acara ini' });
        }
      }

      // Buat snapshot
      const { rows: snapshotRows } = await client.query(
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
        await client.query(
          `INSERT INTO sharing_snapshot_items (snapshot_id, section_id, media_id, sort_order)
           VALUES ($1, $2, $3, $4)`,
          [snapshotId, item.section_id || null, item.media_id || null, item.sort_order]
        );
      }

      // Log audit
      await client.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'SHARE', 'sharing_snapshot', $2, $3, $4)`,
        [user.id, snapshotId, JSON.stringify({ token, items_count: body.items.length }), request.ip]
      );

      return snapshotRows[0];
    });

    if (reply.sent) return reply;

    return reply.status(201).send({
      data: snapshot,
      token,
      public_url: `${resolvePublicBaseUrl(request)}/share/${token}`,
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

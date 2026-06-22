import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

// ─── Validation Schemas ──────────────────────
const createActivitySchema = z.object({
  title: z.string().min(1, 'Judul wajib diisi').max(500),
  description: z.string().optional(),
  description_json: z.any().optional(), // TipTap JSONB
  event_date: z.string().optional(),
  event_end_date: z.string().optional(),
  location: z.string().max(500).optional(),
  use_sections: z.boolean().default(true),
  team_id: z.string().uuid({ message: 'Format ID Tim tidak valid' }).optional(),
  district_id: z.string().uuid({ message: 'Format ID Kecamatan tidak valid' }).optional(),
});

const updateActivitySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  description_json: z.any().optional(),
  event_date: z.string().optional(),
  event_end_date: z.string().optional(),
  location: z.string().max(500).optional(),
  use_sections: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  district_id: z.string().uuid().nullable().optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  team_id: z.string().uuid().optional(),
  district_id: z.string().uuid().optional(),
  archived: z.coerce.boolean().default(false),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  filter_day: z.coerce.number().min(1).max(31).optional(),
  filter_month: z.coerce.number().min(1).max(12).optional(),
  filter_year: z.coerce.number().min(2000).max(2100).optional(),
});

export async function activityRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  function activityAccessCondition(alias: string, userIdParam: number, districtIdParam: number) {
    return `(
      ${alias}.created_by = $${userIdParam}
      OR (${alias}.district_id IS NOT NULL AND ${alias}.district_id = $${districtIdParam})
      OR EXISTS (
        SELECT 1 FROM team_members tm
        WHERE tm.team_id = ${alias}.team_id
          AND tm.user_id = $${userIdParam}
      )
    )`;
  }

  async function canAccessActivity(activityId: string, user: NonNullable<FastifyRequest['currentUser']>) {
    if (user.role === 'SUPER_ADMIN') return true;

    const { rowCount } = await fastify.db.query(
      `SELECT 1
       FROM activities a
       WHERE a.id = $1
         AND ${activityAccessCondition('a', 2, 3)}
       LIMIT 1`,
      [activityId, user.id, user.district_id]
    );

    return Number(rowCount) > 0;
  }

  async function canUseTeam(teamId: string | undefined, user: NonNullable<FastifyRequest['currentUser']>) {
    if (!teamId || user.role === 'SUPER_ADMIN') return true;

    const { rowCount } = await fastify.db.query(
      'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2 LIMIT 1',
      [teamId, user.id]
    );

    return Number(rowCount) > 0;
  }

  async function removeMinioObject(bucket: string, key: string | null | undefined) {
    if (!key) return;
    try {
      await fastify.minio.removeObject(bucket, key);
    } catch (err) {
      fastify.log.warn({ err, bucket, key }, 'Gagal menghapus object MinIO saat hard delete acara');
    }
  }

  // ─── GET /api/activities ───────────────────
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = listQuerySchema.parse(request.query);
    const offset = (query.page - 1) * query.limit;
    const user = request.currentUser!;

    let whereClause = 'WHERE a.is_archived = $1';
    const params: any[] = [query.archived];
    let paramIndex = 2;

    // Filter berdasarkan team
    if (query.team_id) {
      whereClause += ` AND a.team_id = $${paramIndex}`;
      params.push(query.team_id);
      paramIndex++;
    }

    if (user.role !== 'SUPER_ADMIN') {
      whereClause += ` AND ${activityAccessCondition('a', paramIndex, paramIndex + 1)}`;
      params.push(user.id, user.district_id);
      paramIndex += 2;
    }

    if (query.district_id) {
      whereClause += ` AND a.district_id = $${paramIndex}`;
      params.push(query.district_id);
      paramIndex++;
    }

    let orderBy = 'ORDER BY a.event_date DESC NULLS LAST, a.created_at DESC';

    // Full-text search jika tersedia, fallback ke ILIKE diganti ke FTS tsvector
    if (query.search) {
      whereClause += ` AND a.search_vector @@ plainto_tsquery('simple', $${paramIndex})`;
      orderBy = `ORDER BY ts_rank(a.search_vector, plainto_tsquery('simple', $${paramIndex})) DESC, a.event_date DESC NULLS LAST`;
      params.push(query.search);
      paramIndex++;
    }

    // Filter tanggal
    if (query.date_from) {
      whereClause += ` AND a.event_date >= $${paramIndex}`;
      params.push(query.date_from);
      paramIndex++;
    }
    if (query.date_to) {
      whereClause += ` AND a.event_date <= $${paramIndex}`;
      params.push(query.date_to);
      paramIndex++;
    }

    if (query.filter_day) {
      whereClause += ` AND EXTRACT(DAY FROM a.event_date) = $${paramIndex}`;
      params.push(query.filter_day);
      paramIndex++;
    }
    if (query.filter_month) {
      whereClause += ` AND EXTRACT(MONTH FROM a.event_date) = $${paramIndex}`;
      params.push(query.filter_month);
      paramIndex++;
    }
    if (query.filter_year) {
      whereClause += ` AND EXTRACT(YEAR FROM a.event_date) = $${paramIndex}`;
      params.push(query.filter_year);
      paramIndex++;
    }

    // Count total
    const countResult = await fastify.db.query(
      `SELECT COUNT(*) as total
       FROM activities a
       LEFT JOIN users u ON u.id = a.created_by
       ${whereClause}`,
      params
    );

    // Fetch data
    const { rows } = await fastify.db.query(
      `SELECT a.*, t.name as team_name, u.full_name as created_by_name, d.name as district_name,
              (SELECT COUNT(*) FROM media_files mf WHERE mf.activity_id = a.id) as media_count,
              (SELECT COUNT(*) FROM media_files mf WHERE mf.activity_id = a.id AND mf.status = 'ERROR' AND mf.processing_error = 'COMPROMISED') as compromised_count,
              (SELECT COUNT(*) FROM event_sections es WHERE es.activity_id = a.id) as section_count
       FROM activities a
       LEFT JOIN teams t ON t.id = a.team_id
       LEFT JOIN users u ON u.id = a.created_by
       LEFT JOIN districts d ON d.id = a.district_id
       ${whereClause}
       ${orderBy}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
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

  // ─── GET /api/activities/:id ───────────────
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const user = request.currentUser!;

    const { rows } = await fastify.db.query(
      `SELECT a.*, t.name as team_name, u.full_name as created_by_name, d.name as district_name
       FROM activities a
       LEFT JOIN teams t ON t.id = a.team_id
       LEFT JOIN users u ON u.id = a.created_by
       LEFT JOIN districts d ON d.id = a.district_id
       WHERE a.id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Acara tidak ditemukan' });
    }

    if (!(await canAccessActivity(id, user))) {
      return reply.status(403).send({ error: 'Akses acara ditolak' });
    }

    // Ambil sections + media count per section
    const { rows: sections } = await fastify.db.query(
      `SELECT es.*, 
              (SELECT COUNT(*) FROM media_files mf WHERE mf.section_id = es.id) as media_count,
              (SELECT COUNT(*) FROM media_files mf WHERE mf.section_id = es.id AND mf.status = 'ERROR' AND mf.processing_error = 'COMPROMISED') as compromised_count
       FROM event_sections es 
       WHERE es.activity_id = $1 
       ORDER BY es.sort_order`,
      [id]
    );

    // Ambil media tanpa section (jika use_sections = false)
    const { rows: unsectionedMedia } = await fastify.db.query(
       `SELECT mf.id, mf.display_name, mf.original_filename, mf.media_type, 
               mf.mime_type, mf.status, mf.processing_error, mf.is_edited, mf.title_is_auto_gen,
               mf.title, mf.description, mf.description_json,
              mf.storage_key_thumbnail, mf.sort_order
       FROM media_files mf
       WHERE mf.activity_id = $1 AND mf.section_id IS NULL
       ORDER BY mf.sort_order, mf.created_at`,
      [id]
    );

    // Ambil attachments
    const { rows: attachments } = await fastify.db.query(
      `SELECT ea.id, ea.original_filename, ea.display_name, ea.mime_type, ea.file_size_bytes, ea.created_at
       FROM event_attachments ea
       WHERE ea.activity_id = $1
       ORDER BY ea.created_at`,
      [id]
    );

    return reply.send({
      data: {
        ...rows[0],
        sections,
        unsectioned_media: unsectionedMedia,
        attachments,
      },
    });
  });

  // ─── POST /api/activities ──────────────────
  fastify.post(
    '/',
    { preHandler: [fastify.requireEditor] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createActivitySchema.parse(request.body);
      const user = request.currentUser!;

      const teamId = body.team_id;
      const districtId = body.district_id || user.district_id || null;

      if (user.role !== 'SUPER_ADMIN' && body.district_id && body.district_id !== user.district_id) {
        return reply.status(403).send({ error: 'Editor hanya boleh membuat acara untuk kecamatan sendiri' });
      }

      if (!(await canUseTeam(teamId, user))) {
        return reply.status(403).send({ error: 'Editor hanya boleh memilih tim yang dia ikuti' });
      }

      const { rows } = await fastify.db.query(
        `INSERT INTO activities (title, description, description_json, event_date, event_end_date, location, use_sections, team_id, district_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          body.title,
          body.description || null,
          body.description_json ? JSON.stringify(body.description_json) : null,
          body.event_date || new Date().toISOString().split('T')[0],
          body.event_end_date || null,
          body.location || null,
          body.use_sections,
          teamId,
          districtId,
          user.id,
        ]
      );

      // Jika use_sections aktif, buat section default "Umum"
      if (body.use_sections) {
        await fastify.db.query(
          `INSERT INTO event_sections (activity_id, title, sort_order, created_by)
           VALUES ($1, 'Umum', 0, $2)`,
          [rows[0].id, user.id]
        );
      }

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'CREATE', 'activity', $2, $3, $4)`,
        [user.id, rows[0].id, JSON.stringify({ title: body.title, district_id: districtId }), request.ip]
      );

      // Simpan snapshot versi 1 ke activity_versions
      await fastify.db.query(
        `INSERT INTO activity_versions (activity_id, version_number, snapshot_data, created_by)
         VALUES ($1, 1, $2, $3)`,
        [rows[0].id, JSON.stringify(rows[0]), user.id]
      );

      return reply.status(201).send({ data: rows[0] });
    }
  );

  // ─── PUT /api/activities/:id ───────────────
  fastify.put<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.requireEditor] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const body = updateActivitySchema.parse(request.body);
      const user = request.currentUser!;

      // Cek apakah acara ada
      const { rows: existing } = await fastify.db.query(
        'SELECT id, use_sections FROM activities WHERE id = $1',
        [id]
      );

      if (existing.length === 0) {
        return reply.status(404).send({ error: 'Acara tidak ditemukan' });
      }

      if (!(await canAccessActivity(id, user))) {
        return reply.status(403).send({ error: 'Akses acara ditolak' });
      }

      if (user.role !== 'SUPER_ADMIN' && body.district_id && body.district_id !== user.district_id) {
        return reply.status(403).send({ error: 'Editor hanya boleh memindahkan acara ke kecamatan sendiri' });
      }

      // Build dynamic update query
      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;

      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined) {
          if (key === 'description_json') {
            updates.push(`${key} = $${idx}`);
            values.push(JSON.stringify(value));
          } else {
            updates.push(`${key} = $${idx}`);
            values.push(value);
          }
          idx++;
        }
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Tidak ada data yang diubah' });
      }

      values.push(id);
      const { rows } = await fastify.db.query(
        `UPDATE activities SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );

      // Jika use_sections baru diaktifkan, buat section "Umum" default jika belum ada
      if (body.use_sections === true && !existing[0].use_sections) {
        const { rows: existingSections } = await fastify.db.query(
          'SELECT id FROM event_sections WHERE activity_id = $1 LIMIT 1',
          [id]
        );
        if (existingSections.length === 0) {
          await fastify.db.query(
            `INSERT INTO event_sections (activity_id, title, sort_order, created_by)
             VALUES ($1, 'Umum', 0, $2)`,
            [id, user.id]
          );
        }
      }

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'UPDATE', 'activity', $2, $3, $4)`,
        [user.id, id, JSON.stringify(body), request.ip]
      );

      // Simpan snapshot ke activity_versions
      const { rows: versionRes } = await fastify.db.query(
        'SELECT COALESCE(MAX(version_number), 0) + 1 as next_version FROM activity_versions WHERE activity_id = $1',
        [id]
      );
      const nextVersion = versionRes[0].next_version;

      await fastify.db.query(
        `INSERT INTO activity_versions (activity_id, version_number, snapshot_data, created_by)
         VALUES ($1, $2, $3, $4)`,
        [id, nextVersion, JSON.stringify(rows[0]), user.id]
      );

      return reply.send({ data: rows[0] });
    }
  );

  // ─── DELETE /api/activities/:id (soft delete) ─
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.requireEditor] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const user = request.currentUser!;
      const hardDelete = (request.query as any).hard === 'true';

      const { rowCount: activityExists } = await fastify.db.query(
        'SELECT 1 FROM activities WHERE id = $1 LIMIT 1',
        [id]
      );
      if (Number(activityExists) === 0) {
        return reply.status(404).send({ error: 'Acara tidak ditemukan' });
      }

      if (hardDelete && user.role !== 'SUPER_ADMIN') {
        return reply.status(403).send({ error: 'Hard delete hanya dapat dilakukan SUPER_ADMIN' });
      }

      if (!hardDelete && !(await canAccessActivity(id, user))) {
        return reply.status(403).send({ error: 'Akses acara ditolak' });
      }

      if (hardDelete) {
        const { rows: mediaRows } = await fastify.db.query(
          `SELECT storage_key_raw, storage_key_processed, storage_key_thumbnail, quality_variants
           FROM media_files
           WHERE activity_id = $1`,
          [id]
        );
        const { rows: attachmentRows } = await fastify.db.query(
          `SELECT storage_key FROM event_attachments WHERE activity_id = $1`,
          [id]
        );
        const { rows: exportRows } = await fastify.db.query(
          `SELECT storage_key FROM export_jobs WHERE entity_id = $1`,
          [id]
        );

        for (const media of mediaRows) {
          await removeMinioObject(fastify.minioBuckets.raw, media.storage_key_raw);
          await removeMinioObject(fastify.minioBuckets.processed, media.storage_key_processed);
          await removeMinioObject(fastify.minioBuckets.processed, media.storage_key_thumbnail);

          const variants = media.quality_variants || {};
          for (const key of Object.values(variants)) {
            if (typeof key === 'string') {
              await removeMinioObject(fastify.minioBuckets.processed, key);
            }
          }
        }

        for (const attachment of attachmentRows) {
          await removeMinioObject(fastify.minioBuckets.attach, attachment.storage_key);
        }

        for (const exportJob of exportRows) {
          await removeMinioObject(fastify.minioBuckets.exports, exportJob.storage_key);
        }

        const { rowCount } = await fastify.db.query('DELETE FROM activities WHERE id = $1', [id]);
        if (rowCount === 0) {
          return reply.status(404).send({ error: 'Acara tidak ditemukan' });
        }
      } else {
        // Soft delete — archive
        const { rowCount } = await fastify.db.query(
          'UPDATE activities SET is_archived = true WHERE id = $1',
          [id]
        );
        if (rowCount === 0) {
          return reply.status(404).send({ error: 'Acara tidak ditemukan' });
        }
      }

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'DELETE', 'activity', $2, $3, $4)`,
        [user.id, id, JSON.stringify({ hard_delete: hardDelete }), request.ip]
      );

      return reply.send({ message: hardDelete ? 'Acara berhasil dihapus permanen' : 'Acara berhasil diarsipkan' });
    }
  );

}

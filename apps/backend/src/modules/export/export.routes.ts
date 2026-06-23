import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

export async function exportRoutes(fastify: FastifyInstance) {
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

  // ─── GET /api/export/activity/:id/zip ──────
  fastify.get('/activity/:id/zip', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const user = request.currentUser!;

    // Cek apakah activity ada
    const { rows: activities } = await fastify.db.query(
      'SELECT title, event_date FROM activities WHERE id = $1',
      [id]
    );

    if (activities.length === 0) {
      return reply.status(404).send({ error: 'Acara tidak ditemukan' });
    }

    if (!(await canAccessActivity(id, user))) {
      return reply.status(403).send({ error: 'Akses acara ditolak' });
    }

    // Buat record di export_jobs
    const { rows: jobs } = await fastify.db.query(
      `INSERT INTO export_jobs (user_id, entity_type, entity_id, expires_at)
       VALUES ($1, 'activity_zip', $2, NOW() + INTERVAL '24 hours') RETURNING id`,
      [user.id, id]
    );

    const jobId = jobs[0].id;

    // Masukkan ke queue
    await fastify.exportQueue.add('export-zip', {
      jobId,
      entityType: 'activity_zip',
      entityId: id,
      userId: user.id
    });

    // Log export request
    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
       VALUES ($1, 'EXPORT', 'activity_export_zip', $2, $3)`,
      [user.id, id, request.ip]
    );

    return reply.status(202).send({ message: 'Proses ekspor ZIP dimulai', job_id: jobId });
  });

  // ─── GET /api/export/activity/:id/pdf ──────
  fastify.get('/activity/:id/pdf', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const user = request.currentUser!;

    // Cek apakah activity ada
    const { rows: activities } = await fastify.db.query(
      `SELECT title FROM activities WHERE id = $1`,
      [id]
    );

    if (activities.length === 0) {
      return reply.status(404).send({ error: 'Acara tidak ditemukan' });
    }

    if (!(await canAccessActivity(id, user))) {
      return reply.status(403).send({ error: 'Akses acara ditolak' });
    }

    // Buat record di export_jobs
    const { rows: jobs } = await fastify.db.query(
      `INSERT INTO export_jobs (user_id, entity_type, entity_id, expires_at)
       VALUES ($1, 'activity_pdf', $2, NOW() + INTERVAL '24 hours') RETURNING id`,
      [user.id, id]
    );

    const jobId = jobs[0].id;

    // Masukkan ke queue
    await fastify.exportQueue.add('export-pdf', {
      jobId,
      entityType: 'activity_pdf',
      entityId: id,
      userId: user.id
    });

    // Log export request
    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
       VALUES ($1, 'EXPORT', 'activity_export_pdf', $2, $3)`,
      [user.id, id, request.ip]
    );

    return reply.status(202).send({ message: 'Proses ekspor PDF dimulai', job_id: jobId });
  });

  // ─── GET /api/export/jobs/:id ──────
  fastify.get('/jobs/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const user = request.currentUser!;

    const { rows: jobs } = await fastify.db.query(
      `SELECT id, status, file_name, error_message, created_at, completed_at
       FROM export_jobs
       WHERE id = $1 AND user_id = $2`,
      [id, user.id]
    );

    if (jobs.length === 0) {
      return reply.status(404).send({ error: 'Job tidak ditemukan' });
    }

    return reply.send(jobs[0]);
  });

  // ─── GET /api/export/download/:id ──────
  fastify.get('/download/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const user = request.currentUser!;

    const { rows: jobs } = await fastify.db.query(
      `SELECT status, storage_key, file_name, entity_type, entity_id
       FROM export_jobs
       WHERE id = $1 AND user_id = $2`,
      [id, user.id]
    );

    if (jobs.length === 0) {
      return reply.status(404).send({ error: 'Job tidak ditemukan' });
    }

    const job = jobs[0];

    if (job.status !== 'COMPLETED' || !job.storage_key) {
      return reply.status(400).send({ error: 'File export belum siap atau gagal diproses' });
    }

    try {
      const stream = await fastify.minio.getObject(fastify.minioBuckets.exports, job.storage_key);
      
      const contentType = job.storage_key.endsWith('.pdf') ? 'application/pdf' : 'application/zip';
      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `attachment; filename="${job.file_name}"`);
      
      // Log export download
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
         VALUES ($1, 'DOWNLOAD', $2, $3, $4)`,
        [user.id, job.entity_type, job.entity_id, request.ip]
      );

      return reply.send(stream);
    } catch (err: any) {
      fastify.log.error(err, `Gagal mendownload export file: ${job.storage_key}`);
      return reply.status(500).send({ error: 'Gagal mengambil file export' });
    }
  });

  // ─── GET /api/export/audit/pdf ─────────────
  fastify.get('/audit/pdf', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.currentUser!;

    if (user.role !== 'SUPER_ADMIN') {
      return reply.status(403).send({ error: 'Hanya SUPER_ADMIN yang dapat mengunduh laporan audit' });
    }

    const { rows: logs } = await fastify.db.query(
      `SELECT al.*, u.full_name as user_name, u.email as user_email
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ORDER BY al.created_at DESC
       LIMIT 1000` // Batasi maksimal 1000 log terbaru agar tidak terlalu berat
    );

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'attachment; filename="REKAM_Audit_Report.pdf"');

    const doc = new PDFDocument({ margin: 50 });
    const stream = new PassThrough();
    doc.pipe(stream);

    // Header
    doc.fontSize(20).text('Laporan Audit Log REKAM', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Dicetak oleh: ${user.username}`, { align: 'center' });
    doc.text(`Waktu: ${new Date().toLocaleString('id-ID')}`, { align: 'center' });
    doc.moveDown(2);

    // Table Header
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Waktu', 50, doc.y, { continued: true, width: 120 });
    doc.text('Pengguna', 170, doc.y, { continued: true, width: 120 });
    doc.text('Aksi', 290, doc.y, { continued: true, width: 80 });
    doc.text('Entitas', 370, doc.y, { width: 150 });
    
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);

    // Table Body
    doc.font('Helvetica');
    for (const log of logs) {
      if (doc.y > 700) doc.addPage();
      
      const timeStr = new Date(log.created_at).toLocaleString('id-ID');
      const userStr = log.user_name ? `${log.user_name}` : 'System';
      const actionStr = log.action;
      const entityStr = `${log.entity_type}`;

      doc.text(timeStr, 50, doc.y, { continued: true, width: 120 });
      doc.text(userStr, 170, doc.y, { continued: true, width: 120 });
      doc.text(actionStr, 290, doc.y, { continued: true, width: 80 });
      doc.text(entityStr, 370, doc.y, { width: 150 });
      doc.moveDown(0.2);
    }

    doc.end();
    return reply.send(stream);
  });

  // ─── GET /api/export/audit/csv ─────────────
  fastify.get('/audit/csv', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.currentUser!;

    if (user.role !== 'SUPER_ADMIN') {
      return reply.status(403).send({ error: 'Hanya SUPER_ADMIN yang dapat mengunduh laporan audit' });
    }

    const { rows: logs } = await fastify.db.query(
      `SELECT al.*, u.full_name as user_name, u.username as user_username
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ORDER BY al.created_at DESC
       LIMIT 5000`
    );

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="REKAM_Audit_Report.csv"');

    // Header CSV
    let csv = 'Waktu,Pengguna,Username,Aksi,Entitas,ID Entitas,IP Address\n';

    // Body CSV
    for (const log of logs) {
      const timeStr = new Date(log.created_at).toISOString();
      const userStr = log.user_name ? `"${log.user_name.replace(/"/g, '""')}"` : '"System"';
      const usernameStr = log.user_username ? `"${log.user_username}"` : '""';
      const actionStr = `"${log.action}"`;
      const entityStr = `"${log.entity_type || ''}"`;
      const entityIdStr = `"${log.entity_id || ''}"`;
      const ipStr = `"${log.ip_address || ''}"`;

      csv += `${timeStr},${userStr},${usernameStr},${actionStr},${entityStr},${entityIdStr},${ipStr}\n`;
    }

    return reply.send(csv);
  });

  // ─── GET /api/export/activities/csv ──────────
  fastify.get('/activities/csv', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.currentUser!;
    const { start_date, end_date } = request.query as any;

    if (user.role !== 'SUPER_ADMIN' && user.role !== 'EDITOR') {
      return reply.status(403).send({ error: 'Akses ditolak' });
    }

    let query = `
      SELECT 
        a.title,
        t.name as team_name,
        a.event_date,
        a.location,
        (
          SELECT string_agg(tag_name, ', ')
          FROM activity_tags
          WHERE activity_id = a.id
        ) as tags,
        (
          SELECT COUNT(id)
          FROM media_files
          WHERE activity_id = a.id
        ) as internal_media_count
      FROM activities a
      LEFT JOIN teams t ON t.id = a.team_id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (start_date) {
      query += ` AND a.event_date >= $${paramIndex++}`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND a.event_date <= $${paramIndex++}`;
      params.push(end_date);
    }

    query += ` ORDER BY a.event_date DESC NULLS LAST, a.created_at DESC`;

    const { rows } = await fastify.db.query(query, params);

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="Ringkasan_Acara_REKAM.csv"');

    // Header CSV
    let csv = 'Nama Acara,Tim Peliput,Tag,Tanggal,Lokasi,Jml File Internal\n';

    // Helper escape CSV
    const escapeCsv = (str: string | null | undefined | number) => {
      if (str === null || str === undefined || str === '') return '-';
      const strVal = String(str);
      if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
        return `"${strVal.replace(/"/g, '""')}"`;
      }
      return strVal;
    };

    // Body CSV
    for (const row of rows) {
      const dateStr = row.event_date ? new Date(row.event_date).toISOString().split('T')[0] : '-';
      csv += `${escapeCsv(row.title)},${escapeCsv(row.team_name)},${escapeCsv(row.tags)},${escapeCsv(dateStr)},${escapeCsv(row.location)},${escapeCsv(row.internal_media_count)}\n`;
    }

    // Log audit
    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, ip_address)
       VALUES ($1, 'EXPORT', 'activities_summary_csv', $2)`,
      [user.id, request.ip]
    );

    return reply.send(csv);
  });

  // ─── GET /api/export/news-coverages/csv ──────
  fastify.get('/news-coverages/csv', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.currentUser!;
    const { start_date, end_date, media_agency_id } = request.query as any;

    if (user.role !== 'SUPER_ADMIN' && user.role !== 'EDITOR' && user.role !== 'MEDIA') {
      return reply.status(403).send({ error: 'Akses ditolak' });
    }

    const params: any[] = [];
    let paramIndex = 1;

    let query = `
      SELECT 
        nc.title,
        nc.news_url,
        nc.publish_date,
        ma.name as media_agency_name,
        ma.website_url as media_website_url,
        u.full_name as uploaded_by_name
      FROM news_coverages nc
      JOIN media_agencies ma ON ma.id = nc.media_agency_id
      LEFT JOIN users u ON u.id = nc.uploaded_by
      WHERE 1=1
    `;

    if (start_date) {
      query += ` AND nc.publish_date >= $${paramIndex++}`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND nc.publish_date <= $${paramIndex++}`;
      params.push(end_date);
    }
    
    // Filter Media
    if (user.role === 'MEDIA') {
      query += ` AND nc.media_agency_id = $${paramIndex++}`;
      params.push(user.media_agency_id);
    } else if (media_agency_id) {
      query += ` AND nc.media_agency_id = $${paramIndex++}`;
      params.push(media_agency_id);
    }

    query += ` ORDER BY nc.publish_date DESC NULLS LAST, nc.created_at DESC`;

    const { rows } = await fastify.db.query(query, params);

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', `attachment; filename="news_coverages_${new Date().toISOString().split('T')[0]}.csv"`);

    // Header CSV
    let csv = 'Judul Berita,Tanggal Publish,Nama Media,Jumlah Lampiran\n';

    // Helper escape CSV
    const escapeCsv = (str: string | null | undefined | number) => {
      if (str === null || str === undefined || str === '') return '-';
      const strVal = String(str);
      if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
        return `"${strVal.replace(/"/g, '""')}"`;
      }
      return strVal;
    };

    // Body CSV
    for (const row of rows) {
      const dateStr = row.publish_date ? new Date(row.publish_date).toISOString().split('T')[0] : '-';
      const agencyNameTitleCase = row.media_agency_name ? row.media_agency_name.replace(/\b\w/g, (l: string) => l.toUpperCase()) : "";
      const mediaNameWithUrl = row.media_website_url ? row.media_website_url.replace(/^https?:\/\//, '') : agencyNameTitleCase;
      const fileCount = Array.isArray(row.files) ? row.files.length : (row.files ? (typeof row.files === 'string' ? JSON.parse(row.files).length : 1) : 0);
      csv += `${escapeCsv(row.title)},${escapeCsv(dateStr)},${escapeCsv(mediaNameWithUrl)},${fileCount}\n`;
    }

    // Log audit
    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, ip_address)
       VALUES ($1, 'EXPORT', 'news_coverages_summary_csv', $2)`,
      [user.id, request.ip]
    );

    return reply.send(csv);
  });
}

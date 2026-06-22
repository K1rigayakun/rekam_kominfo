import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import PDFDocument from 'pdfkit';

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
    doc.pipe(reply.raw);

    // Header
    doc.fontSize(20).text('Laporan Audit Log REKAM', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Dicetak oleh: ${user.email}`, { align: 'center' });
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
    return reply;
  });

  // ─── GET /api/export/audit/csv ─────────────
  fastify.get('/audit/csv', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.currentUser!;

    if (user.role !== 'SUPER_ADMIN') {
      return reply.status(403).send({ error: 'Hanya SUPER_ADMIN yang dapat mengunduh laporan audit' });
    }

    const { rows: logs } = await fastify.db.query(
      `SELECT al.*, u.full_name as user_name, u.email as user_email
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ORDER BY al.created_at DESC
       LIMIT 5000`
    );

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="REKAM_Audit_Report.csv"');

    // Header CSV
    let csv = 'Waktu,Pengguna,Email,Aksi,Entitas,ID Entitas,IP Address\n';

    // Body CSV
    for (const log of logs) {
      const timeStr = new Date(log.created_at).toISOString();
      const userStr = log.user_name ? `"${log.user_name.replace(/"/g, '""')}"` : '"System"';
      const emailStr = log.user_email ? `"${log.user_email}"` : '""';
      const actionStr = `"${log.action}"`;
      const entityStr = `"${log.entity_type || ''}"`;
      const entityIdStr = `"${log.entity_id || ''}"`;
      const ipStr = `"${log.ip_address || ''}"`;

      csv += `${timeStr},${userStr},${emailStr},${actionStr},${entityStr},${entityIdStr},${ipStr}\n`;
    }

    return reply.send(csv);
  });
}

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import archiver from 'archiver';
import PDFDocument from 'pdfkit';

export async function exportRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

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

    const activity = activities[0];
    const safeTitle = activity.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const dateStr = activity.event_date ? new Date(activity.event_date).toISOString().split('T')[0] : 'undated';
    const zipFilename = `REKAM_${safeTitle}_${dateStr}.zip`;

    // Ambil semua media (dengan info section)
    const { rows: mediaList } = await fastify.db.query(
      `SELECT mf.id, mf.original_filename, mf.storage_key_raw, mf.storage_key_processed, es.title as section_title
       FROM media_files mf
       LEFT JOIN event_sections es ON es.id = mf.section_id
       WHERE mf.activity_id = $1
       ORDER BY es.sort_order, mf.sort_order`,
      [id]
    );

    if (mediaList.length === 0) {
      return reply.status(400).send({ error: 'Tidak ada media untuk diexport' });
    }

    // Set headers untuk ZIP
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${zipFilename}"`);

    // Inisialisasi Archiver
    // @ts-ignore
    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(reply.raw);

    // Proses stream tiap file dari MinIO
    for (const media of mediaList) {
      const bucket = fastify.minioBuckets.raw;
      const key = media.storage_key_raw;
      
      if (!key) continue;

      try {
        const stream = await fastify.minio.getObject(bucket, key);
        const folderName = media.section_title ? media.section_title.replace(/[^a-z0-9]/gi, '_') : 'Lainnya';
        archive.append(stream, { name: `${folderName}/${media.original_filename}` });
      } catch (err) {
        fastify.log.error(`Gagal stream file untuk export: ${key}`);
      }
    }

    // Log export
    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
       VALUES ($1, 'DOWNLOAD', 'activity_export_zip', $2, $3)`,
      [user.id, id, request.ip]
    );

    await archive.finalize();
    return reply;
  });

  // ─── GET /api/export/activity/:id/pdf ──────
  fastify.get('/activity/:id/pdf', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const user = request.currentUser!;

    // Cek apakah activity ada
    const { rows: activities } = await fastify.db.query(
      `SELECT a.title, a.event_date, a.location, a.description, u.full_name as created_by_name, d.name as district_name
       FROM activities a
       LEFT JOIN users u ON u.id = a.created_by
       LEFT JOIN districts d ON d.id = a.district_id
       WHERE a.id = $1`,
      [id]
    );

    if (activities.length === 0) {
      return reply.status(404).send({ error: 'Acara tidak ditemukan' });
    }

    const activity = activities[0];
    const safeTitle = activity.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const dateStr = activity.event_date ? new Date(activity.event_date).toISOString().split('T')[0] : 'undated';
    const pdfFilename = `REKAM_${safeTitle}_${dateStr}.pdf`;

    // Ambil semua media (dengan info section)
    const { rows: mediaList } = await fastify.db.query(
      `SELECT mf.original_filename, mf.media_type, mf.storage_key_thumbnail, es.title as section_title
       FROM media_files mf
       LEFT JOIN event_sections es ON es.id = mf.section_id
       WHERE mf.activity_id = $1
       ORDER BY es.sort_order, mf.sort_order`,
      [id]
    );

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${pdfFilename}"`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(reply.raw);

    // Header Instansi
    doc.fontSize(18).font('Helvetica-Bold').text('KEMENTERIAN KOMUNIKASI DAN INFORMATIKA', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('Repositori Elektronik Kegiatan & Arsip Media (REKAM)', { align: 'center' });
    doc.moveDown(2);

    // Judul Acara
    doc.fontSize(16).font('Helvetica-Bold').text(activity.title, { align: 'center' });
    doc.moveDown(1.5);

    // Metadata Acara
    doc.fontSize(12).font('Helvetica-Bold').text('Detail Acara');
    doc.font('Helvetica');
    doc.text(`Tanggal: ${activity.event_date ? new Date(activity.event_date).toLocaleDateString('id-ID') : '-'}`);
    doc.text(`Kecamatan: ${activity.district_name || '-'}`);
    doc.text(`Lokasi: ${activity.location || '-'}`);
    doc.text(`Dibuat oleh: ${activity.created_by_name || '-'}`);
    doc.moveDown();

    // Deskripsi
    if (activity.description) {
      doc.font('Helvetica-Bold').text('Deskripsi');
      doc.font('Helvetica').text(activity.description);
      doc.moveDown();
    }

    // Media List (Grid Thumbnail placeholder)
    doc.font('Helvetica-Bold').text('Daftar Media Dokumentasi');
    doc.moveDown(0.5);

    if (mediaList.length === 0) {
      doc.font('Helvetica').text('Tidak ada media yang diunggah untuk acara ini.');
    } else {
      let currentSection = '';
      
      const margin = 50;
      const thumbWidth = 150;
      const thumbHeight = 150;
      const spacing = 20;
      let startX = margin;
      let startY = doc.y + 10;
      let currentX = startX;
      let currentY = startY;

      for (const media of mediaList) {
        const sectionTitle = media.section_title || 'Lainnya';
        if (sectionTitle !== currentSection) {
          currentSection = sectionTitle;
          if (currentX !== startX) {
             currentY += thumbHeight + spacing;
             currentX = startX;
          }
          if (currentY > 700) { doc.addPage(); currentY = margin; }
          
          doc.moveDown(0.5);
          doc.fontSize(11).font('Helvetica-Bold').text(`[Seksi] ${currentSection}`, startX, currentY);
          currentY += 20;
          if (currentY > 700) { doc.addPage(); currentY = margin; }
        }

        try {
          if (media.storage_key_thumbnail) {
            const stream = await fastify.minio.getObject(fastify.minioBuckets.processed, media.storage_key_thumbnail);
            const chunks: any[] = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            
            // Draw thumbnail
            doc.image(buffer, currentX, currentY, { width: thumbWidth, height: thumbHeight, fit: [thumbWidth, thumbHeight], align: 'center', valign: 'center' });
            
            // Draw filename text below
            doc.fontSize(8).font('Helvetica').text(media.original_filename, currentX, currentY + thumbHeight + 5, { width: thumbWidth, align: 'center', lineBreak: false });
            
            currentX += thumbWidth + spacing;
            if (currentX + thumbWidth > doc.page.width - margin) {
              currentX = startX;
              currentY += thumbHeight + 30 + spacing; // 30 is for text
              if (currentY + thumbHeight > doc.page.height - margin) {
                doc.addPage();
                currentY = margin;
              }
            }
          } else {
            // Draw text placeholder if no thumb
            doc.fontSize(8).font('Helvetica').text(`[No Thumb] ${media.original_filename}`, currentX, currentY + (thumbHeight/2), { width: thumbWidth, align: 'center' });
            currentX += thumbWidth + spacing;
            if (currentX + thumbWidth > doc.page.width - margin) {
              currentX = startX;
              currentY += thumbHeight + 30 + spacing;
              if (currentY + thumbHeight > doc.page.height - margin) {
                doc.addPage();
                currentY = margin;
              }
            }
          }
        } catch (err) {
          console.error('Error fetching thumbnail for PDF:', err);
          // Fallback
          doc.fontSize(8).font('Helvetica').text(`[Error] ${media.original_filename}`, currentX, currentY + (thumbHeight/2), { width: thumbWidth, align: 'center' });
          currentX += thumbWidth + spacing;
        }
      }
    }

    // Log export
    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
       VALUES ($1, 'DOWNLOAD', 'activity_export_pdf', $2, $3)`,
      [user.id, id, request.ip]
    );

    doc.end();
    return reply;
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

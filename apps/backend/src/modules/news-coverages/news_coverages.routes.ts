import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash, randomUUID } from 'crypto';
import path from 'path';
import '@fastify/multipart';

export async function newsCoveragesRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ─── GET /api/news-coverages ──────────────────
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const mediaAgencyId = (request.query as any).media_agency_id;
    const search = (request.query as any).search;
    const dateFrom = (request.query as any).dateFrom;
    const dateTo = (request.query as any).dateTo;
    const user = request.currentUser!;

    let query = `
      SELECT nc.*, ma.name as media_agency_name, ma.website_url as media_website_url, u.full_name as uploaded_by_name
      FROM news_coverages nc
      JOIN media_agencies ma ON ma.id = nc.media_agency_id
      LEFT JOIN users u ON u.id = nc.uploaded_by
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;
    // Jika user adalah MEDIA, hanya tampilkan miliknya sendiri
    if (user.role === 'MEDIA') {
      if (!user.media_agency_id) {
        return reply.status(403).send({ error: 'Akun media tidak dikaitkan dengan instansi media' });
      }
      query += ` AND nc.media_agency_id = $${paramIndex++}`;
      params.push(user.media_agency_id);
    } else if (mediaAgencyId) {
      query += ` AND nc.media_agency_id = $${paramIndex++}`;
      params.push(mediaAgencyId);
    }

    if (search) {
      query += ` AND nc.title ILIKE $${paramIndex++}`;
      params.push(`%${search}%`);
    }

    if (dateFrom) {
      query += ` AND nc.publish_date >= $${paramIndex++}`;
      params.push(dateFrom);
    }

    if (dateTo) {
      query += ` AND nc.publish_date <= $${paramIndex++}`;
      params.push(dateTo);
    }

    query += ` ORDER BY nc.publish_date DESC, nc.created_at DESC`;

    const { rows } = await fastify.db.query(query, params);
    return reply.send({ data: rows });
  });

  // ─── POST /api/news-coverages/upload ──────────
  fastify.post('/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    const parts = request.parts();
    const uploadedFiles: any[] = [];
    const fields: any = {};

    for await (const part of parts) {
      if (part.type === 'file') {
        const fileBuffer = await part.toBuffer();
        if (fileBuffer.length > 0) {
          uploadedFiles.push({
            filename: part.filename,
            mimetype: part.mimetype,
            buffer: fileBuffer,
            ext: path.extname(part.filename).toLowerCase()
          });
        }
      } else {
        fields[part.fieldname] = part.value;
      }
    }

    if (uploadedFiles.length === 0) {
      return reply.status(400).send({ error: 'File wajib disertakan' });
    }

    const user = request.currentUser!;
    const title = fields.title;
    const publishDate = fields.publish_date;
    const newsUrl = fields.news_url;
    
    // Untuk admin bisa upload atas nama media lain, untuk media otomatis agency sendiri
    let mediaAgencyId = user.media_agency_id;
    if (user.role !== 'MEDIA') {
      mediaAgencyId = fields.media_agency_id;
    }

    if (!title || !publishDate || !mediaAgencyId) {
      return reply.status(400).send({ error: 'media_agency_id, title, dan publish_date wajib disertakan' });
    }

    // Validasi publish_date <= today
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const pDate = new Date(publishDate);
    if (pDate > today) {
      return reply.status(400).send({ error: 'Tanggal rilis tidak boleh di masa depan' });
    }

    const limitBytes = 50 * 1024 * 1024; // 50MB per file
    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

    const fileObjects: any[] = [];

    for (const f of uploadedFiles) {
      if (f.buffer.length > limitBytes) {
        return reply.status(413).send({ error: `File ${f.filename} melebihi batas ukuran 50MB` });
      }
      if (!allowedExts.includes(f.ext)) {
        return reply.status(400).send({ error: `Format file ${f.filename} tidak didukung` });
      }

      const storageKey = `media-portal/${mediaAgencyId}/${randomUUID()}${f.ext}`;
      await fastify.minio.putObject(fastify.minioBuckets.attach, storageKey, f.buffer, f.buffer.length, {
        'Content-Type': f.mimetype,
      });

      fileObjects.push({
        file_url: storageKey,
        file_type: f.mimetype,
        original_filename: f.filename,
        file_size_bytes: f.buffer.length
      });
    }

    const { rows } = await fastify.db.query(
      `INSERT INTO news_coverages 
       (media_agency_id, title, news_url, publish_date, files, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [mediaAgencyId, title, newsUrl || null, publishDate, JSON.stringify(fileObjects), user.id]
    );

    return reply.status(201).send({ data: rows[0] });
  });

  // ─── GET /api/news-coverages/:id/download ─────
  fastify.get(
    '/:id/download',
    async (request: FastifyRequest<{ Params: { id: string }, Querystring: { index?: string, download?: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const index = parseInt(request.query.index || '0', 10);
      const isDownload = request.query.download === '1';
      const user = request.currentUser!;

      const { rows } = await fastify.db.query(
        'SELECT * FROM news_coverages WHERE id = $1',
        [id]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Berita tidak ditemukan' });
      }

      const coverage = rows[0];
      
      // Akses: Admin bebas, Media hanya miliknya
      if (user.role === 'MEDIA' && coverage.media_agency_id !== user.media_agency_id) {
         return reply.status(403).send({ error: 'Akses ditolak' });
      }

      const files = coverage.files || [];
      const fileData = files[index];

      if (!fileData) {
         return reply.status(404).send({ error: 'File tidak ditemukan' });
      }

      const stream = await fastify.minio.getObject(fastify.minioBuckets.attach, fileData.file_url);

      reply.header('Content-Type', fileData.file_type);
      reply.header(
        'Content-Disposition',
        `${isDownload ? 'attachment' : 'inline'}; filename="${fileData.original_filename}"`
      );

      return reply.send(stream);
    }
  );

  // ─── PUT /api/news-coverages/:id ───────────
  fastify.put<{ Params: { id: string } }>(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const user = request.currentUser!;

      // 1. Cek kepemilikan
      const { rows: existRows } = await fastify.db.query(
        'SELECT files, media_agency_id FROM news_coverages WHERE id = $1',
        [id]
      );

      if (existRows.length === 0) {
        return reply.status(404).send({ error: 'Berita tidak ditemukan' });
      }

      if (user.role === 'MEDIA' && existRows[0].media_agency_id !== user.media_agency_id) {
        return reply.status(403).send({ error: 'Akses ditolak' });
      }

      // 2. Parse multipart
      const parts = request.parts();
      const fileObjects: Array<{ file_url: string; original_filename: string; file_type: string; file_size_bytes: number }> = [];
      const fields: any = {};

      for await (const part of parts) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          if (buffer.length > 0) {
            const ext = path.extname(part.filename);
            const fileName = `media/news-coverages/${Date.now()}-${randomUUID()}${ext}`;
            
            await fastify.minio.putObject(fastify.minioBuckets.attach, fileName, buffer, buffer.length, {
              'Content-Type': part.mimetype,
            });

            fileObjects.push({
              file_url: fileName,
              original_filename: part.filename,
              file_type: part.mimetype,
              file_size_bytes: buffer.length,
            });
          }
        } else {
          fields[part.fieldname] = part.value;
        }
      }

      const title = fields.title;
      const publishDate = fields.publish_date;
      const newsUrl = fields.news_url;
      const retainedFilesStr = fields.retained_files;

      if (!title || !publishDate) {
        return reply.status(400).send({ error: 'title dan publish_date wajib disertakan' });
      }

      let retainedFiles: any[] = [];
      if (retainedFilesStr) {
        try {
          retainedFiles = JSON.parse(retainedFilesStr);
        } catch (e) {
          // abaikan error parse
        }
      }

      let updateQuery = `
        UPDATE news_coverages
        SET title = $1, news_url = $2, publish_date = $3
      `;
      const updateParams: any[] = [title, newsUrl || null, publishDate];
      let paramIndex = 4;

      // Gabungkan file lama yang dipertahankan dengan file yang baru diupload
      const combinedFiles = [...retainedFiles, ...fileObjects];
      updateQuery += `, files = $${paramIndex++}`;
      updateParams.push(JSON.stringify(combinedFiles));

      // Hapus file lama dari MinIO yang tidak ada di retainedFiles
      const oldFiles = existRows[0].files || [];
      const retainedUrls = new Set(retainedFiles.map(f => f.file_url));
      for (const f of oldFiles) {
        if (!retainedUrls.has(f.file_url)) {
          try {
            await fastify.minio.removeObject(fastify.minioBuckets.attach, f.file_url);
          } catch (err) {
            fastify.log.warn(err, 'Gagal menghapus file lama dari MinIO saat edit');
          }
        }
      }

      updateQuery += ` WHERE id = $${paramIndex++} RETURNING *`;
      updateParams.push(id);

      const { rows } = await fastify.db.query(updateQuery, updateParams);

      return reply.send({ data: rows[0] });
    }
  );

  // ─── DELETE /api/news-coverages/:id ───────────
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const user = request.currentUser!;

      const { rows } = await fastify.db.query(
        'SELECT files, media_agency_id FROM news_coverages WHERE id = $1',
        [id]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Berita tidak ditemukan' });
      }

      // Akses: Admin bebas, Media hanya miliknya
      if (user.role === 'MEDIA' && rows[0].media_agency_id !== user.media_agency_id) {
         return reply.status(403).send({ error: 'Akses ditolak' });
      }

      const files = rows[0].files || [];
      for (const f of files) {
        try {
          await fastify.minio.removeObject(fastify.minioBuckets.attach, f.file_url);
        } catch (err) {
          fastify.log.warn(err, 'Gagal menghapus file bukti tayang dari MinIO');
        }
      }

      await fastify.db.query('DELETE FROM news_coverages WHERE id = $1', [id]);

      return reply.send({ message: 'Bukti tayang berhasil dihapus' });
    }
  );
}

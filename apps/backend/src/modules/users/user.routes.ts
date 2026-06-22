import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const createUserSchema = z.object({
  email: z.string().email('Email tidak valid'),
  password: z.string().min(8, 'Password minimal 8 karakter'),
  full_name: z.string().min(1, 'Nama lengkap wajib diisi'),
  role: z.enum(['EDITOR', 'SUPER_ADMIN']).default('EDITOR'),
  district_id: z.string().uuid().optional(),
});

const updateUserSchema = z.object({
  full_name: z.string().min(1).optional(),
  role: z.enum(['EDITOR', 'SUPER_ADMIN']).optional(),
  district_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
});

const changePasswordSchema = z.object({
  old_password: z.string().min(1, 'Password lama wajib diisi'),
  new_password: z.string().min(8, 'Password baru minimal 8 karakter'),
});

export async function userRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ─── GET /api/users ────────────────────────
  fastify.get(
    '/',
    { preHandler: [fastify.requireSuperAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { rows } = await fastify.db.query(
        `SELECT u.id, u.email, u.full_name, u.role, u.district_id, 
                d.name as district_name, u.is_active, u.last_login_at, u.created_at
         FROM users u
         LEFT JOIN districts d ON d.id = u.district_id
         ORDER BY u.created_at DESC`
      );

      return reply.send({ data: rows });
    }
  );

  // ─── POST /api/users ──────────────────────
  fastify.post(
    '/',
    { preHandler: [fastify.requireSuperAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = createUserSchema.parse(request.body);
      const user = request.currentUser!;

      // Cek email unik
      const { rows: existing } = await fastify.db.query(
        'SELECT id FROM users WHERE email = $1',
        [body.email]
      );

      if (existing.length > 0) {
        return reply.status(409).send({ error: 'Email sudah digunakan' });
      }

      const passwordHash = await bcrypt.hash(body.password, 12);

      const { rows } = await fastify.db.query(
        `INSERT INTO users (email, password_hash, full_name, role, district_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, full_name, role, district_id, is_active, created_at`,
        [body.email, passwordHash, body.full_name, body.role, body.district_id || null]
      );

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'CREATE', 'user', $2, $3, $4)`,
        [user.id, rows[0].id, JSON.stringify({ email: body.email, role: body.role }), request.ip]
      );

      return reply.status(201).send({ data: rows[0] });
    }
  );

  // ─── PUT /api/users/:id ───────────────────
  fastify.put<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.requireSuperAdmin] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const body = updateUserSchema.parse(request.body);
      const user = request.currentUser!;

      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;

      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined) {
          updates.push(`${key} = $${idx}`);
          values.push(value);
          idx++;
        }
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Tidak ada data yang diubah' });
      }

      values.push(id);
      const { rows } = await fastify.db.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}
         RETURNING id, email, full_name, role, district_id, is_active`,
        values
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'User tidak ditemukan' });
      }

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'UPDATE', 'user', $2, $3, $4)`,
        [user.id, id, JSON.stringify(body), request.ip]
      );

      return reply.send({ data: rows[0] });
    }
  );

  // ─── PUT /api/users/me/password ───────────
  // Endpoint ganti password sendiri (semua role)
  fastify.put('/me/password', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = changePasswordSchema.parse(request.body);
    const userId = request.currentUser!.id;

    // Ambil password hash saat ini
    const { rows: currentUser } = await fastify.db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (currentUser.length === 0) {
      return reply.status(404).send({ error: 'User tidak ditemukan' });
    }

    // Verifikasi password lama
    const isOldPasswordValid = await bcrypt.compare(body.old_password, currentUser[0].password_hash);
    if (!isOldPasswordValid) {
      return reply.status(400).send({ error: 'Password lama tidak cocok' });
    }

    // Hash password baru
    const newHash = await bcrypt.hash(body.new_password, 12);
    await fastify.db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);

    // Log audit
    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
       VALUES ($1, 'UPDATE', 'user', $2, $3)`,
      [userId, userId, request.ip]
    );

    return reply.send({ message: 'Password berhasil diubah' });
  });

  // ─── PUT /api/users/me ────────────────────
  // Endpoint ganti nama sendiri
  fastify.put('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const updateMeSchema = z.object({
      full_name: z.string().min(1, 'Nama lengkap wajib diisi'),
    });
    const body = updateMeSchema.parse(request.body);
    const userId = request.currentUser!.id;

    const { rowCount } = await fastify.db.query(
      'UPDATE users SET full_name = $1 WHERE id = $2',
      [body.full_name, userId]
    );

    if (rowCount === 0) {
      return reply.status(404).send({ error: 'User tidak ditemukan' });
    }

    const { rows } = await fastify.db.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.district_id, u.is_active,
              u.last_login_at, d.name as district_name,
              (SELECT MAX(created_at) FROM media_files WHERE uploaded_by = u.id) as last_upload_at
       FROM users u
       LEFT JOIN districts d ON d.id = u.district_id
       WHERE u.id = $1`,
      [userId]
    );

    // Log audit
    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, 'UPDATE', 'user_profile', $2, $3, $4)`,
      [userId, userId, JSON.stringify({ full_name: body.full_name }), request.ip]
    );

    return reply.send({ data: rows[0] });
  });

  // ─── PUT /api/users/:id/reset-password ────
  // Reset password oleh SUPER_ADMIN
  fastify.put<{ Params: { id: string } }>(
    '/:id/reset-password',
    { preHandler: [fastify.requireSuperAdmin] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const newPassword = (request.body as any)?.new_password;

      if (!newPassword || newPassword.length < 8) {
        return reply.status(400).send({ error: 'Password baru minimal 8 karakter' });
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);

      const { rows } = await fastify.db.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, email, full_name',
        [passwordHash, id]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'User tidak ditemukan' });
      }

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'UPDATE', 'user', $2, $3, $4)`,
        [request.currentUser!.id, id, JSON.stringify({ action: 'reset_password' }), request.ip]
      );

      return reply.send({ message: `Password untuk ${rows[0].email} berhasil direset` });
    }
  );
}

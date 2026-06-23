import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

// ─── Validation Schemas ──────────────────────
const loginSchema = z.object({
  username: z.string().min(1, 'Username wajib diisi'),
  password: z.string().min(1, 'Password wajib diisi'),
});

const updateProfileSchema = z.object({
  old_password: z.string().optional(),
  password: z.string().min(8, 'Password minimal 8 karakter').optional().or(z.literal('')),
  media_website_url: z.string().optional().or(z.literal('')),
  full_name: z.string().min(3, 'Nama minimal 3 karakter').optional(),
});

// Konstanta brute force
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 600; // 10 menit

async function incrementLoginAttempts(fastify: FastifyInstance, attemptsKey: string, lockoutKey: string) {
  const attempts = await fastify.redis.incr(attemptsKey);
  if (attempts === 1) await fastify.redis.expire(attemptsKey, LOCKOUT_DURATION_SECONDS);
  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    await fastify.redis.set(lockoutKey, '1', 'EX', LOCKOUT_DURATION_SECONDS);
    await fastify.redis.del(attemptsKey);
  }
}

export async function authRoutes(fastify: FastifyInstance) {
  // ─── POST /api/auth/login ──────────────────
  fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.parse(request.body);

    // ── Brute Force Protection ──
    const lockoutKey = `lockout:${body.username}`;
    const attemptsKey = `login_attempts:${body.username}`;

    const lockout = await fastify.redis.get(lockoutKey);
    if (lockout) {
      const ttl = await fastify.redis.ttl(lockoutKey);
      return reply.status(429).send({
        error: `Akun terkunci sementara. Coba lagi dalam ${Math.ceil(ttl / 60)} menit.`,
      });
    }

    // Cari user di database
    const { rows } = await fastify.db.query(
      `SELECT u.id, u.username, u.password_hash, u.full_name, u.role, u.district_id, u.media_agency_id, u.is_active,
              u.last_login_at, d.name as district_name,
              (SELECT MAX(created_at) FROM media_files WHERE uploaded_by = u.id) as last_upload_at
       FROM users u
       LEFT JOIN districts d ON d.id = u.district_id
       WHERE u.username = $1`,
      [body.username]
    );

    if (rows.length === 0) {
      await incrementLoginAttempts(fastify, attemptsKey, lockoutKey);
      return reply.status(401).send({ error: 'Username atau password salah' });
    }

    const user = rows[0];

    if (!user.is_active) {
      return reply.status(403).send({ error: 'Akun dinonaktifkan. Hubungi administrator.' });
    }

    // Verifikasi password
    const passwordValid = await bcrypt.compare(body.password, user.password_hash);
    if (!passwordValid) {
      await incrementLoginAttempts(fastify, attemptsKey, lockoutKey);
      return reply.status(401).send({ error: 'Username atau password salah' });
    }

    // Login sukses → reset counter attempts
    await fastify.redis.del(attemptsKey);

    // Generate tokens
    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      district_id: user.district_id,
      media_agency_id: user.media_agency_id,
    };

    const accessToken = fastify.jwt.sign(payload, {
      expiresIn: Number(process.env.JWT_ACCESS_TTL) || 900, // 15 menit
    });

    const refreshToken = fastify.jwt.sign(
      { id: user.id, type: 'refresh' },
      {
        expiresIn: Number(process.env.JWT_REFRESH_TTL) || 604800, // 7 hari
      }
    );

    // Simpan refresh token ke Redis
    const refreshTTL = Number(process.env.JWT_REFRESH_TTL) || 604800;
    await fastify.redis.set(`refresh:${user.id}`, refreshToken, 'EX', refreshTTL);

    // Update last_login_at
    const { rows: loginRows } = await fastify.db.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1 RETURNING last_login_at',
      [user.id]
    );
    user.last_login_at = loginRows[0]?.last_login_at;

    // Log audit
    await fastify.db.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
       VALUES ($1, 'LOGIN', 'user', $2, $3)`,
      [user.id, user.id, request.ip]
    );

    // Set refresh token sebagai HttpOnly cookie
    reply.setCookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: refreshTTL,
    });

    return reply.send({
      access_token: accessToken,
      token: accessToken, // backward compatibility dengan frontend
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        district_id: user.district_id,
        district_name: user.district_name,
        media_agency_id: user.media_agency_id,
        last_login_at: user.last_login_at,
        last_upload_at: user.last_upload_at,
      },
    });
  });

  // ─── POST /api/auth/refresh ────────────────
  fastify.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    // Ambil refresh token dari cookie atau body
    const refreshTokenFromCookie = (request.cookies as any)?.refresh_token;
    const refreshTokenFromBody = (request.body as any)?.refresh_token;
    const refreshToken = refreshTokenFromCookie || refreshTokenFromBody;

    if (!refreshToken) {
      return reply.status(401).send({ error: 'Refresh token tidak ditemukan' });
    }

    try {
      const decoded = fastify.jwt.verify<{ id: string; type: string }>(refreshToken);

      if (decoded.type !== 'refresh') {
        return reply.status(401).send({ error: 'Token tidak valid' });
      }

      // Cek di Redis
      const storedToken = await fastify.redis.get(`refresh:${decoded.id}`);
      if (storedToken !== refreshToken) {
        return reply.status(401).send({ error: 'Refresh token sudah kedaluwarsa atau dicabut' });
      }

      // Ambil data user terbaru
      const { rows } = await fastify.db.query(
        'SELECT id, username, role, district_id, media_agency_id, is_active FROM users WHERE id = $1',
        [decoded.id]
      );

      if (rows.length === 0 || !rows[0].is_active) {
        return reply.status(401).send({ error: 'User tidak ditemukan atau dinonaktifkan' });
      }

      const user = rows[0];
      const payload = {
        id: user.id,
        username: user.username,
        role: user.role,
        district_id: user.district_id,
        media_agency_id: user.media_agency_id,
      };

      const newAccessToken = fastify.jwt.sign(payload, {
        expiresIn: Number(process.env.JWT_ACCESS_TTL) || 900,
      });

      return reply.send({ access_token: newAccessToken });
    } catch {
      return reply.status(401).send({ error: 'Refresh token tidak valid' });
    }
  });

  // ─── POST /api/auth/logout ─────────────────
  fastify.post(
    '/logout',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.currentUser!.id;

      // Hapus refresh token dari Redis
      await fastify.redis.del(`refresh:${userId}`);

      // Hapus cookie
      reply.clearCookie('refresh_token', { path: '/api/auth' });

      // Log audit
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
         VALUES ($1, 'LOGOUT', 'user', $2, $3)`,
        [userId, userId, request.ip]
      );

      return reply.send({ message: 'Logout berhasil' });
    }
  );

  // ─── GET /api/auth/me ────────────────────
  fastify.get(
    '/me',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { rows } = await fastify.db.query(
        `SELECT u.id, u.username, u.full_name, u.role, u.district_id, u.media_agency_id, d.name as district_name, u.last_login_at,
          ma.name as media_agency_name, ma.media_type, ma.website_url as media_website_url,
          (SELECT MAX(created_at) FROM media_files WHERE uploaded_by = u.id) as last_upload_at
         FROM users u
         LEFT JOIN districts d ON d.id = u.district_id
         LEFT JOIN media_agencies ma ON ma.id = u.media_agency_id
         WHERE u.id = $1`,
        [request.currentUser!.id]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'User tidak ditemukan' });
      }

      return reply.send({ user: rows[0] });
    }
  );

  // ─── PUT /api/auth/update-profile ────────
  fastify.put(
    '/update-profile',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = updateProfileSchema.parse(request.body);
      const user = request.currentUser!;

      try {
        await fastify.db.query('BEGIN');

        if (body.password) {
          if (!body.old_password) {
            return reply.status(400).send({ error: 'Password lama wajib diisi untuk mengubah password' });
          }
          
          const { rows: currentUser } = await fastify.db.query(
            'SELECT password_hash FROM users WHERE id = $1',
            [user.id]
          );
          
          const isOldPasswordValid = await bcrypt.compare(body.old_password, currentUser[0].password_hash);
          if (!isOldPasswordValid) {
            return reply.status(400).send({ error: 'Password lama tidak cocok' });
          }

          const passwordHash = await bcrypt.hash(body.password, 12);
          await fastify.db.query(
            'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [passwordHash, user.id]
          );
        }

        if (body.full_name) {
          await fastify.db.query(
            'UPDATE users SET full_name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [body.full_name, user.id]
          );
        }

        if (user.role === 'MEDIA' && user.media_agency_id && body.media_website_url !== undefined) {
          const url = body.media_website_url || null;
          await fastify.db.query(
            'UPDATE media_agencies SET website_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [url, user.media_agency_id]
          );
        }

        await fastify.db.query('COMMIT');
        return reply.send({ message: 'Profil berhasil diperbarui' });
      } catch (err) {
        await fastify.db.query('ROLLBACK');
        throw err;
      }
    }
  );
}

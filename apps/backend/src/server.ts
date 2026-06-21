import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';

// Plugins
import { dbPlugin } from './plugins/db';
import { redisPlugin } from './plugins/redis';
import { minioPlugin } from './plugins/minio';
import { authPlugin } from './plugins/auth';
import queuePlugin from './plugins/queue';

// Modules (routes)
import { authRoutes } from './modules/auth/auth.routes';
import { activityRoutes } from './modules/activities/activity.routes';
import { versionRoutes } from './modules/activities/version.routes';
import { sectionRoutes } from './modules/sections/section.routes';
import { mediaRoutes } from './modules/media/media.routes';
import { tusRoutes } from './modules/media/tus.routes';
import { attachmentRoutes } from './modules/attachments/attachment.routes';
import { sharingRoutes } from './modules/sharing/sharing.routes';
import { publicRoutes } from './modules/public/public.routes';
import { auditRoutes } from './modules/audit/audit.routes';
import { userRoutes } from './modules/users/user.routes';
import { teamRoutes } from './modules/teams/team.routes';
import { districtRoutes } from './modules/districts/district.routes';
import { exportRoutes } from './modules/export/export.routes';
import { personRoutes } from './modules/persons/person.routes';

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} wajib diisi`);
  }
  return value;
}

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

const configuredPublicOrigins = (process.env.PUBLIC_BASE_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function isPrivateNetworkHost(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function isAllowedOrigin(origin?: string) {
  if (!origin) return true;
  if (configuredPublicOrigins.includes(origin)) return true;

  if (process.env.NODE_ENV === 'development') {
    try {
      const url = new URL(origin);
      const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
      const isFrontendPort = ['5173', '5174', '5175', '4173'].includes(url.port);
      return isHttp && isFrontendPort && isPrivateNetworkHost(url.hostname);
    } catch {
      return false;
    }
  }

  return false;
}

async function main() {
  // ─── CORS ──────────────────────────────────
  await server.register(cors, {
    origin: (origin, callback) => {
      callback(null, isAllowedOrigin(origin));
    },
    credentials: true,
  });

  // ─── Rate Limiting ─────────────────────────
  await server.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_PUBLIC_MAX) || 200,
    timeWindow: Number(process.env.RATE_LIMIT_PUBLIC_WINDOW_MS) || 3600000,
  });

  // ─── Cookie ────────────────────────────────
  await server.register(cookie);

  // ─── JWT ───────────────────────────────────
  await server.register(jwt, {
    secret: requireEnv('JWT_ACCESS_SECRET'),
  });

  // ─── Multipart ─────────────────────────────
  await server.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024 * 1024, // 10 GB
    },
  });

  // ─── Infrastructure Plugins ────────────────
  await server.register(dbPlugin);
  await server.register(redisPlugin);
  await server.register(minioPlugin);
  await server.register(authPlugin);
  await server.register(queuePlugin);

  // ─── Health Check ──────────────────────────
  server.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // ─── API Routes ────────────────────────────
  await server.register(authRoutes, { prefix: '/api/auth' });
  await server.register(userRoutes, { prefix: '/api/users' });
  await server.register(teamRoutes, { prefix: '/api/teams' });
  await server.register(districtRoutes, { prefix: '/api/districts' });
  await server.register(activityRoutes, { prefix: '/api/activities' });
  await server.register(versionRoutes, { prefix: '/api/activities' });
  await server.register(sectionRoutes, { prefix: '/api/activities' });
  await server.register(tusRoutes); // TUS routes handle specific /api/upload/tus endpoints
  await server.register(mediaRoutes, { prefix: '/api/media' });
  await server.register(attachmentRoutes, { prefix: '/api/attachments' });
  await server.register(sharingRoutes, { prefix: '/api/sharing' });
  await server.register(publicRoutes, { prefix: '/p' });
  await server.register(auditRoutes, { prefix: '/api/audit' });
  await server.register(exportRoutes, { prefix: '/api/export' });
  await server.register(personRoutes, { prefix: '/api/persons' });

  // ─── Start Server ─────────────────────────
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';

  try {
    await server.listen({ port, host });
    server.log.info(`Fastify listening on http://${host}:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

// Extend FastifyRequest untuk menambah user info
declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: {
      id: string;
      email: string;
      role: string;
      district_id: string | null;
    };
  }
}

async function authPluginCallback(fastify: FastifyInstance) {
  // Decorator: verifikasi JWT dan attach user ke request
  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        const decoded = await request.jwtVerify<{
          id: string;
          email: string;
          role: string;
          district_id: string | null;
        }>();
        request.currentUser = decoded;
      } catch (err) {
        reply.status(401).send({ error: 'Token tidak valid atau sudah kedaluwarsa' });
      }
    }
  );

  // Decorator: cek apakah user adalah SUPER_ADMIN
  fastify.decorate(
    'requireSuperAdmin',
    async function (request: FastifyRequest, reply: FastifyReply) {
      if (!request.currentUser) {
        return reply.status(401).send({ error: 'Belum login' });
      }
      if (request.currentUser.role !== 'SUPER_ADMIN') {
        return reply.status(403).send({ error: 'Akses ditolak: hanya SUPER_ADMIN' });
      }
    }
  );

  // Decorator: cek apakah user adalah EDITOR atau lebih tinggi
  fastify.decorate(
    'requireEditor',
    async function (request: FastifyRequest, reply: FastifyReply) {
      if (!request.currentUser) {
        return reply.status(401).send({ error: 'Belum login' });
      }
      if (!['SUPER_ADMIN', 'EDITOR'].includes(request.currentUser.role)) {
        return reply.status(403).send({ error: 'Akses ditolak: hanya EDITOR atau lebih tinggi' });
      }
    }
  );
}

// Extend FastifyInstance agar decorator bisa dikenali TypeScript
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireSuperAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireEditor: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(authPluginCallback, {
  name: 'auth-plugin',
  dependencies: ['db-plugin'],
});

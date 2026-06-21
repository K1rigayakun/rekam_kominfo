import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import Redis from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

async function redisPluginCallback(fastify: FastifyInstance) {
  if (!process.env.REDIS_URL) {
    throw new Error('Environment variable REDIS_URL wajib diisi');
  }

  const redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null, // diperlukan oleh BullMQ
    enableReadyCheck: true,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    fastify.log.info('[redis] Redis connected');
    redis.on('error', (err: any) => {
      fastify.log.error(err, '[redis] Redis connection failed:');
    });
  } catch (err: any) {
    fastify.log.error(err, '[redis] Redis connection failed:');
    throw err;
  }

  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    await redis.quit();
    fastify.log.info('[redis] Redis connection closed');
  });
}

export const redisPlugin = fp(redisPluginCallback, {
  name: 'redis-plugin',
});

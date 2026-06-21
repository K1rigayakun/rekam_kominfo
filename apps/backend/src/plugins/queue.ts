import fp from 'fastify-plugin';
import { Queue } from 'bullmq';
import { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    mediaQueue: Queue;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  if (!fastify.redis) {
    throw new Error('Redis plugin must be registered before queue plugin');
  }

  const mediaQueue = new Queue('media-processing', {
    connection: fastify.redis.duplicate() as any,
  });

  fastify.decorate('mediaQueue', mediaQueue);

  fastify.addHook('onClose', async (instance) => {
    await instance.mediaQueue.close();
  });
});

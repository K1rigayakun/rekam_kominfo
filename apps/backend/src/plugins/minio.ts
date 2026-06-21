import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import * as Minio from 'minio';

declare module 'fastify' {
  interface FastifyInstance {
    minio: Minio.Client;
    minioBuckets: {
      raw: string;
      processed: string;
      attach: string;
      exports: string;
    };
  }
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} wajib diisi`);
  }
  return value;
}

async function minioPluginCallback(fastify: FastifyInstance) {
  const client = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: Number(process.env.MINIO_PORT) || 9000,
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: requireEnv('MINIO_ACCESS_KEY'),
    secretKey: requireEnv('MINIO_SECRET_KEY'),
  });

  const buckets = {
    raw: process.env.MINIO_BUCKET_RAW || 'rekam-raw',
    processed: process.env.MINIO_BUCKET_PROCESSED || 'rekam-processed',
    attach: process.env.MINIO_BUCKET_ATTACH || 'rekam-attach',
    exports: process.env.MINIO_BUCKET_EXPORTS || 'rekam-exports',
  };

  // Pastikan semua bucket ada (auto-create jika belum ada)
  for (const [key, bucketName] of Object.entries(buckets)) {
    try {
      const exists = await client.bucketExists(bucketName);
      if (!exists) {
        await client.makeBucket(bucketName);
        fastify.log.info(`[minio] Bucket '${bucketName}' created`);
      }
    } catch (err: any) {
      fastify.log.warn(`[minio] Could not check/create bucket '${bucketName}':`, err);
    }
  }

  fastify.log.info('[minio] MinIO connected');
  fastify.decorate('minio', client);
  fastify.decorate('minioBuckets', buckets);
}

export const minioPlugin = fp(minioPluginCallback, {
  name: 'minio-plugin',
});

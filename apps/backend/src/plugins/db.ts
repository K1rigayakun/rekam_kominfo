import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Pool, PoolClient } from 'pg';

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
  }
}

async function dbPluginCallback(fastify: FastifyInstance) {
  if (!process.env.DATABASE_URL) {
    throw new Error('Environment variable DATABASE_URL wajib diisi');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Test koneksi
  try {
    const client = await pool.connect();
    fastify.log.info('[db] PostgreSQL connected');
    client.release();
  } catch (err: any) {
    fastify.log.error(err, '[db] PostgreSQL connection failed:');
    throw err;
  }

  fastify.decorate('db', pool);

  fastify.addHook('onClose', async () => {
    await pool.end();
    fastify.log.info('[db] PostgreSQL pool closed');
  });
}

export const dbPlugin = fp(dbPluginCallback, {
  name: 'db-plugin',
});

// ─── Helper: Transaction wrapper ──────────
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Database Reset — Hapus semua data, jalankan ulang migration + seed.
 * PERINGATAN: Ini akan menghapus SEMUA data di database!
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { execSync } from 'child_process';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function reset() {
  if (process.env.NODE_ENV === 'production') {
    console.error('DITOLAK: Tidak bisa reset database di mode production!');
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    console.log('Menghapus semua tabel...');

    // Drop semua tabel di public schema
    await client.query(`
      DO $$ 
      DECLARE 
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);

    // Drop semua custom types
    await client.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT typname FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typtype = 'e') LOOP
          EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.typname) || ' CASCADE';
        END LOOP;
      END $$;
    `);

    console.log('Semua tabel dan types dihapus.');
  } finally {
    client.release();
    await pool.end();
  }

  // Jalankan migration ulang
  console.log('\nMenjalankan migration...');
  execSync('npx tsx src/migrations/run.ts', { stdio: 'inherit' });

  // Jalankan seed ulang
  console.log('\nMenjalankan seed...');
  execSync('npx tsx src/seeds/seed.ts', { stdio: 'inherit' });

  console.log('\nDatabase reset selesai!');
}

reset().catch((err) => {
  console.error('Reset gagal:', err);
  process.exit(1);
});

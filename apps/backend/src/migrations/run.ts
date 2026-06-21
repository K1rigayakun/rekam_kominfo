/**
 * Migration Runner — Menjalankan semua file .sql di folder migrations secara berurutan.
 * Menggunakan tabel `_migrations` untuk mencatat migration yang sudah dijalankan.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function run() {
  const client = await pool.connect();

  try {
    // Buat tabel migration tracker jika belum ada
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Baca semua file .sql di folder migrations, urut nama
    const migrationsDir = path.join(__dirname);
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // Ambil daftar migration yang sudah dijalankan
    const { rows: applied } = await client.query('SELECT name FROM _migrations');
    const appliedNames = new Set(applied.map((r) => r.name));

    for (const file of files) {
      if (appliedNames.has(file)) {
        console.log(`  [skip] ${file} (sudah diterapkan)`);
        continue;
      }

      console.log(`  [run]  ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  [ok]   ${file} berhasil diterapkan`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  [FAIL] ${file}:`, err);
        throw err;
      }
    }

    console.log('\nSemua migration selesai.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration gagal:', err);
  process.exit(1);
});

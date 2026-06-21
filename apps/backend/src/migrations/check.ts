/**
 * Database Check — Verifikasi semua tabel sudah terbuat dengan benar.
 */
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const EXPECTED_TABLES = [
  'districts',
  'teams',
  'team_members',
  'users',
  'activities',
  'event_sections',
  'media_files',
  'event_attachments',
  'persons',
  'media_person_tags',
  'sharing_snapshots',
  'sharing_snapshot_items',
  'qr_scan_logs',
  'audit_logs',
  'export_jobs',
  'activity_versions',
];

async function check() {
  const client = await pool.connect();

  try {
    const { rows } = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const existingTables = new Set(rows.map((r) => r.table_name));

    console.log('Verifikasi tabel database:\n');

    let allOk = true;
    for (const table of EXPECTED_TABLES) {
      if (existingTables.has(table)) {
        console.log(`  [OK]   ${table}`);
      } else {
        console.log(`  [MISS] ${table} — BELUM ADA!`);
        allOk = false;
      }
    }

    console.log('');
    if (allOk) {
      console.log('Semua tabel sudah terbuat dengan benar!');
    } else {
      console.log('Ada tabel yang belum terbuat. Jalankan: npm run db:migrate');
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

check().catch((err) => {
  console.error('Check gagal:', err);
  process.exit(1);
});

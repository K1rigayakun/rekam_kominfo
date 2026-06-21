/**
 * Database Seed — Membuat data awal: Grup + SUPER_ADMIN pertama.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ─── 1. Buat Kecamatan ──────────
    const districts = [
      { name: 'Kecamatan Medan Baru' },
      { name: 'Kecamatan Medan Sunggal' },
      { name: 'Kecamatan Medan Kota' },
    ];

    const districtIds: Record<string, string> = {};
    for (const d of districts) {
      const res = await client.query(
        `INSERT INTO districts (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [d.name]
      );
      districtIds[d.name] = res.rows[0].id;
      console.log(`  Kecamatan dibuat: ${d.name}`);
    }

    // ─── 2. Buat Tim Liputan ──────────
    const teams = [
      { name: 'Tim Peliput VIP', description: 'Fokus meliput acara-acara utama pemerintahan' },
      { name: 'Tim Peliput Lapangan', description: 'Fokus kegiatan masyarakat' },
    ];

    const teamIds: Record<string, string> = {};
    for (const t of teams) {
      const res = await client.query(
        `INSERT INTO teams (name, description) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description RETURNING id`,
        [t.name, t.description]
      );
      teamIds[t.name] = res.rows[0].id;
      console.log(`  Tim Liputan dibuat: ${t.name}`);
    }

    // ─── 3. Buat User & Super Admin ───────────────
    const usersData = [
      { email: 'admin@rekam.local', name: 'Super Administrator', role: 'SUPER_ADMIN', district: 'Kecamatan Medan Baru' },
      { email: 'budi@rekam.local', name: 'Budi Santoso', role: 'EDITOR', district: 'Kecamatan Medan Baru' },
      { email: 'siti@rekam.local', name: 'Siti Aminah', role: 'EDITOR', district: 'Kecamatan Medan Sunggal' },
    ];

    const userIds: Record<string, string> = {};
    const defaultPassword = 'Admin123!';
    const passwordHash = await bcrypt.hash(defaultPassword, 12);

    for (const u of usersData) {
      const dId = districtIds[u.district];
      const res = await client.query(
        `INSERT INTO users (email, password_hash, full_name, role, district_id) 
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role RETURNING id`,
        [u.email, passwordHash, u.name, u.role, dId]
      );
      userIds[u.email] = res.rows[0].id;
      console.log(`  User dibuat: ${u.email}`);
    }

    // ─── 4. Buat Anggota Tim (Junction) ───────────────
    // Budi ada di VIP dan Lapangan. Siti ada di Lapangan.
    const memberships = [
      { user: 'budi@rekam.local', team: 'Tim Peliput VIP' },
      { user: 'budi@rekam.local', team: 'Tim Peliput Lapangan' },
      { user: 'siti@rekam.local', team: 'Tim Peliput Lapangan' },
      { user: 'admin@rekam.local', team: 'Tim Peliput VIP' },
    ];

    for (const m of memberships) {
      const uId = userIds[m.user];
      const tId = teamIds[m.team];
      await client.query(
        `INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)
         ON CONFLICT (team_id, user_id) DO NOTHING`,
        [tId, uId]
      );
    }
    console.log(`  Anggota tim dipetakan.`);

    await client.query('COMMIT');
    console.log('\nSeed selesai.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed gagal:', err);
  process.exit(1);
});

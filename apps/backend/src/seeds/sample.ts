/**
 * Sample seed untuk demo dashboard/detail tanpa membuat media palsu.
 * Jalankan setelah `npm run db:seed` agar SUPER_ADMIN awal sudah tersedia.
 */
import 'dotenv/config';
import { Pool, PoolClient } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function findOrCreateDistrict(client: PoolClient, name: string) {
  const existing = await client.query('SELECT id FROM districts WHERE name = $1', [name]);
  if (existing.rows[0]) return existing.rows[0].id as string;

  const created = await client.query(
    'INSERT INTO districts (name) VALUES ($1) RETURNING id',
    [name]
  );
  return created.rows[0].id as string;
}

async function findOrCreateTeam(client: PoolClient, name: string, description: string) {
  const existing = await client.query('SELECT id FROM teams WHERE name = $1', [name]);
  if (existing.rows[0]) return existing.rows[0].id as string;

  const created = await client.query(
    'INSERT INTO teams (name, description) VALUES ($1, $2) RETURNING id',
    [name, description]
  );
  return created.rows[0].id as string;
}

async function findOrCreateTag(client: PoolClient, name: string, createdBy: string) {
  const existing = await client.query('SELECT id FROM tags WHERE name = $1 ORDER BY created_at ASC LIMIT 1', [name]);
  if (existing.rows[0]) return existing.rows[0].id as string;

  const created = await client.query(
    'INSERT INTO tags (name, created_by) VALUES ($1, $2) RETURNING id',
    [name, createdBy]
  );
  return created.rows[0].id as string;
}

async function findAdmin(client: PoolClient) {
  const { rows } = await client.query(
    "SELECT id FROM users WHERE role = 'SUPER_ADMIN' ORDER BY created_at ASC LIMIT 1"
  );

  if (!rows[0]) {
    throw new Error('SUPER_ADMIN belum ada. Jalankan `npm run db:seed` sebelum `npm run db:seed:sample`.');
  }

  return rows[0].id as string;
}

async function findOrCreateActivity(client: PoolClient, input: {
  title: string;
  eventDate: string;
  location: string;
  districtId: string;
  teamId: string;
  tagId: string;
  createdBy: string;
}) {
  const existing = await client.query(
    'SELECT id FROM activities WHERE title = $1 AND event_date = $2 LIMIT 1',
    [input.title, input.eventDate]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;

  const descriptionJson = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Contoh acara untuk verifikasi dashboard, QR sharing, export, dan pengelolaan seksi.' },
        ],
      },
    ],
  };

  const created = await client.query(
    `INSERT INTO activities
      (title, description, description_json, event_date, location, use_sections, district_id, team_id, tag_id, created_by)
     VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9)
     RETURNING id`,
    [
      input.title,
      'Contoh acara untuk demo REKAM.',
      JSON.stringify(descriptionJson),
      input.eventDate,
      input.location,
      input.districtId,
      input.teamId,
      input.tagId,
      input.createdBy,
    ]
  );

  await client.query(
    `INSERT INTO activity_versions (activity_id, version_number, snapshot_data, created_by)
     SELECT id, 1, to_jsonb(activities), $2
     FROM activities
     WHERE id = $1`,
    [created.rows[0].id, input.createdBy]
  );

  return created.rows[0].id as string;
}

async function ensureSections(client: PoolClient, activityId: string, createdBy: string) {
  const sections = ['Pembukaan', 'Kegiatan Lapangan', 'Penutup'];

  for (const [index, title] of sections.entries()) {
    const existing = await client.query(
      'SELECT id FROM event_sections WHERE activity_id = $1 AND title = $2 LIMIT 1',
      [activityId, title]
    );

    if (!existing.rows[0]) {
      await client.query(
        `INSERT INTO event_sections (activity_id, title, description_json, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          activityId,
          title,
          JSON.stringify({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: `Dokumentasi tahap ${title.toLowerCase()}.` }] }],
          }),
          index,
          createdBy,
        ]
      );
    }
  }
}

async function seedSample() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const adminId = await findAdmin(client);
    const districtId = await findOrCreateDistrict(client, 'Kecamatan Medan Baru');
    const teamId = await findOrCreateTeam(client, 'Tim Dokumentasi Digital', 'Tim sample untuk demo fitur REKAM.');
    const tagId = await findOrCreateTag(client, 'Demo Rilis', adminId);

    await client.query(
      `INSERT INTO team_members (team_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (team_id, user_id) DO NOTHING`,
      [teamId, adminId]
    );

    const activityId = await findOrCreateActivity(client, {
      title: 'Demo Rilis REKAM',
      eventDate: new Date().toISOString().slice(0, 10),
      location: 'Kantor Dinas Kominfo',
      districtId,
      teamId,
      tagId,
      createdBy: adminId,
    });

    await ensureSections(client, activityId, adminId);

    await client.query('COMMIT');
    console.log('Sample seed selesai. Activity demo siap dipakai.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedSample().catch((error) => {
  console.error('Sample seed gagal:', error);
  process.exit(1);
});

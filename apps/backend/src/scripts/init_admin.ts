import { pool } from '../config/database';
import bcrypt from 'bcryptjs';

async function initAdmin() {
  console.log('⏳ Membuat akun Super Admin pertama...');

  const client = await pool.connect();
  try {
    const checkAdmin = await client.query(`SELECT id FROM users WHERE username = 'admin'`);
    if (checkAdmin.rowCount && checkAdmin.rowCount > 0) {
      console.log('✅ Super Admin (admin) sudah ada di database.');
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash('P@ssw0rdAdmin!', 10);
    
    await client.query(`
      INSERT INTO users (username, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4)
    `, ['admin', passwordHash, 'Super Admin', 'SUPER_ADMIN']);

    console.log('🎉 Berhasil membuat Super Admin pertama!');
    console.log('=============================================');
    console.log('👤 Username : admin');
    console.log('🔑 Password : P@ssw0rdAdmin!');
    console.log('=============================================');
    console.log('⚠️ HARAP SEGERA GANTI PASSWORD INI SETELAH LOGIN!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Gagal membuat admin:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

initAdmin();

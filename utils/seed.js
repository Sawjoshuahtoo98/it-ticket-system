// src/utils/seed.js
// Run: node src/utils/seed.js
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'helpdesk',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const schema = fs.readFileSync(
  path.join(process.cwd(), 'database.sql'), 'utf8'
);

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running schema...');
    await client.query(schema);

    console.log('🌱 Seeding users...');
    const users = [
      { name: 'System Admin',    email: 'admin@company.com',    password: 'Admin@123',  role: 'admin',       dept: 'IT' },
      { name: 'John Technician', email: 'tech@company.com',     password: 'Tech@123',   role: 'technician',  dept: 'IT Support' },
      { name: 'Jane Employee',   email: 'employee@company.com', password: 'User@123',   role: 'user',        dept: 'Finance' },
    ];

    for (const u of users) {
      const hash = await bcrypt.hash(u.password, 12);
      await client.query(
        `INSERT INTO users (name, email, password_hash, role, department)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (email) DO NOTHING`,
        [u.name, u.email, hash, u.role, u.dept]
      );
      console.log(`  ✓ ${u.role.padEnd(12)} ${u.email}  /  ${u.password}`);
    }

    console.log('\n✅ Database ready!\n');
    console.log('Default logins:');
    console.log('  admin@company.com    / Admin@123');
    console.log('  tech@company.com     / Tech@123');
    console.log('  employee@company.com / User@123\n');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();

cat > config/database.js << 'EOF'
// config/database.js
import pg from 'pg';
import { logger } from './utils/logger.js';

const { Pool } = pg;

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'helpdesk',
  user:     process.env.DB_USER     || 'sawjoshuahtoo',
  password: process.env.DB_PASSWORD || '',
  min:      parseInt(process.env.DB_POOL_MIN || '2'),
  max:      parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis:       30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => console.error('Unexpected DB pool error:', err));

export const query = (text, params) => pool.query(text, params);

export const withTransaction = async (fn) => {
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
};

export const testConnection = async () => {
  try {
    const res = await query('SELECT NOW() AS now');
    console.log(`✅ Database connected at ${res.rows[0].now}`);
    logger.info(`✅ Database connected at ${res.rows[0].now}`);
  } catch (err) {
    console.error('❌ Database connection failed:', err);
    process.exit(1);
  }
};

export default pool;
EOF
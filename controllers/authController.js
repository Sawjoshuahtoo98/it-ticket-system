// src/controllers/authController.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../config/database.js';
import { generateTokens } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validationResult } from 'express-validator';

const storeRefresh = async (userId, token) => {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const exp  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
    [userId, hash, exp]
  );
};

// POST /auth/register
export const register = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { name, email, password, department, phone } = req.body;
  const hash = await bcrypt.hash(password, 12);

  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, department, phone)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, name, email, role, department`,
    [name, email, hash, department || null, phone || null]
  );

  const user = rows[0];
  const tokens = generateTokens(user.id, user.role);
  await storeRefresh(user.id, tokens.refreshToken);

  res.status(201).json({ user, ...tokens });
});

// POST /auth/login
export const login = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { email, password } = req.body;

  const { rows } = await query(
    'SELECT * FROM users WHERE email=$1 AND is_active=TRUE',
    [email]
  );
  if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

  const user = rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  await query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [user.id]);

  const tokens = generateTokens(user.id, user.role);
  await storeRefresh(user.id, tokens.refreshToken);

  const { password_hash, ...safe } = user;
  res.json({ user: safe, ...tokens });
});

// POST /auth/refresh
export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ error: 'Refresh token required' });

  let payload;
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const { rows } = await query(
    'SELECT * FROM refresh_tokens WHERE token_hash=$1 AND expires_at > NOW()',
    [hash]
  );
  if (!rows.length) return res.status(401).json({ error: 'Token revoked or expired' });

  // Rotate — delete old, issue new
  await query('DELETE FROM refresh_tokens WHERE token_hash=$1', [hash]);

  const userRes = await query('SELECT role FROM users WHERE id=$1 AND is_active=TRUE', [payload.sub]);
  if (!userRes.rows.length) return res.status(401).json({ error: 'User not found' });

  const tokens = generateTokens(payload.sub, userRes.rows[0].role);
  await storeRefresh(payload.sub, tokens.refreshToken);

  res.json(tokens);
});

// POST /auth/logout
export const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await query('DELETE FROM refresh_tokens WHERE token_hash=$1', [hash]);
  }
  res.json({ message: 'Logged out successfully' });
});

// GET /auth/me
export const me = asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT id, name, email, role, department, phone, avatar_url, last_login_at, created_at FROM users WHERE id=$1',
    [req.user.id]
  );
  res.json(rows[0]);
});

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../config/database.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validationResult } from 'express-validator';

// ── Create refresh token hash ─────────────────────
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// ── REGISTER ─────────────────────────────────────
export const register = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }

  const { name, email, password, department, phone } = req.body;

  // hash password (IMPORTANT)
  const passwordHash = await bcrypt.hash(password, 12);

  const result = await query(
    `INSERT INTO users (name, email, password_hash, department, phone)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, name, email, role`,
    [name, email, passwordHash, department || null, phone || null]
  );

  const user = result.rows[0];

  const accessToken = jwt.sign(
    { sub: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const refreshToken = jwt.sign(
    { sub: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1,$2, NOW() + INTERVAL '7 days')`,
    [user.id, hashToken(refreshToken)]
  );

  res.status(201).json({
    user,
    accessToken,
    refreshToken
  });
});

// ── LOGIN ─────────────────────────────────────
export const login = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  const result = await query(
    `SELECT * FROM users WHERE email=$1 AND is_active=TRUE`,
    [email]
  );

  const user = result.rows[0];

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);

  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  await query(
    `UPDATE users SET last_login_at=NOW() WHERE id=$1`,
    [user.id]
  );

  const accessToken = jwt.sign(
    { sub: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const refreshToken = jwt.sign(
    { sub: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1,$2, NOW() + INTERVAL '7 days')`,
    [user.id, hashToken(refreshToken)]
  );

  const { password_hash, ...safeUser } = user;

  res.json({
    user: safeUser,
    accessToken,
    refreshToken
  });
});

// ── REFRESH TOKEN ─────────────────────────────
export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token required' });
  }

  let payload;

  try {
    payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  const tokenHash = hashToken(refreshToken);

  const result = await query(
    `SELECT * FROM refresh_tokens
     WHERE token_hash=$1 AND expires_at > NOW()`,
    [tokenHash]
  );

  if (!result.rows.length) {
    return res.status(401).json({ error: 'Token expired or revoked' });
  }

  await query(`DELETE FROM refresh_tokens WHERE token_hash=$1`, [tokenHash]);

  const userRes = await query(
    `SELECT id, role FROM users WHERE id=$1 AND is_active=TRUE`,
    [payload.sub]
  );

  if (!userRes.rows.length) {
    return res.status(401).json({ error: 'User not found' });
  }

  const user = userRes.rows[0];

  const newAccessToken = jwt.sign(
    { sub: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const newRefreshToken = jwt.sign(
    { sub: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1,$2, NOW() + INTERVAL '7 days')`,
    [user.id, hashToken(newRefreshToken)]
  );

  res.json({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken
  });
});

// ── LOGOUT ─────────────────────────────────────
export const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    await query(
      `DELETE FROM refresh_tokens WHERE token_hash=$1`,
      [hashToken(refreshToken)]
    );
  }

  res.json({ message: 'Logged out' });
});

// ── ME ─────────────────────────────────────
export const me = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, name, email, role, department, phone, avatar_url, last_login_at, created_at
     FROM users WHERE id=$1`,
    [req.user.id]
  );

  res.json(result.rows[0]);
});

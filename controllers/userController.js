// src/controllers/userController.js
import bcrypt from 'bcryptjs';
import { query } from '../config/database.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validationResult } from 'express-validator';

// GET /users
export const listUsers = asyncHandler(async (req, res) => {
  const { role, search, page = 1, limit = 20 } = req.query;
  const conds = []; const params = []; let idx = 1;

  if (role)   { conds.push(`role=$${idx++}`);                          params.push(role); }
  if (search) { conds.push(`(name ILIKE $${idx} OR email ILIKE $${idx++})`); params.push(`%${search}%`); }

  const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const offset = (parseInt(page) - 1) * parseInt(limit);
  params.push(parseInt(limit), offset);

  const [count, data] = await Promise.all([
    query(`SELECT COUNT(*) FROM users ${where}`, params.slice(0, -2)),
    query(`
      SELECT id, name, email, role, department, phone, avatar_url, is_active, last_login_at, created_at
      FROM users ${where} ORDER BY created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, params),
  ]);

  res.json({
    data: data.rows,
    pagination: {
      total: parseInt(count.rows[0].count),
      page:  parseInt(page),
      limit: parseInt(limit),
    },
  });
});

// GET /users/technicians
export const listTechnicians = asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT u.id, u.name, u.email, u.avatar_url,
      (SELECT COUNT(*) FROM tickets t
       WHERE t.assigned_to=u.id AND t.status NOT IN ('resolved','closed')
      ) AS open_tickets
    FROM users u
    WHERE u.role IN ('admin','technician') AND u.is_active=TRUE
    ORDER BY u.name
  `);
  res.json(rows);
});

// GET /users/:id
export const getUser = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, email, role, department, phone, avatar_url, is_active, last_login_at, created_at
     FROM users WHERE id=$1`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

// PUT /users/:id
export const updateUser = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { id } = req.params;
  if (req.user.role !== 'admin' && req.user.id !== id)
    return res.status(403).json({ error: 'Access denied' });

  const { name, department, phone, avatarUrl, role, isActive } = req.body;
  const sets = []; const params = []; let idx = 1;

  if (name !== undefined)       { sets.push(`name=$${idx++}`);       params.push(name); }
  if (department !== undefined) { sets.push(`department=$${idx++}`); params.push(department); }
  if (phone !== undefined)      { sets.push(`phone=$${idx++}`);      params.push(phone); }
  if (avatarUrl !== undefined)  { sets.push(`avatar_url=$${idx++}`); params.push(avatarUrl); }

  if (req.user.role === 'admin') {
    if (role !== undefined)     { sets.push(`role=$${idx++}`);      params.push(role); }
    if (isActive !== undefined) { sets.push(`is_active=$${idx++}`); params.push(isActive); }
  }

  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(id);
  const { rows } = await query(
    `UPDATE users SET ${sets.join(',')} WHERE id=$${idx}
     RETURNING id, name, email, role, department, phone, avatar_url, is_active`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

// PUT /users/:id/password
export const changePassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (req.user.id !== id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Access denied' });

  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8)
    return res.status(422).json({ error: 'New password must be at least 8 characters' });

  const { rows } = await query('SELECT password_hash FROM users WHERE id=$1', [id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found' });

  if (req.user.role !== 'admin') {
    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, id]);
  await query('DELETE FROM refresh_tokens WHERE user_id=$1', [id]);

  res.json({ message: 'Password changed. Please log in again.' });
});

// ── Notifications ─────────────────────────────────────────────

// GET /notifications
export const getNotifications = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT n.*, t.ticket_number
     FROM notifications n
     LEFT JOIN tickets t ON n.ticket_id=t.id
     WHERE n.user_id=$1
     ORDER BY n.created_at DESC LIMIT 50`,
    [req.user.id]
  );
  const unread = rows.filter(r => !r.is_read).length;
  res.json({ notifications: rows, unread });
});

// PUT /notifications/:id/read
export const markNotificationRead = asyncHandler(async (req, res) => {
  await query(
    'UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2',
    [req.params.id, req.user.id]
  );
  res.json({ message: 'Marked as read' });
});

// PUT /notifications/read-all
export const markAllRead = asyncHandler(async (req, res) => {
  await query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1', [req.user.id]);
  res.json({ message: 'All notifications marked as read' });
});

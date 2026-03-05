// src/controllers/commentController.js
import { query } from '../config/database.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { sendEmail, createNotification } from '../services/emailService.js';
import { validationResult } from 'express-validator';

const pad = (n) => String(n).padStart(4, '0');

// POST /tickets/:id/comments
export const addComment = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { id: ticketId } = req.params;
  const { body, isInternal = false } = req.body;

  const internal = req.user.role === 'user' ? false : Boolean(isInternal);

  const ticketRes = await query('SELECT * FROM tickets WHERE id=$1', [ticketId]);
  if (!ticketRes.rows.length) return res.status(404).json({ error: 'Ticket not found' });

  const ticket = ticketRes.rows[0];
  if (req.user.role === 'user' && ticket.created_by !== req.user.id)
    return res.status(403).json({ error: 'Access denied' });

  const { rows } = await query(
    `INSERT INTO comments (ticket_id, author_id, body, is_internal)
     VALUES ($1,$2,$3,$4)
     RETURNING id, ticket_id, body, is_internal, created_at, updated_at`,
    [ticketId, req.user.id, body, internal]
  );
  const comment = rows[0];

  const authorRes = await query(
    'SELECT id, name, role, avatar_url FROM users WHERE id=$1', [req.user.id]
  );
  comment.author = authorRes.rows[0];

  // Notify creator if staff commented
  if (!internal && req.user.role !== 'user' && ticket.created_by !== req.user.id) {
    const creatorRes = await query('SELECT name, email FROM users WHERE id=$1', [ticket.created_by]);
    if (creatorRes.rows.length) {
      const c = creatorRes.rows[0];
      sendEmail(c.email, 'comment_added', {
        userName: c.name, authorName: req.user.name,
        comment:  body.substring(0, 300),
        ticketNumber: ticket.ticket_number, ticketId, title: ticket.title,
      }, ticketId);
      createNotification(ticket.created_by, ticketId, 'comment_added',
        `New comment on TKT-${pad(ticket.ticket_number)}`, req.user.name);
    }
  }

  // Notify assignee if user commented
  if (req.user.role === 'user' && ticket.assigned_to) {
    createNotification(ticket.assigned_to, ticketId, 'comment_added',
      `User replied on TKT-${pad(ticket.ticket_number)}`, req.user.name);
  }

  res.status(201).json(comment);
});

// PUT /tickets/:id/comments/:commentId
export const updateComment = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { commentId } = req.params;
  const { rows } = await query('SELECT * FROM comments WHERE id=$1', [commentId]);
  if (!rows.length) return res.status(404).json({ error: 'Comment not found' });
  if (rows[0].author_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Cannot edit another user\'s comment' });

  const { rows: updated } = await query(
    'UPDATE comments SET body=$1 WHERE id=$2 RETURNING *', [req.body.body, commentId]
  );
  res.json(updated[0]);
});

// DELETE /tickets/:id/comments/:commentId
export const deleteComment = asyncHandler(async (req, res) => {
  const { commentId } = req.params;
  const { rows } = await query('SELECT * FROM comments WHERE id=$1', [commentId]);
  if (!rows.length) return res.status(404).json({ error: 'Comment not found' });
  if (rows[0].author_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Cannot delete another user\'s comment' });

  await query('DELETE FROM comments WHERE id=$1', [commentId]);
  res.json({ message: 'Comment deleted' });
});

// src/controllers/ticketController.js
import { query } from '../config/database.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { sendEmail, createNotification } from '../services/emailService.js';
import { validationResult } from 'express-validator';

const pad = (n) => String(n).padStart(4, '0');

// GET /tickets
export const listTickets = asyncHandler(async (req, res) => {
  const { status, priority, category, assignedTo, search,
          page = 1, limit = 20, sortBy = 'created_at', sortDir = 'DESC' } = req.query;

  const params = [];
  const conds  = [];
  let idx = 1;

  if (req.user.role === 'user') {
    conds.push(`t.created_by=$${idx++}`);
    params.push(req.user.id);
  }
  if (status)     { conds.push(`t.status=$${idx++}`);      params.push(status); }
  if (priority)   { conds.push(`t.priority=$${idx++}`);    params.push(priority); }
  if (category)   { conds.push(`t.category=$${idx++}`);    params.push(category); }
  if (assignedTo) { conds.push(`t.assigned_to=$${idx++}`); params.push(assignedTo); }
  if (search)     {
    conds.push(`t.search_vector @@ plainto_tsquery('english',$${idx++})`);
    params.push(search);
  }

  const where   = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const safeSort = ['created_at','updated_at','priority','status','ticket_number'].includes(sortBy) ? sortBy : 'created_at';
  const safeDir  = sortDir === 'ASC' ? 'ASC' : 'DESC';
  const offset   = (parseInt(page) - 1) * parseInt(limit);

  const [countRes, dataRes] = await Promise.all([
    query(`SELECT COUNT(*) FROM tickets t ${where}`, params),
    query(`
      SELECT t.id, t.ticket_number, t.title, t.status, t.priority, t.category,
             t.created_at, t.updated_at, t.due_date, t.sla_breached,
             json_build_object('id',uc.id,'name',uc.name,'email',uc.email) AS created_by,
             CASE WHEN t.assigned_to IS NOT NULL
               THEN json_build_object('id',ua.id,'name',ua.name,'email',ua.email)
               ELSE NULL END AS assigned_to,
             (SELECT COUNT(*) FROM comments c WHERE c.ticket_id=t.id) AS comment_count
      FROM tickets t
      JOIN users uc ON t.created_by=uc.id
      LEFT JOIN users ua ON t.assigned_to=ua.id
      ${where}
      ORDER BY t.${safeSort} ${safeDir}
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, parseInt(limit), offset]),
  ]);

  res.json({
    data: dataRes.rows,
    pagination: {
      total: parseInt(countRes.rows[0].count),
      page:  parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(parseInt(countRes.rows[0].count) / parseInt(limit)),
    },
  });
});

// POST /tickets
export const createTicket = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { title, description, priority = 'medium', category = 'other', dueDate } = req.body;

  const { rows } = await query(
    `INSERT INTO tickets (title, description, priority, category, created_by, due_date)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [title, description, priority, category, req.user.id, dueDate || null]
  );
  const ticket = rows[0];

  await query(
    `INSERT INTO ticket_history (ticket_id, changed_by, field_name, new_value)
     VALUES ($1,$2,'status','open')`,
    [ticket.id, req.user.id]
  );

  // Email confirmation (fire-and-forget)
  sendEmail(req.user.email, 'ticket_created', {
    userName: req.user.name, ticketNumber: ticket.ticket_number,
    ticketId: ticket.id,     title: ticket.title, category: ticket.category,
    priority: ticket.priority,
  }, ticket.id);

  res.status(201).json(ticket);
});

// GET /tickets/stats
export const getStats = asyncHandler(async (req, res) => {
  const isUser = req.user.role === 'user';
  const cond   = isUser ? `WHERE created_by='${req.user.id}'` : '';
  const andCond= isUser ? `AND created_by='${req.user.id}'`   : '';

  const [overview, byPriority, byCategory, trend, recentActivity] = await Promise.all([
    query(`
      SELECT
        COUNT(*) FILTER (WHERE status='open')        AS open_count,
        COUNT(*) FILTER (WHERE status='in_progress') AS in_progress_count,
        COUNT(*) FILTER (WHERE status='resolved')    AS resolved_count,
        COUNT(*) FILTER (WHERE status='closed')      AS closed_count,
        COUNT(*) FILTER (WHERE priority='critical')  AS critical_count,
        COUNT(*) FILTER (WHERE sla_breached=TRUE)    AS sla_breached_count,
        COUNT(*)                                      AS total_count
      FROM tickets ${cond}
    `),
    query(`SELECT priority, COUNT(*) AS count FROM tickets ${cond} GROUP BY priority ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END`),
    query(`SELECT category, COUNT(*) AS count FROM tickets ${cond} GROUP BY category ORDER BY count DESC`),
    query(`
      SELECT DATE_TRUNC('day',created_at)::date AS day,
             COUNT(*) AS created,
             COUNT(*) FILTER (WHERE status='resolved') AS resolved
      FROM tickets
      WHERE created_at >= NOW() - INTERVAL '30 days' ${andCond}
      GROUP BY day ORDER BY day
    `),
    query(`
      SELECT t.id, t.ticket_number, t.title, t.status, t.priority, t.updated_at,
             u.name AS updated_by_name
      FROM tickets t
      JOIN users u ON t.created_by=u.id
      ORDER BY t.updated_at DESC LIMIT 5
    `),
  ]);

  res.json({
    overview:       overview.rows[0],
    byPriority:     byPriority.rows,
    byCategory:     byCategory.rows,
    trend:          trend.rows,
    recentActivity: recentActivity.rows,
  });
});

// GET /tickets/:id
export const getTicket = asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT t.*,
           json_build_object('id',uc.id,'name',uc.name,'email',uc.email,'department',uc.department) AS created_by,
           CASE WHEN t.assigned_to IS NOT NULL
             THEN json_build_object('id',ua.id,'name',ua.name,'email',ua.email)
             ELSE NULL END AS assigned_to
    FROM tickets t
    JOIN users uc ON t.created_by=uc.id
    LEFT JOIN users ua ON t.assigned_to=ua.id
    WHERE t.id=$1
  `, [req.params.id]);

  if (!rows.length) return res.status(404).json({ error: 'Ticket not found' });
  const ticket = rows[0];

  if (req.user.role === 'user' && ticket.created_by.id !== req.user.id)
    return res.status(403).json({ error: 'Access denied' });

  const showInternal = req.user.role !== 'user';

  const [commentsRes, attachRes, historyRes] = await Promise.all([
    query(`
      SELECT c.id, c.body, c.is_internal, c.created_at, c.updated_at,
             json_build_object('id',u.id,'name',u.name,'role',u.role,'avatar_url',u.avatar_url) AS author
      FROM comments c
      JOIN users u ON c.author_id=u.id
      WHERE c.ticket_id=$1 ${showInternal ? '' : 'AND c.is_internal=FALSE'}
      ORDER BY c.created_at ASC
    `, [req.params.id]),
    query(`
      SELECT a.id, a.filename, a.file_url, a.file_size, a.mime_type, a.created_at,
             json_build_object('id',u.id,'name',u.name) AS uploaded_by
      FROM ticket_attachments a
      JOIN users u ON a.uploaded_by=u.id
      WHERE a.ticket_id=$1 ORDER BY a.created_at DESC
    `, [req.params.id]),
    query(`
      SELECT h.id, h.field_name, h.old_value, h.new_value, h.changed_at,
             json_build_object('id',u.id,'name',u.name) AS changed_by
      FROM ticket_history h
      JOIN users u ON h.changed_by=u.id
      WHERE h.ticket_id=$1 ORDER BY h.changed_at ASC
    `, [req.params.id]),
  ]);

  res.json({
    ...ticket,
    comments:    commentsRes.rows,
    attachments: attachRes.rows,
    history:     historyRes.rows,
  });
});

// PATCH /tickets/:id
export const updateTicket = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { id } = req.params;
  const cur = await query('SELECT * FROM tickets WHERE id=$1', [id]);
  if (!cur.rows.length) return res.status(404).json({ error: 'Ticket not found' });

  const ticket = cur.rows[0];
  const isOwner = ticket.created_by === req.user.id;
  const isStaff = ['admin','technician'].includes(req.user.role);
  if (!isOwner && !isStaff) return res.status(403).json({ error: 'Access denied' });

  const { title, description, priority, category, status, assignedTo, dueDate } = req.body;

  const sets = []; const params = []; let idx = 1;
  const changed = [];

  const add = (col, val) => {
    if (val !== undefined && val !== ticket[col]) {
      sets.push(`${col}=$${idx++}`);
      params.push(val);
      changed.push({ field: col, old: ticket[col], new: val });
    }
  };

  if (req.user.role === 'user') {
    if (ticket.status !== 'open')
      return res.status(403).json({ error: 'Cannot edit a ticket that is not open' });
    add('title', title);
    add('description', description);
  } else {
    add('title', title);
    add('description', description);
    add('priority', priority);
    add('category', category);
    add('status', status);
    add('assigned_to', assignedTo);
    add('due_date', dueDate);
    if (status === 'resolved' && ticket.status !== 'resolved') sets.push('resolved_at=NOW()');
    if (status === 'closed'   && ticket.status !== 'closed')   sets.push('closed_at=NOW()');
  }

  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(id);
  const { rows } = await query(
    `UPDATE tickets SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, params
  );

  // History log
  await Promise.all(changed.map(c =>
    query(
      `INSERT INTO ticket_history (ticket_id, changed_by, field_name, old_value, new_value)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, req.user.id, c.field, String(c.old ?? ''), String(c.new ?? '')]
    )
  ));

  const updated = rows[0];

  // Notifications + emails (fire-and-forget)
  const creatorRes = await query('SELECT name, email FROM users WHERE id=$1', [ticket.created_by]);
  const creator    = creatorRes.rows[0];

  if (creator) {
    const wasAssigned = changed.find(c => c.field === 'assigned_to');
    if (wasAssigned && assignedTo) {
      const techRes = await query('SELECT name FROM users WHERE id=$1', [assignedTo]);
      if (techRes.rows.length) {
        sendEmail(creator.email, 'ticket_assigned', {
          userName: creator.name, techName: techRes.rows[0].name,
          ticketNumber: ticket.ticket_number, ticketId: id, title: ticket.title,
        }, id);
        createNotification(ticket.created_by, id, 'ticket_assigned',
          `TKT-${pad(ticket.ticket_number)} assigned to ${techRes.rows[0].name}`);
      }
    }

    const wasResolved = changed.find(c => c.field === 'status' && c.new === 'resolved');
    if (wasResolved) {
      sendEmail(creator.email, 'ticket_resolved', {
        userName: creator.name, techName: req.user.name,
        ticketNumber: ticket.ticket_number, ticketId: id, title: ticket.title,
      }, id);
      createNotification(ticket.created_by, id, 'ticket_resolved',
        `TKT-${pad(ticket.ticket_number)} has been resolved`);
    }

    const wasStatusChanged = changed.find(c => c.field === 'status');
    if (wasStatusChanged && !wasResolved) {
      sendEmail(creator.email, 'ticket_status_changed', {
        userName: creator.name, ticketNumber: ticket.ticket_number,
        ticketId: id, title: ticket.title,
        oldStatus: wasStatusChanged.old, newStatus: wasStatusChanged.new,
      }, id);
    }
  }

  res.json(updated);
});

// DELETE /tickets/:id  (admin only)
export const deleteTicket = asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM tickets WHERE id=$1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Ticket not found' });
  res.json({ message: 'Ticket deleted' });
});

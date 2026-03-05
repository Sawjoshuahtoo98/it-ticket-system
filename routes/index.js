// src/routes/index.js
import express from 'express';
import { body }    from 'express-validator';
import rateLimit   from 'express-rate-limit';
import multer      from 'multer';
import path        from 'path';
import fs          from 'fs';
import { v4 as uuid } from 'uuid';

import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler }            from '../middleware/errorHandler.js';
import { query }                   from '../config/database.js';

import * as auth     from '../controllers/authController.js';
import * as tickets  from '../controllers/ticketController.js';
import * as comments from '../controllers/commentController.js';
import * as users    from '../controllers/userController.js';

const router = express.Router();

// ── Multer upload ─────────────────────────────────────────────
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.UPLOAD_MAX_SIZE || '10485760') },
  fileFilter: (req, file, cb) => {
    const allowed = (process.env.ALLOWED_MIME_TYPES || 'image/jpeg,image/png,application/pdf').split(',');
    cb(null, allowed.includes(file.mimetype));
  },
});

// ── Rate limiters ─────────────────────────────────────────────
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// ── Validators ────────────────────────────────────────────────
const v = {
  register: [
    body('name').trim().notEmpty().withMessage('Name required').isLength({ max: 100 }),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password min 8 chars')
      .matches(/[A-Z]/).withMessage('Password needs uppercase')
      .matches(/\d/).withMessage('Password needs a number'),
  ],
  login: [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  createTicket: [
    body('title').trim().notEmpty().withMessage('Title required').isLength({ max: 255 }),
    body('description').trim().notEmpty().withMessage('Description required'),
    body('priority').optional().isIn(['low','medium','high','critical']),
    body('category').optional().isIn(['hardware','software','network','access','email','printer','other']),
    body('dueDate').optional().isISO8601(),
  ],
  updateTicket: [
    body('title').optional().trim().notEmpty().isLength({ max: 255 }),
    body('priority').optional().isIn(['low','medium','high','critical']),
    body('category').optional().isIn(['hardware','software','network','access','email','printer','other']),
    body('status').optional().isIn(['open','in_progress','pending','resolved','closed']),
    body('dueDate').optional().isISO8601(),
  ],
  comment: [
    body('body').trim().notEmpty().withMessage('Comment body required').isLength({ max: 5000 }),
    body('isInternal').optional().isBoolean(),
  ],
};

// ═══════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════
router.get('/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' })
);

// ═══════════════════════════════════════════════════════════════
// AUTH
// POST /auth/register
// POST /auth/login
// POST /auth/refresh
// POST /auth/logout
// GET  /auth/me
// ═══════════════════════════════════════════════════════════════
router.post('/auth/register', v.register, auth.register);
router.post('/auth/login',    loginLimit, v.login, auth.login);
router.post('/auth/refresh',  auth.refresh);
router.post('/auth/logout',   auth.logout);
router.get('/auth/me',        authenticate, auth.me);

// ═══════════════════════════════════════════════════════════════
// TICKETS
// GET    /tickets            list (role-filtered, paginated)
// POST   /tickets            create
// GET    /tickets/stats      dashboard stats
// GET    /tickets/:id        detail + comments + history
// PATCH  /tickets/:id        update
// DELETE /tickets/:id        admin only
// POST   /tickets/:id/attachments  upload file
// ═══════════════════════════════════════════════════════════════
router.get('/tickets/stats',  authenticate, tickets.getStats);
router.get('/tickets',        authenticate, tickets.listTickets);
router.post('/tickets',       authenticate, v.createTicket, tickets.createTicket);
router.get('/tickets/:id',    authenticate, tickets.getTicket);
router.patch('/tickets/:id',  authenticate, v.updateTicket, tickets.updateTicket);
router.delete('/tickets/:id', authenticate, authorize('admin'), tickets.deleteTicket);

router.post('/tickets/:id/attachments', authenticate, upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded or file type not allowed' });
    const { rows } = await query(
      `INSERT INTO ticket_attachments (ticket_id, uploaded_by, filename, file_url, file_size, mime_type)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, req.user.id, req.file.originalname,
       `/uploads/${req.file.filename}`, req.file.size, req.file.mimetype]
    );
    res.status(201).json(rows[0]);
  })
);

// ═══════════════════════════════════════════════════════════════
// COMMENTS
// POST   /tickets/:id/comments
// PUT    /tickets/:id/comments/:commentId
// DELETE /tickets/:id/comments/:commentId
// ═══════════════════════════════════════════════════════════════
router.post('/tickets/:id/comments',              authenticate, v.comment, comments.addComment);
router.put('/tickets/:id/comments/:commentId',    authenticate, v.comment, comments.updateComment);
router.delete('/tickets/:id/comments/:commentId', authenticate, comments.deleteComment);

// ═══════════════════════════════════════════════════════════════
// USERS
// GET  /users                admin only
// GET  /users/technicians    staff
// GET  /users/:id
// PUT  /users/:id
// PUT  /users/:id/password
// ═══════════════════════════════════════════════════════════════
router.get('/users',               authenticate, authorize('admin'), users.listUsers);
router.get('/users/technicians',   authenticate, authorize('admin','technician'), users.listTechnicians);
router.get('/users/:id',           authenticate, users.getUser);
router.put('/users/:id',           authenticate, users.updateUser);
router.put('/users/:id/password',  authenticate, users.changePassword);

// ═══════════════════════════════════════════════════════════════
// NOTIFICATIONS
// GET /notifications
// PUT /notifications/read-all
// PUT /notifications/:id/read
// ═══════════════════════════════════════════════════════════════
router.get('/notifications',           authenticate, users.getNotifications);
router.put('/notifications/read-all',  authenticate, users.markAllRead);
router.put('/notifications/:id/read',  authenticate, users.markNotificationRead);

export default router;

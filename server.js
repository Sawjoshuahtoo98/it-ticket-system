// src/server.js
import 'dotenv/config';
import express    from 'express';
import cors       from 'cors';
import helmet     from 'helmet';
import compression from 'compression';
import morgan     from 'morgan';
import rateLimit  from 'express-rate-limit';
import path       from 'path';
import { fileURLToPath } from 'url';

import { testConnection } from './config/database.js';
import { logger }         from './utils/logger.js';
import routes             from './routes/index.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

// ── Trust proxy ───────────────────────────────────────────────
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS FIX (🔥 IMPORTANT) ───────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,                 // from env (recommended)
  'https://helpdesk-ui.onrender.com',       // ✅ your frontend
  'http://localhost:5500',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow Postman / curl

    if (allowedOrigins.includes(origin)) {
      return cb(null, true);
    }

    return cb(new Error(`CORS not allowed: ${origin}`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// ── Rate limit ────────────────────────────────────────────────
app.use('/api', rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max:      parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
}));

// ── Middleware ────────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Logging ───────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
  skip: (req) => req.path === '/api/health',
}));

// ── Static files ──────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── Routes ────────────────────────────────────────────────────
app.use('/api', routes);

// ── Errors ────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start server ──────────────────────────────────────────────
const start = async () => {
  await testConnection();
  app.listen(PORT, () => {
    logger.info(`🚀  Server running  →  http://localhost:${PORT}`);
    logger.info(`📋  API docs        →  http://localhost:${PORT}/api/health`);
    logger.info(`🌍  Environment     →  ${process.env.NODE_ENV || 'development'}`);
  });
};

start().catch((err) => {
  logger.error('Failed to start:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received — shutting down');
  process.exit(0);
});

export default app;

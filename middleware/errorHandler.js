// src/middleware/errorHandler.js
import { logger } from '../utils/logger.js';

export const notFound = (req, res) =>
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });

export const errorHandler = (err, req, res, next) => {
  logger.error(err);

  if (err.code === '23505') {
    const field = err.detail?.match(/\((.+?)\)/)?.[1] || 'field';
    return res.status(409).json({ error: `${field} already exists` });
  }
  if (err.code === '23503')
    return res.status(400).json({ error: 'Referenced resource not found' });
  if (err.name === 'JsonWebTokenError')
    return res.status(401).json({ error: 'Invalid token' });

  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
};

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

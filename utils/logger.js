// src/utils/logger.js
import winston from 'winston';
import fs from 'fs';
import path from 'path';

const logDir = './logs';
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const { combine, timestamp, printf, colorize, errors } = winston.format;

const fmt = printf(({ level, message, timestamp, stack }) =>
  `${timestamp} [${level.toUpperCase()}]: ${stack || message}`
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), fmt),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), fmt),
    }),
    new winston.transports.File({
      filename: './logs/app.log',
      maxsize:  10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

// src/services/emailService.js
import nodemailer from 'nodemailer';
import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST   || 'sandbox.smtp.mailtrap.io',
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

// ── Base HTML wrapper ─────────────────────────────────────────
const base = (body) => `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;background:#f0f4f8;padding:24px}
  .wrap{max-width:580px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
  .hdr{background:#1e3a5f;padding:24px 32px;color:#fff}
  .hdr h1{font-size:18px;font-weight:700;letter-spacing:.5px}
  .hdr p{font-size:12px;color:#a0b4c8;margin-top:4px}
  .body{padding:32px;color:#334155;line-height:1.7;font-size:14px}
  .box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:20px 0}
  .box table{width:100%;border-collapse:collapse}
  .box td{padding:5px 0;vertical-align:top}
  .box td:first-child{font-weight:600;color:#64748b;font-size:12px;width:120px;padding-right:12px}
  .badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.5px}
  .badge-critical{background:#fee2e2;color:#991b1b}
  .badge-high{background:#ffedd5;color:#9a3412}
  .badge-medium{background:#fef9c3;color:#854d0e}
  .badge-low{background:#dcfce7;color:#166534}
  .badge-open{background:#dbeafe;color:#1e40af}
  .badge-in_progress{background:#fef9c3;color:#854d0e}
  .badge-resolved{background:#dcfce7;color:#166534}
  .btn{display:inline-block;background:#1e3a5f;color:#fff!important;text-decoration:none;padding:11px 24px;border-radius:6px;font-weight:700;font-size:13px;margin-top:20px}
  .ftr{background:#f8fafc;padding:16px 32px;font-size:11px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0}
  .comment-box{border-left:3px solid #1e3a5f;padding:10px 16px;background:#f8fafc;border-radius:0 6px 6px 0;margin-top:12px;font-style:italic;color:#475569}
</style></head>
<body><div class="wrap">
  <div class="hdr"><h1>🖥️ HelpDesk IT Support</h1><p>Automated notification — do not reply</p></div>
  <div class="body">${body}</div>
  <div class="ftr">IT Support Team &nbsp;•&nbsp; This is an automated message</div>
</div></body></html>`;

// ── Templates ─────────────────────────────────────────────────
const templates = {
  ticket_created: (d) => ({
    subject: `[TKT-${pad(d.ticketNumber)}] Ticket received — ${d.title}`,
    html: base(`
      <p>Hi <strong>${d.userName}</strong>,</p>
      <p>Your support ticket has been received. Our team will review it shortly.</p>
      <div class="box"><table>
        <tr><td>Ticket #</td><td><strong>TKT-${pad(d.ticketNumber)}</strong></td></tr>
        <tr><td>Title</td><td>${d.title}</td></tr>
        <tr><td>Priority</td><td><span class="badge badge-${d.priority}">${d.priority.toUpperCase()}</span></td></tr>
        <tr><td>Category</td><td>${d.category}</td></tr>
        <tr><td>Status</td><td><span class="badge badge-open">OPEN</span></td></tr>
      </table></div>
      <p>You'll receive email updates as the status changes.</p>
      <a href="${process.env.FRONTEND_URL}/index.html#ticket-${d.ticketId}" class="btn">View Ticket →</a>
    `),
  }),

  ticket_assigned: (d) => ({
    subject: `[TKT-${pad(d.ticketNumber)}] Assigned to ${d.techName}`,
    html: base(`
      <p>Hi <strong>${d.userName}</strong>,</p>
      <p>Your ticket has been assigned to a technician and is now in progress.</p>
      <div class="box"><table>
        <tr><td>Ticket #</td><td><strong>TKT-${pad(d.ticketNumber)}</strong></td></tr>
        <tr><td>Title</td><td>${d.title}</td></tr>
        <tr><td>Assigned to</td><td><strong>${d.techName}</strong></td></tr>
        <tr><td>Status</td><td><span class="badge badge-in_progress">IN PROGRESS</span></td></tr>
      </table></div>
      <a href="${process.env.FRONTEND_URL}/index.html#ticket-${d.ticketId}" class="btn">View Ticket →</a>
    `),
  }),

  ticket_resolved: (d) => ({
    subject: `[TKT-${pad(d.ticketNumber)}] Resolved ✓`,
    html: base(`
      <p>Hi <strong>${d.userName}</strong>,</p>
      <p>Great news — your support ticket has been marked as <strong>resolved</strong>.</p>
      <div class="box"><table>
        <tr><td>Ticket #</td><td><strong>TKT-${pad(d.ticketNumber)}</strong></td></tr>
        <tr><td>Title</td><td>${d.title}</td></tr>
        <tr><td>Resolved by</td><td>${d.techName}</td></tr>
        <tr><td>Status</td><td><span class="badge badge-resolved">RESOLVED</span></td></tr>
      </table></div>
      <p>If your issue persists, you can reopen the ticket within 7 days.</p>
      <a href="${process.env.FRONTEND_URL}/index.html#ticket-${d.ticketId}" class="btn">View & Reopen →</a>
    `),
  }),

  comment_added: (d) => ({
    subject: `[TKT-${pad(d.ticketNumber)}] New comment from ${d.authorName}`,
    html: base(`
      <p>Hi <strong>${d.userName}</strong>,</p>
      <p><strong>${d.authorName}</strong> left a comment on your ticket:</p>
      <div class="box">
        <strong>TKT-${pad(d.ticketNumber)}</strong> — ${d.title}
        <div class="comment-box">${d.comment}</div>
      </div>
      <a href="${process.env.FRONTEND_URL}/index.html#ticket-${d.ticketId}" class="btn">Reply →</a>
    `),
  }),

  ticket_status_changed: (d) => ({
    subject: `[TKT-${pad(d.ticketNumber)}] Status updated to ${d.newStatus}`,
    html: base(`
      <p>Hi <strong>${d.userName}</strong>,</p>
      <p>The status of your ticket has been updated.</p>
      <div class="box"><table>
        <tr><td>Ticket #</td><td><strong>TKT-${pad(d.ticketNumber)}</strong></td></tr>
        <tr><td>Title</td><td>${d.title}</td></tr>
        <tr><td>Old Status</td><td>${d.oldStatus}</td></tr>
        <tr><td>New Status</td><td><span class="badge badge-${d.newStatus.replace(' ','_')}">${d.newStatus.toUpperCase()}</span></td></tr>
      </table></div>
      <a href="${process.env.FRONTEND_URL}/index.html#ticket-${d.ticketId}" class="btn">View Ticket →</a>
    `),
  }),
};

const pad = (n) => String(n).padStart(4, '0');

// ── Send email ────────────────────────────────────────────────
export const sendEmail = async (to, templateName, data, ticketId = null) => {
  const tmpl = templates[templateName]?.(data);
  if (!tmpl) { logger.warn(`Unknown email template: ${templateName}`); return; }

  const { rows } = await query(
    `INSERT INTO email_logs (ticket_id, recipient, subject, template, status)
     VALUES ($1,$2,$3,$4,'pending') RETURNING id`,
    [ticketId, to, tmpl.subject, templateName]
  );
  const logId = rows[0].id;

  try {
    await transporter.sendMail({
      from:    process.env.EMAIL_FROM || 'HelpDesk <noreply@helpdesk.com>',
      to,
      subject: tmpl.subject,
      html:    tmpl.html,
    });
    await query(`UPDATE email_logs SET status='sent', sent_at=NOW() WHERE id=$1`, [logId]);
    logger.info(`📧 Email sent [${templateName}] → ${to}`);
  } catch (err) {
    await query(`UPDATE email_logs SET status='failed', error_msg=$1 WHERE id=$2`, [err.message, logId]);
    logger.error(`📧 Email failed [${templateName}] → ${to}: ${err.message}`);
  }
};

// ── In-app notification ───────────────────────────────────────
export const createNotification = async (userId, ticketId, type, title, message = null) => {
  try {
    await query(
      `INSERT INTO notifications (user_id, ticket_id, type, title, message)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, ticketId, type, title, message]
    );
  } catch (err) {
    logger.error('Notification insert failed:', err.message);
  }
};

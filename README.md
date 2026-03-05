# 🖥️ HelpDesk OS — IT Support Ticket System

Full-stack IT helpdesk platform. Node.js backend + PostgreSQL + vanilla HTML frontend.

---

## 📁 Project Structure

```
helpdesk/
├── backend/
│   ├── src/
│   │   ├── server.js               ← Entry point
│   │   ├── config/database.js      ← PostgreSQL pool
│   │   ├── middleware/
│   │   │   ├── auth.js             ← JWT verify + role guard
│   │   │   └── errorHandler.js     ← Global errors
│   │   ├── controllers/
│   │   │   ├── authController.js   ← Login/register/refresh
│   │   │   ├── ticketController.js ← Full ticket CRUD
│   │   │   ├── commentController.js← Comments + internal notes
│   │   │   └── userController.js   ← Users + notifications
│   │   ├── routes/index.js         ← All API routes
│   │   ├── services/emailService.js← Nodemailer + templates
│   │   └── utils/
│   │       ├── logger.js           ← Winston
│   │       └── seed.js             ← DB seed script
│   ├── Dockerfile
│   ├── package.json
│   ├── test.http                   ← REST Client tests
│   └── .env.example
├── frontend/
│   └── index.html                  ← Full dashboard SPA
├── database.sql                    ← Complete schema
├── docker-compose.yml
├── render.yaml                     ← Render.com deploy config
└── nginx/nginx.conf
```

---

## 🚀 Quick Start (Local)

### 1. Create database
```bash
psql -U postgres -c "CREATE DATABASE helpdesk;"
psql -U postgres -d helpdesk -f database.sql
```

### 2. Configure environment
```bash
cd backend
cp .env.example .env
# Edit .env — set DB_PASSWORD at minimum
```

### 3. Install & run
```bash
npm install
npm run dev
# API: http://localhost:3000
```

### 4. Open frontend
```
Open frontend/index.html with Live Server in VS Code
Or: npx serve frontend
```

### 5. Login
```
admin@company.com    / Admin@123   (Admin)
tech@company.com     / Tech@123    (Technician)
employee@company.com / User@123    (User)
```

---

## 🐳 Docker (Full Stack)

```bash
# Copy .env.example to .env and set values
cp backend/.env.example .env

# Start everything (DB + API + Nginx)
docker-compose up -d

# Open http://localhost
```

---

## ☁️ Deploy to Render

1. Push to GitHub
2. Go to render.com → New → Blueprint → connect repo
3. Render reads `render.yaml` and creates:
   - PostgreSQL database
   - Node.js web service (API)
   - Static site (frontend)
4. Run schema against Render DB:
   ```bash
   psql "postgresql://..." -f database.sql
   ```
5. Set `SMTP_USER` and `SMTP_PASS` manually in Render dashboard
6. Update `FRONTEND_URL` in backend env vars to your Render static site URL

---

## 📧 Email Setup

**For testing (free):** [mailtrap.io](https://mailtrap.io)
```env
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=587
SMTP_USER=your_mailtrap_user
SMTP_PASS=your_mailtrap_pass
```

**For production (Gmail):**
1. Enable 2FA on Gmail
2. Create App Password at myaccount.google.com/apppasswords
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
```

---

## 🔌 API Endpoints

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET    | /api/health | — | — | Health check |
| POST   | /api/auth/register | — | — | Register |
| POST   | /api/auth/login | — | — | Login → tokens |
| POST   | /api/auth/refresh | — | — | Rotate tokens |
| POST   | /api/auth/logout | — | — | Revoke token |
| GET    | /api/auth/me | ✓ | All | Profile |
| GET    | /api/tickets | ✓ | All | List tickets |
| POST   | /api/tickets | ✓ | All | Create ticket |
| GET    | /api/tickets/stats | ✓ | All | Dashboard stats |
| GET    | /api/tickets/:id | ✓ | All | Ticket detail |
| PATCH  | /api/tickets/:id | ✓ | All | Update ticket |
| DELETE | /api/tickets/:id | ✓ | Admin | Delete ticket |
| POST   | /api/tickets/:id/attachments | ✓ | All | Upload file |
| POST   | /api/tickets/:id/comments | ✓ | All | Add comment |
| PUT    | /api/tickets/:id/comments/:cid | ✓ | All | Edit comment |
| DELETE | /api/tickets/:id/comments/:cid | ✓ | All | Delete comment |
| GET    | /api/users | ✓ | Admin | List users |
| GET    | /api/users/technicians | ✓ | Staff | Technicians |
| GET    | /api/users/:id | ✓ | All | Get user |
| PUT    | /api/users/:id | ✓ | All | Update profile |
| PUT    | /api/users/:id/password | ✓ | All | Change password |
| GET    | /api/notifications | ✓ | All | Get notifs |
| PUT    | /api/notifications/read-all | ✓ | All | Mark all read |

---

## 🔒 Security

- JWT access tokens (15min) + refresh tokens (7d) with rotation
- bcrypt password hashing (12 rounds)
- Rate limiting: 100 req/15min global, 10 login attempts/15min
- Helmet.js security headers
- CORS whitelist
- Parameterized SQL queries only (no injection)
- Role-based access control on all routes
- SSL/TLS via Render (production) or Certbot (VPS)

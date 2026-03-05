-- ============================================================
-- HELPDESK IT SUPPORT — COMPLETE DATABASE SCHEMA
-- PostgreSQL 14+
-- Run: psql -U postgres -d helpdesk -f database.sql
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Enums ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role      AS ENUM ('admin','user','technician');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE ticket_status  AS ENUM ('open','in_progress','pending','resolved','closed');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE ticket_priority AS ENUM ('low','medium','high','critical');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE ticket_category AS ENUM ('hardware','software','network','access','email','printer','other');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'ticket_created','ticket_assigned','ticket_updated',
    'ticket_resolved','ticket_closed','comment_added'
  );
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Updated_at trigger function ───────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── USERS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  role          user_role    NOT NULL DEFAULT 'user',
  department    VARCHAR(100),
  phone         VARCHAR(30),
  avatar_url    TEXT,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active   ON users(is_active);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── TICKETS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id            UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_number SERIAL            UNIQUE,
  title         VARCHAR(255)      NOT NULL,
  description   TEXT              NOT NULL,
  status        ticket_status     NOT NULL DEFAULT 'open',
  priority      ticket_priority   NOT NULL DEFAULT 'medium',
  category      ticket_category   NOT NULL DEFAULT 'other',
  created_by    UUID              NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_to   UUID              REFERENCES users(id) ON DELETE SET NULL,
  due_date      TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  closed_at     TIMESTAMPTZ,
  sla_breached  BOOLEAN           NOT NULL DEFAULT FALSE,
  search_vector TSVECTOR,
  created_at    TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_status      ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority    ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by  ON tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to ON tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at  ON tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_search      ON tickets USING GIN(search_vector);

CREATE OR REPLACE FUNCTION tickets_search_update() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.description,''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tickets_search ON tickets;
CREATE TRIGGER trg_tickets_search
  BEFORE INSERT OR UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_search_update();

DROP TRIGGER IF EXISTS trg_tickets_updated_at ON tickets;
CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── TICKET ATTACHMENTS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  uploaded_by UUID        NOT NULL REFERENCES users(id)   ON DELETE RESTRICT,
  filename    VARCHAR(255) NOT NULL,
  file_url    TEXT         NOT NULL,
  file_size   INTEGER,
  mime_type   VARCHAR(100),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_ticket ON ticket_attachments(ticket_id);

-- ── COMMENTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   UUID        NOT NULL REFERENCES tickets(id)  ON DELETE CASCADE,
  author_id   UUID        NOT NULL REFERENCES users(id)    ON DELETE RESTRICT,
  body        TEXT        NOT NULL,
  is_internal BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_ticket ON comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);

DROP TRIGGER IF EXISTS trg_comments_updated_at ON comments;
CREATE TRIGGER trg_comments_updated_at
  BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── TICKET HISTORY ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_history (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  changed_by  UUID        NOT NULL REFERENCES users(id)  ON DELETE RESTRICT,
  field_name  VARCHAR(100) NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_ticket     ON ticket_history(ticket_id);
CREATE INDEX IF NOT EXISTS idx_history_changed_at ON ticket_history(changed_at DESC);

-- ── NOTIFICATIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID              NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  ticket_id   UUID              REFERENCES tickets(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  title       VARCHAR(255)      NOT NULL,
  message     TEXT,
  is_read     BOOLEAN           NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_user   ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notif_ticket ON notifications(ticket_id);

-- ── EMAIL LOGS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_logs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   UUID        REFERENCES tickets(id) ON DELETE SET NULL,
  recipient   VARCHAR(255) NOT NULL,
  subject     VARCHAR(500) NOT NULL,
  template    VARCHAR(100),
  status      VARCHAR(20)  NOT NULL DEFAULT 'pending',
  error_msg   TEXT,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── REFRESH TOKENS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

-- ── VIEWS ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_ticket_summary AS
SELECT
  t.id, t.ticket_number, t.title, t.status, t.priority, t.category,
  t.created_at, t.updated_at, t.due_date, t.sla_breached,
  uc.name  AS creator_name,  uc.email AS creator_email,
  ua.name  AS assignee_name, ua.email AS assignee_email,
  (SELECT COUNT(*) FROM comments c   WHERE c.ticket_id=t.id) AS comment_count,
  (SELECT COUNT(*) FROM ticket_attachments a WHERE a.ticket_id=t.id) AS attachment_count
FROM tickets t
JOIN  users uc ON t.created_by=uc.id
LEFT JOIN users ua ON t.assigned_to=ua.id;

CREATE OR REPLACE VIEW v_dashboard_stats AS
SELECT
  COUNT(*) FILTER (WHERE status='open')         AS open_count,
  COUNT(*) FILTER (WHERE status='in_progress')  AS in_progress_count,
  COUNT(*) FILTER (WHERE status='resolved')     AS resolved_count,
  COUNT(*) FILTER (WHERE status='closed')       AS closed_count,
  COUNT(*) FILTER (WHERE priority='critical')   AS critical_count,
  COUNT(*) FILTER (WHERE sla_breached=TRUE)     AS sla_breached_count,
  COUNT(*)                                       AS total_count
FROM tickets;

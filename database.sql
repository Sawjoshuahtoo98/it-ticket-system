-- ============================================================
-- HELPDESK IT SUPPORT SYSTEM
-- PostgreSQL 14+
-- Compatible with Node.js + Render
-- UUID-based auth system
-- ============================================================

-- ─────────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────
-- ENUM TYPES
-- ─────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin','user','technician');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('open','in_progress','pending','resolved','closed');
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
    'ticket_created',
    'ticket_assigned',
    'ticket_updated',
    'ticket_resolved',
    'ticket_closed',
    'comment_added'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────
-- UPDATED_AT FUNCTION
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- USERS TABLE
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  department VARCHAR(100),
  phone VARCHAR(30),
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- TICKETS TABLE
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_number SERIAL UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  status ticket_status DEFAULT 'open',
  priority ticket_priority DEFAULT 'medium',
  category ticket_category DEFAULT 'other',
  created_by UUID REFERENCES users(id),
  assigned_to UUID REFERENCES users(id),
  due_date TIMESTAMP,
  resolved_at TIMESTAMP,
  closed_at TIMESTAMP,
  sla_breached BOOLEAN DEFAULT FALSE,
  search_vector TSVECTOR,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_ticket_priority ON tickets(priority);

-- Full-text search
CREATE OR REPLACE FUNCTION tickets_search_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    to_tsvector('english',
      COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.description,'')
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ticket_search ON tickets;
CREATE TRIGGER trg_ticket_search
BEFORE INSERT OR UPDATE ON tickets
FOR EACH ROW EXECUTE FUNCTION tickets_search_update();

DROP TRIGGER IF EXISTS trg_ticket_updated ON tickets;
CREATE TRIGGER trg_ticket_updated
BEFORE UPDATE ON tickets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- COMMENTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id),
  body TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_comment_updated ON comments;
CREATE TRIGGER trg_comment_updated
BEFORE UPDATE ON comments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- ATTACHMENTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id),
  file_url TEXT NOT NULL,
  filename VARCHAR(255),
  file_size INT,
  mime_type VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES tickets(id),
  type notification_type,
  title VARCHAR(255),
  message TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- REFRESH TOKENS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- VIEW: TICKET SUMMARY
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_ticket_summary AS
SELECT
  t.id,
  t.ticket_number,
  t.title,
  t.status,
  t.priority,
  t.category,
  t.created_at,
  uc.name AS creator_name,
  ua.name AS assignee_name
FROM tickets t
LEFT JOIN users uc ON t.created_by = uc.id
LEFT JOIN users ua ON t.assigned_to = ua.id;

-- ─────────────────────────────────────────────
-- VIEW: DASHBOARD STATS
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_dashboard_stats AS
SELECT
  COUNT(*) FILTER (WHERE status='open') AS open_count,
  COUNT(*) FILTER (WHERE status='in_progress') AS in_progress_count,
  COUNT(*) FILTER (WHERE status='resolved') AS resolved_count,
  COUNT(*) FILTER (WHERE status='closed') AS closed_count,
  COUNT(*) AS total_tickets
FROM tickets;

-- ─────────────────────────────────────────────
-- DEFAULT ADMIN USER (IMPORTANT)
-- password = 123456 (bcrypt hashed recommended)
-- ─────────────────────────────────────────────
INSERT INTO users (name, email, password_hash, role)
VALUES (
  'Admin',
  'admin@company.com',
  crypt('123456', gen_salt('bf')),
  'admin'
)
ON CONFLICT (email) DO NOTHING;

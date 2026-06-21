-- ============================================================
-- REKAM Database Schema — Migration 001: Initial Tables
-- ============================================================

-- Ekstensi yang diperlukan
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── ENUM Types ──────────────────────────────
CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'EDITOR', 'VIEWER');
CREATE TYPE media_type AS ENUM ('IMAGE', 'VIDEO');
CREATE TYPE media_status AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'ERROR');
CREATE TYPE export_status AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'ERROR');
CREATE TYPE audit_action AS ENUM (
  'LOGIN', 'LOGOUT',
  'CREATE', 'UPDATE', 'DELETE',
  'UPLOAD', 'DOWNLOAD',
  'SHARE', 'UNSHARE',
  'EXPORT'
);

-- ─── 1. DISTRICTS (Kecamatan Asal) ─────────────
CREATE TABLE districts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. TEAMS (Grup/Tim Peliput) ─────────────
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. USERS ────────────────────────────────
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'VIEWER',
  district_id UUID REFERENCES districts(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_district_id ON users(district_id);

-- ─── 4. TEAM_MEMBERS ─────────────────────────
CREATE TABLE team_members (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX idx_team_members_user_id ON team_members(user_id);

-- ─── 5. ACTIVITIES (Acara/Kegiatan) ──────────
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(500) NOT NULL,
  description TEXT,
  description_json JSONB,
  use_sections BOOLEAN NOT NULL DEFAULT TRUE,
  event_date DATE,
  event_end_date DATE,
  location VARCHAR(500),
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activities_team_id ON activities(team_id);
CREATE INDEX idx_activities_event_date ON activities(event_date);
CREATE INDEX idx_activities_created_by ON activities(created_by);
CREATE INDEX idx_activities_fts ON activities USING GIN (to_tsvector('indonesian', title));

-- ─── 4. EVENT_SECTIONS (Seksi/Bagian dalam Acara) ─
CREATE TABLE event_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description_json JSONB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_sections_activity_id ON event_sections(activity_id);

-- ─── 5. MEDIA_FILES (Foto & Video) ───────────
CREATE TABLE media_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  section_id UUID NOT NULL REFERENCES event_sections(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,

  -- File info
  original_filename VARCHAR(500) NOT NULL,
  display_name VARCHAR(500),
  media_type media_type NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,

  -- Storage keys (paths di MinIO)
  storage_key_raw VARCHAR(1000),        -- rekam-raw bucket
  storage_key_processed VARCHAR(1000),  -- rekam-processed bucket
  storage_key_thumbnail VARCHAR(1000),  -- rekam-processed bucket (thumbnail)

  -- Metadata
  title VARCHAR(500),
  title_is_auto_gen BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  description_json JSONB,
  width INTEGER,
  height INTEGER,
  duration_seconds NUMERIC(10,2),       -- untuk video
  fps NUMERIC(6,2),                     -- untuk video
  quality_variants JSONB,

  -- Processing
  status media_status NOT NULL DEFAULT 'UPLOADING',
  processing_error TEXT,
  checksum_sha256 VARCHAR(64),

  -- Flags
  is_edited BOOLEAN NOT NULL DEFAULT FALSE, -- true jika title/description sudah diisi
  sort_order INTEGER NOT NULL DEFAULT 0,

  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_files_section_id ON media_files(section_id);
CREATE INDEX idx_media_files_activity_id ON media_files(activity_id);
CREATE INDEX idx_media_files_status ON media_files(status);
CREATE INDEX idx_media_files_is_edited ON media_files(is_edited);

-- ─── 6. EVENT_ATTACHMENTS (Lampiran PDF, Docx, dll.) ─
CREATE TABLE event_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  original_filename VARCHAR(500) NOT NULL,
  display_name VARCHAR(500),
  mime_type VARCHAR(100) NOT NULL,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  checksum_sha256 VARCHAR(64),
  storage_key VARCHAR(1000) NOT NULL,  -- rekam-attach bucket
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_attachments_activity_id ON event_attachments(activity_id);

-- ─── 7. PERSONS (Orang yang di-tag di media) ─
CREATE TABLE persons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name VARCHAR(255) NOT NULL,
  position VARCHAR(255),        -- jabatan
  organization VARCHAR(255),    -- instansi
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 8. MEDIA_PERSON_TAGS (Junction: media <-> persons) ─
CREATE TABLE media_person_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  media_id UUID NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(media_id, person_id)
);

CREATE INDEX idx_media_person_tags_media_id ON media_person_tags(media_id);
CREATE INDEX idx_media_person_tags_person_id ON media_person_tags(person_id);

-- ─── 9. SHARING_SNAPSHOTS (QR Sharing Selektif) ─
CREATE TABLE sharing_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  token VARCHAR(64) NOT NULL UNIQUE,    -- token untuk URL publik /p/{token}
  title VARCHAR(500),
  label VARCHAR(255),
  description_mode VARCHAR(10) DEFAULT 'AUTO' CHECK (description_mode IN ('NONE', 'AUTO', 'CUSTOM')),
  description_custom TEXT,
  persons_visible BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  download_quality VARCHAR(20) DEFAULT 'BOTH', -- 'PREVIEW', 'ORIGINAL', 'BOTH'
  total_scans INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sharing_snapshots_token ON sharing_snapshots(token);
CREATE INDEX idx_sharing_snapshots_activity_id ON sharing_snapshots(activity_id);

-- ─── 10. SHARING_SNAPSHOT_ITEMS (Item yang dipilih di snapshot) ─
CREATE TABLE sharing_snapshot_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  snapshot_id UUID NOT NULL REFERENCES sharing_snapshots(id) ON DELETE CASCADE,
  section_id UUID REFERENCES event_sections(id) ON DELETE CASCADE,
  media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
  item_type VARCHAR(20) DEFAULT 'media' CHECK (item_type IN ('section', 'media', 'attachment')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sharing_snapshot_items_snapshot_id ON sharing_snapshot_items(snapshot_id);

-- ─── 11. QR_SCAN_LOGS (Log scan QR) ──────────
CREATE TABLE qr_scan_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  snapshot_id UUID NOT NULL REFERENCES sharing_snapshots(id) ON DELETE CASCADE,
  ip_address VARCHAR(45),
  user_agent TEXT,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qr_scan_logs_snapshot_id ON qr_scan_logs(snapshot_id);

-- ─── 12. AUDIT_LOGS ──────────────────────────
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action audit_action NOT NULL,
  entity_type VARCHAR(100),      -- 'activity', 'media_file', 'sharing_snapshot', dll.
  entity_id UUID,
  details JSONB,                 -- detail perubahan dalam format JSON
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- ─── 13. EXPORT_JOBS ─────────────────────────
CREATE TABLE export_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status export_status NOT NULL DEFAULT 'PENDING',
  format VARCHAR(20) NOT NULL DEFAULT 'ZIP',   -- 'ZIP', 'PDF_REPORT'
  storage_key VARCHAR(1000),   -- rekam-exports bucket
  file_size_bytes BIGINT,
  error_message TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_export_jobs_activity_id ON export_jobs(activity_id);
CREATE INDEX idx_export_jobs_status ON export_jobs(status);

-- ─── 14. ACTIVITY_VERSIONS (Versioning) ──────
CREATE TABLE activity_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  snapshot_data JSONB NOT NULL,     -- full snapshot data acara saat itu
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_versions_activity_id ON activity_versions(activity_id);

-- ─── Updated_at Trigger Function ─────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger ke semua tabel yang punya updated_at
CREATE TRIGGER trigger_districts_updated_at BEFORE UPDATE ON districts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_activities_updated_at BEFORE UPDATE ON activities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_event_sections_updated_at BEFORE UPDATE ON event_sections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_media_files_updated_at BEFORE UPDATE ON media_files FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_sharing_snapshots_updated_at BEFORE UPDATE ON sharing_snapshots FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

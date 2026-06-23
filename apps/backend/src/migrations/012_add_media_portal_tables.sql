-- ============================================================
-- REKAM Database Schema — Migration 012: Media Portal & Coverages
-- ============================================================

-- 1. Tambah Role MEDIA
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'MEDIA';

-- 2. Buat tabel media_agencies
CREATE TABLE media_agencies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  website_url VARCHAR(500),
  media_type VARCHAR(20) NOT NULL DEFAULT 'BOTH' CHECK (media_type IN ('ONLINE', 'OFFLINE', 'BOTH')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trigger_media_agencies_updated_at BEFORE UPDATE ON media_agencies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3. Tambahkan kolom media_agency_id ke users
ALTER TABLE users ADD COLUMN media_agency_id UUID REFERENCES media_agencies(id) ON DELETE SET NULL;
CREATE INDEX idx_users_media_agency_id ON users(media_agency_id);

-- 4. Buat tabel news_coverages
CREATE TABLE news_coverages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  media_agency_id UUID NOT NULL REFERENCES media_agencies(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  news_url VARCHAR(1000), -- link berita online (opsional jika offline)
  publish_date DATE NOT NULL,
  submit_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Info File (Bukti Tayang)
  file_url VARCHAR(1000) NOT NULL, -- Path MinIO
  file_type VARCHAR(20) NOT NULL,  -- JPG, PNG, WebP, PDF
  original_filename VARCHAR(500) NOT NULL,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_news_coverages_activity_id ON news_coverages(activity_id);
CREATE INDEX idx_news_coverages_media_agency_id ON news_coverages(media_agency_id);
CREATE TRIGGER trigger_news_coverages_updated_at BEFORE UPDATE ON news_coverages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

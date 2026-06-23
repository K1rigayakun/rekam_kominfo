-- ============================================================
-- REKAM Database Schema — Migration 013: Support Multiple Files
-- ============================================================

-- 1. Tambah kolom files JSONB
ALTER TABLE news_coverages ADD COLUMN files JSONB DEFAULT '[]'::jsonb;

-- 2. Migrasi data existing ke array JSONB
UPDATE news_coverages
SET files = jsonb_build_array(
  jsonb_build_object(
    'file_url', file_url,
    'file_type', file_type,
    'original_filename', original_filename,
    'file_size_bytes', file_size_bytes
  )
)
WHERE file_url IS NOT NULL AND file_url != '';

-- 3. Hapus kolom-kolom file lama
ALTER TABLE news_coverages
DROP COLUMN file_url,
DROP COLUMN file_type,
DROP COLUMN original_filename,
DROP COLUMN file_size_bytes;

-- ============================================================
-- REKAM Database Schema — Migration 014: Remove activity_id from news coverages
-- ============================================================

-- Hapus kolom activity_id dari tabel news_coverages karena berita media tidak berhubungan dengan acara internal
ALTER TABLE news_coverages DROP COLUMN IF EXISTS activity_id;

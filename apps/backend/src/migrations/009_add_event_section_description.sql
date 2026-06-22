-- 009_add_event_section_description.sql
-- Menambahkan kolom description legacy yang dipakai beberapa flow editor seksi.

ALTER TABLE event_sections
ADD COLUMN IF NOT EXISTS description TEXT;

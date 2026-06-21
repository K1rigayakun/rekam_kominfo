-- Tambahkan kolom config untuk visibilitas lampiran dan pengaturan lanjutan
ALTER TABLE sharing_snapshots ADD COLUMN config JSONB DEFAULT '{}'::jsonb;

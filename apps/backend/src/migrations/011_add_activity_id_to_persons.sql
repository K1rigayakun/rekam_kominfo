-- 011_add_activity_id_to_persons.sql
-- Menambahkan activity_id ke tabel persons untuk membatasi orang terkait per acara

ALTER TABLE persons 
ADD COLUMN activity_id UUID REFERENCES activities(id) ON DELETE CASCADE;

-- Karena ini fitur baru, kita bisa membuat index pada activity_id untuk pencarian yang lebih cepat
CREATE INDEX idx_persons_activity_id ON persons(activity_id);

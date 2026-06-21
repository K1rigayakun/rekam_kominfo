-- ============================================================
-- Migration 005: Tag activities to the event district
-- ============================================================
-- Plan Awal requires each activity to be tagged with the district where
-- the event happened. This is different from the creator's home district
-- because editors can cover events across districts.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS district_id UUID REFERENCES districts(id) ON DELETE SET NULL;

UPDATE activities a
SET district_id = u.district_id
FROM users u
WHERE a.created_by = u.id
  AND a.district_id IS NULL
  AND u.district_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activities_district_id ON activities(district_id);

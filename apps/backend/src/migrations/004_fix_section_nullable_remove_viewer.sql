-- ============================================================
-- Migration 004: Fix section_id nullable + Remove VIEWER role
-- ============================================================

-- 1. Make section_id nullable on media_files
ALTER TABLE media_files ALTER COLUMN section_id DROP NOT NULL;

-- 2. Remove VIEWER from user_role enum
-- Update any existing VIEWER users to EDITOR first
UPDATE users SET role = 'EDITOR' WHERE role = 'VIEWER';

-- Drop the default before changing enum type
ALTER TABLE users ALTER COLUMN role DROP DEFAULT;

-- Create new enum without VIEWER
CREATE TYPE user_role_new AS ENUM ('SUPER_ADMIN', 'EDITOR');

-- Alter column to use new enum
ALTER TABLE users 
  ALTER COLUMN role TYPE user_role_new 
  USING role::text::user_role_new;

-- Set default back
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'EDITOR';

-- Drop old enum and rename new
DROP TYPE user_role;
ALTER TYPE user_role_new RENAME TO user_role;

-- 3. Ensure description_json exists on event_sections
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'event_sections' AND column_name = 'description_json'
  ) THEN
    ALTER TABLE event_sections ADD COLUMN description_json JSONB;
  END IF;
END $$;

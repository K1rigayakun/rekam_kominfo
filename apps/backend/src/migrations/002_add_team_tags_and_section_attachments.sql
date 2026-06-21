-- Up Migration
ALTER TABLE event_attachments ADD COLUMN section_id UUID REFERENCES event_sections(id) ON DELETE CASCADE;

CREATE TABLE media_team_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    media_id UUID NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(media_id, team_id)
);

-- Down Migration (for rollback if needed, commented out)
/*
DROP TABLE IF EXISTS media_team_tags;
ALTER TABLE event_attachments DROP COLUMN section_id;
*/

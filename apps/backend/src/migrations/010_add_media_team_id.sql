-- Add team_id to media_files
ALTER TABLE media_files 
ADD COLUMN team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX idx_media_files_team_id ON media_files(team_id);

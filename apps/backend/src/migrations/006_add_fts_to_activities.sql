-- Migration 006: Add Full Text Search (FTS) vector to activities

ALTER TABLE activities
ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(location, '')), 'C')
) STORED;

CREATE INDEX idx_activities_search_vector ON activities USING GIN (search_vector);

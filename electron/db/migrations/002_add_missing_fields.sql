-- Migration v2: Add missing fields
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assets ADD COLUMN position TEXT;
ALTER TABLE assessment_records ADD COLUMN method TEXT NOT NULL DEFAULT 'check';
ALTER TABLE assessment_records ADD COLUMN command_output TEXT;
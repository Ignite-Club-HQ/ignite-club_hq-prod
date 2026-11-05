-- Add league_admin to app_role enum (must be committed separately)
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'league_admin';
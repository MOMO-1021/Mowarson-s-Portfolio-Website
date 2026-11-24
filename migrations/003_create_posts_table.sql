-- Migration: 003_create_posts_table.sql
-- Create posts table for dynamic blog content

CREATE TABLE IF NOT EXISTS posts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'Mowarson',
  featured_image TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  canonical_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS posts_status_published_at_idx
  ON posts (status, published_at DESC);
CREATE INDEX IF NOT EXISTS posts_slug_idx
  ON posts (slug);

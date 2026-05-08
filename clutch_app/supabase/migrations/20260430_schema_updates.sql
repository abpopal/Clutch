-- ============================================================
-- Migration: 20260430_schema_updates
-- Renames firebase_uid → auth_uid, adds missing fields,
-- adds notifications and comments tables.
-- Run this in Supabase SQL Editor.
-- ============================================================

-- 1. Rename firebase_uid to auth_uid on users table
--    (Supabase auth UIDs were already stored here; just renaming for clarity)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'firebase_uid'
  ) THEN
    ALTER TABLE users RENAME COLUMN firebase_uid TO auth_uid;
  END IF;
END $$;

-- 2. Add sport and bio to athletes table
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS sport text;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS bio  text;

-- 3. Add avatar_url and role cache to user_directory
--    (Avoids extra joins when rendering feed/profiles)
ALTER TABLE user_directory ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE user_directory ADD COLUMN IF NOT EXISTS role      text;

-- 4. Add school_id and display_name to coaches
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS school_id    uuid references schools(school_id) on delete set null;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS display_name text;

-- 5. Allow 'recap' as a valid post_type
--    (home.js uses 'standard' and 'recap'; map 'standard' → 'text' in JS, keep 'recap' here)
ALTER TABLE post DROP CONSTRAINT IF EXISTS post_post_type_check;
ALTER TABLE post ADD CONSTRAINT post_post_type_check
  CHECK (post_type IN ('image', 'video', 'text', 'recap'));

-- 6. Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  notification_id uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type            text    NOT NULL CHECK (type IN (
                    'offer', 'follow', 'match', 'post_like',
                    'post_comment', 'profile_share', 'join_request', 'general'
                  )),
  title           text,
  body            text,
  reference_id    uuid,
  read_at         timestamp,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (user_id, created_at DESC);

-- 7. Post comments table
CREATE TABLE IF NOT EXISTS post_comment (
  comment_id      uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id         uuid  NOT NULL REFERENCES post(post_id) ON DELETE CASCADE,
  author_user_id  uuid  NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  body            text  NOT NULL,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_comment_post
  ON post_comment (post_id, created_at ASC);

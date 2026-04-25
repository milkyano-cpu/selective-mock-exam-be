ALTER TABLE users
ADD COLUMN profile_photo_key TEXT,
ADD COLUMN profile_photo_original_name TEXT,
ADD COLUMN profile_photo_mime_type TEXT,
ADD COLUMN profile_photo_size INTEGER,
ADD COLUMN profile_photo_updated_at TIMESTAMPTZ;

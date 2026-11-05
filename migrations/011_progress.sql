-- «ملفي»: the longest real game session of a streamer (minutes), for the profile's time statistics.
ALTER TABLE streamer_stats ADD COLUMN longest_minutes integer NOT NULL DEFAULT 0 CHECK (longest_minutes >= 0);

INSERT INTO "system_settings" ("key", "value")
VALUES ('leaderboard_min_exams_threshold', '3')
ON CONFLICT ("key") DO NOTHING;

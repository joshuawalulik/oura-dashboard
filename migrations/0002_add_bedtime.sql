-- When the night's main sleep began, as minutes from local midnight: 23:30 is
-- -30 and 00:45 is 45, so a bedtime either side of midnight averages cleanly.
ALTER TABLE days ADD COLUMN bedtime_minutes INTEGER;

-- Asynchronous turns (M4.3): who still has to plan this turn, and when the turn timer runs out, so a player's list of
-- ongoing matches can show where it's their move without waking every match.
ALTER TABLE match_seats ADD COLUMN waiting INTEGER NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN turn_deadline INTEGER;

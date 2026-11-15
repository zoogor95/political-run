-- Tournaments (M4.5): the bracket. One row per table per round; each table is an ordinary online match.
CREATE TABLE tournament_tables (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  table_no INTEGER NOT NULL,
  match_code TEXT,
  match_id TEXT,
  players TEXT NOT NULL,
  winner_account_id TEXT,
  finished_at INTEGER,
  PRIMARY KEY (tournament_id, round, table_no)
);
-- A cup that didn't get enough entrants is cancelled, not finished.
ALTER TABLE tournaments ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0;

-- Up to eight players on a map: a match's seats are numbered 0 to 7. SQLite can't change a CHECK in place, so the table
-- is rebuilt with the same columns and indexes (and the "waiting" column that 0003 added).
CREATE TABLE match_seats_new (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 7),
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  ai_level TEXT CHECK (ai_level IN ('easy','normal','hard')),
  candidate_kind TEXT NOT NULL CHECK (candidate_kind IN ('roster','community','custom')),
  candidate_ref TEXT NOT NULL,
  party_code TEXT,
  party_name TEXT NOT NULL,
  party_color TEXT,
  party_emblem TEXT,
  teammates TEXT NOT NULL DEFAULT '[]',
  missed_turns INTEGER NOT NULL DEFAULT 0,
  final_seats INTEGER,
  final_popular_vote INTEGER,
  final_rank INTEGER,
  eliminated_turn INTEGER,
  rating_change INTEGER,
  waiting INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, seat)
);
INSERT INTO match_seats_new SELECT match_id, seat, account_id, ai_level, candidate_kind, candidate_ref, party_code, party_name, party_color, party_emblem, teammates, missed_turns, final_seats, final_popular_vote, final_rank, eliminated_turn, rating_change, waiting FROM match_seats;
DROP TABLE match_seats;
ALTER TABLE match_seats_new RENAME TO match_seats;
CREATE INDEX idx_seats_account ON match_seats(account_id, match_id);
CREATE UNIQUE INDEX uq_seats_color ON match_seats(match_id, party_color);
CREATE UNIQUE INDEX uq_seats_emblem ON match_seats(match_id, party_emblem);

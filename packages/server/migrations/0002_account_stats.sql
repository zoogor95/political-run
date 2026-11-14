-- The local profile's match stats (matches, wins per map, best seat share and so on), synced so a player keeps them
-- across devices and reinstalls. Competitive numbers stay in ratings and candidate_stats; this is the casual record.
CREATE TABLE account_stats (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  stats TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

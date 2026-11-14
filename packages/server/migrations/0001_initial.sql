-- The first migration for Cloudflare D1 (SQLite), as agreed in the design document's Database tab.
-- Foreign keys are enforced; every list a screen shows has an index.
PRAGMA foreign_keys = ON;

-- Players
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '{}',
  home_country TEXT,
  home_region TEXT,
  locale TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX idx_accounts_region ON accounts(home_country, home_region);

CREATE TABLE identities (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('discord','steam','google_play','game_center','device')),
  provider_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX idx_identities_account ON identities(account_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX idx_sessions_account ON sessions(account_id);

CREATE TABLE push_tokens (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('fcm','apns','web','discord')),
  token TEXT NOT NULL UNIQUE,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_push_account ON push_tokens(account_id);

CREATE TABLE account_settings (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  settings TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE party_profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  emblem TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE account_roles (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','reviewer')),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, role)
);

CREATE TABLE blocks (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  blocked_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, blocked_account_id)
);

-- Store and coins
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('full_game','candidate_creator','community_candidate','cosmetic','map_pack')),
  ref_id TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  coin_price INTEGER CHECK (coin_price IS NULL OR coin_price > 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_products_kind ON products(kind, active);

CREATE TABLE store_skus (
  product_id TEXT NOT NULL REFERENCES products(id),
  store TEXT NOT NULL CHECK (store IN ('web','itch','discord','google_play','steam','app_store')),
  sku TEXT NOT NULL,
  PRIMARY KEY (product_id, store),
  UNIQUE (store, sku)
);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  store TEXT NOT NULL,
  store_transaction_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','completed','refunded')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (store, store_transaction_id)
);
CREATE INDEX idx_purchases_account ON purchases(account_id, created_at);

CREATE TABLE entitlements (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  source TEXT NOT NULL CHECK (source IN ('purchase','coins','reward','admin')),
  source_id TEXT,
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (account_id, product_id)
);

CREATE TABLE coin_ledger (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  reason TEXT NOT NULL CHECK (reason IN ('community_sale','spend','refund_reversal','admin_adjustment')),
  ref_type TEXT,
  ref_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_coins_account ON coin_ledger(account_id, created_at);

CREATE TABLE coin_balances (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at INTEGER NOT NULL
);

-- Matches
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('solo','pass_and_play','private','quick','ranked','tournament')),
  game_type TEXT NOT NULL CHECK (game_type IN ('presidential','parliamentary','career')),
  map_pack_id TEXT NOT NULL,
  content_version TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  seed INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('lobby','active','finished','abandoned')),
  turn_timer_seconds INTEGER,
  current_turn INTEGER NOT NULL DEFAULT 0,
  final_turn INTEGER,
  invite_code TEXT UNIQUE,
  tournament_id TEXT REFERENCES tournaments(id),
  created_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX idx_matches_status ON matches(status, mode);

CREATE TABLE match_seats (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 4),
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
  PRIMARY KEY (match_id, seat)
);
CREATE INDEX idx_seats_account ON match_seats(account_id, match_id);
-- Colors and emblems are first come, first served within a match: whoever claims one first gets it, whatever their join
-- order. Both stay empty while a player is still choosing and must be set before the match starts. AI seats pick last.
CREATE UNIQUE INDEX uq_seats_color ON match_seats(match_id, party_color);
CREATE UNIQUE INDEX uq_seats_emblem ON match_seats(match_id, party_emblem);

CREATE TABLE match_turns (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  seat INTEGER NOT NULL,
  actions TEXT NOT NULL,
  auto INTEGER NOT NULL DEFAULT 0,
  submitted_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, turn, seat)
);

CREATE TABLE turn_results (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  events TEXT NOT NULL,
  headlines TEXT NOT NULL DEFAULT '[]',
  standings TEXT NOT NULL,
  resolved_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, turn)
);

CREATE TABLE match_results (
  match_id TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  winner_seat INTEGER,
  government TEXT,
  second_round INTEGER NOT NULL DEFAULT 0,
  regions TEXT NOT NULL,
  popular_vote TEXT NOT NULL,
  headline_of_match TEXT
);

CREATE TABLE cloud_saves (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  content_version TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, slot)
);

-- Competition
CREATE TABLE seasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL
);

CREATE TABLE ratings (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES seasons(id),
  map_pack_id TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 1000,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, season_id, map_pack_id)
);
CREATE INDEX idx_ratings_board ON ratings(season_id, map_pack_id, rating DESC);

CREATE TABLE candidate_stats (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES seasons(id),
  map_pack_id TEXT NOT NULL,
  candidate_ref TEXT NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, season_id, map_pack_id, candidate_ref)
);
CREATE INDEX idx_candidate_board ON candidate_stats(season_id, map_pack_id, candidate_ref, score DESC);

CREATE TABLE creator_stats (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES seasons(id),
  copies_sold INTEGER NOT NULL DEFAULT 0,
  matches_played INTEGER NOT NULL DEFAULT 0,
  coins_earned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, season_id)
);
CREATE INDEX idx_creator_board ON creator_stats(season_id, copies_sold DESC);

CREATE TABLE account_achievements (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  achievement_code TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  match_id TEXT REFERENCES matches(id) ON DELETE SET NULL,
  PRIMARY KEY (account_id, achievement_code)
);

CREATE TABLE tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  map_pack_id TEXT NOT NULL,
  rules TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled','open','running','finished')),
  reward_product_id TEXT REFERENCES products(id)
);

CREATE TABLE tournament_entries (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  rank INTEGER,
  reward_granted_at INTEGER,
  PRIMARY KEY (tournament_id, account_id)
);
CREATE INDEX idx_tournament_board ON tournament_entries(tournament_id, score DESC);

-- Community candidates and moderation
CREATE TABLE custom_candidates (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL,
  modifiers TEXT NOT NULL,
  points_used INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_custom_owner ON custom_candidates(owner_account_id);

CREATE TABLE community_candidates (
  id TEXT PRIMARY KEY,
  creator_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  custom_candidate_id TEXT REFERENCES custom_candidates(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted','approved','rejected','removed')),
  live_version_id TEXT,
  price_cents INTEGER NOT NULL DEFAULT 199,
  sales_count INTEGER NOT NULL DEFAULT 0,
  approved_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_community_status ON community_candidates(status, approved_at);
CREATE INDEX idx_community_creator ON community_candidates(creator_account_id);

CREATE TABLE community_candidate_versions (
  id TEXT PRIMARY KEY,
  community_candidate_id TEXT NOT NULL REFERENCES community_candidates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  bio TEXT NOT NULL,
  avatar TEXT NOT NULL,
  modifiers TEXT NOT NULL,
  points_used INTEGER NOT NULL,
  submitted_at INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  reviewer_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  review_note TEXT,
  reviewed_at INTEGER,
  UNIQUE (community_candidate_id, version)
);
CREATE INDEX idx_versions_review ON community_candidate_versions(review_status, submitted_at);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  reporter_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('community_candidate','account')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  created_at INTEGER NOT NULL,
  resolved_by TEXT REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE INDEX idx_reports_open ON reports(status, created_at);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_target ON audit_log(target_type, target_id);

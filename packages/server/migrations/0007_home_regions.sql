-- A player's home region on each map, picked on the profile and used to filter the leaderboards by region.
CREATE TABLE home_regions (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  map_pack_id TEXT NOT NULL,
  region_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, map_pack_id)
);
CREATE INDEX home_regions_by_region ON home_regions (map_pack_id, region_id);

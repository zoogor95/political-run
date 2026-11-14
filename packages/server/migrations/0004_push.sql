-- Push notifications (rest of M4.3): each browser that asked to be told when it's the player's move. One row per
-- subscription; a player can have several devices.
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_subscriptions_account ON push_subscriptions(account_id);

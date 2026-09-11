CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE device_tokens (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX device_tokens_device_id_idx
  ON device_tokens(device_id);

CREATE UNIQUE INDEX device_tokens_one_active_idx
  ON device_tokens(device_id)
  WHERE revoked_at IS NULL;

-- One row per person who drew a line. Only the district of origin and the destination city are
-- kept: no names, contact details or locations.
CREATE TABLE lines (
  id             INTEGER PRIMARY KEY,
  district_id    TEXT NOT NULL,              -- from yemen.json, e.g. YE1704
  city_id        TEXT NOT NULL,              -- GeoNames id from cities.json
  created_at     INTEGER NOT NULL,           -- ms since epoch
  ip_hash        TEXT,                       -- keyed hash of IP and browser, cleared after 30 days
  status         TEXT NOT NULL DEFAULT 'ok', -- ok | hidden
  message        TEXT,                       -- optional, public only once approved
  message_status TEXT                        -- pending | approved | rejected, NULL without a message
);

-- Covers the public counts: GROUP BY over all lines and "one of N" per governorate and city.
CREATE INDEX idx_pair ON lines (status, city_id, district_id);
-- One line per device per day.
CREATE INDEX idx_hash ON lines (ip_hash, created_at);
-- Messages waiting for review, and the latest approved ones.
CREATE INDEX idx_message ON lines (message_status, created_at);

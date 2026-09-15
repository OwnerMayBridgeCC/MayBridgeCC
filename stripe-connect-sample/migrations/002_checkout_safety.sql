-- An exact-time unique index does not prevent partially overlapping bookings.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE bookings ADD CONSTRAINT no_overlapping_provider_bookings
  EXCLUDE USING gist (provider_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)
  WHERE (status <> 'canceled');
ALTER TABLE memberships ADD COLUMN checkout_session_id text UNIQUE;
ALTER TABLE memberships ADD COLUMN checkout_attempt_id uuid;

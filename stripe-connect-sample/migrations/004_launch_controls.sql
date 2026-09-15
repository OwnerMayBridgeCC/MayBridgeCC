ALTER TABLE provider_profiles ADD COLUMN credentials_expires_at timestamptz,
  ADD COLUMN background_expires_at timestamptz;
CREATE TABLE provider_reviews_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id uuid NOT NULL REFERENCES users,
  reviewer_id uuid NOT NULL REFERENCES users, before_state jsonb NOT NULL,
  after_state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_rate_limits (
  key_hash text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX auth_rate_limits_expiry ON auth_rate_limits(expires_at);

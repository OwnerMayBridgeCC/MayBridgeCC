ALTER TABLE provider_profiles
  ADD COLUMN headline text NOT NULL DEFAULT '',
  ADD COLUMN base_zip text,
  ADD COLUMN service_radius_miles integer NOT NULL DEFAULT 25 CHECK (service_radius_miles BETWEEN 1 AND 250),
  ADD COLUMN languages text[] NOT NULL DEFAULT '{}',
  ADD COLUMN education jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN work_history jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN certifications text[] NOT NULL DEFAULT '{}',
  ADD COLUMN admin_approval_status text NOT NULL DEFAULT 'pending' CHECK (admin_approval_status IN ('pending','approved','rejected','suspended')),
  ADD COLUMN background_check_status text NOT NULL DEFAULT 'not_started' CHECK (background_check_status IN ('not_started','pending','clear','consider','failed','expired')),
  ADD COLUMN background_check_reference text,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by uuid REFERENCES users(id),
  ADD COLUMN background_checked_at timestamptz;

CREATE INDEX provider_discovery_idx ON provider_profiles(admin_approval_status, background_check_status, base_zip);

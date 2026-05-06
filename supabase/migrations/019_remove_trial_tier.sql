-- Remove 'trial' as a valid tier and status value.
-- Any rows currently on trial are moved to free/active with no trial_end date.
-- Safe to run on a live database — no columns or rows are dropped.

-- 1. Migrate rows where tier = 'trial' to tier = 'free'
UPDATE subscriptions
  SET tier = 'free'
  WHERE tier = 'trial';

-- 2. Migrate rows where status = 'trial' to status = 'active'
UPDATE subscriptions
  SET status = 'active'
  WHERE status = 'trial';

-- 3. Clear trial_end on any rows that were on trial (no longer relevant)
UPDATE subscriptions
  SET trial_end = NULL
  WHERE trial_end IS NOT NULL
    AND tier = 'free'
    AND status = 'active';

-- 4. Drop the existing tier check constraint (includes 'trial')
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_tier_check;

-- 5. Re-add the constraint without 'trial'
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier IN ('free', 'basic', 'plus', 'pro'));

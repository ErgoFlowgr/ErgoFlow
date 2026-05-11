-- Grant full table access to service_role so the stripe-webhook edge function can UPDATE subscriptions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO service_role;

-- Lock down vapi_webhook_calls until VAPI is connected
-- Edge Functions use service_role which bypasses RLS, so no policies needed
alter table vapi_webhook_calls enable row level security;

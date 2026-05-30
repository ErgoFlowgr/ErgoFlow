// Shared webhook authentication helper for VAPI Edge Functions.
//
// Hardening over the previous inline approach:
//   1. Prefers `Authorization: Bearer <secret>` header (keeps secret out of
//      URL query strings, which leak into web server / proxy / browser logs).
//   2. Also accepts `x-vapi-secret: <secret>` header as an alternative.
//   3. Falls back to the legacy `?secret=…` query string so existing VAPI
//      webhook configurations keep working during migration.
//   4. Uses constant-time comparison to defeat any (theoretical) timing
//      side-channel on the equality check.
//
// Migration plan:
//   - Deploy this update (backward-compatible: nothing breaks).
//   - Update each VAPI webhook URL to send `Authorization: Bearer <secret>`
//     instead of `?secret=…`.
//   - In a later release, drop the query-string fallback.

/**
 * Constant-time string compare. Returns true only if both strings have the
 * same length AND every byte matches. Avoids the early-exit timing leak of
 * `===`. In practice the network jitter on Edge Functions makes timing
 * attacks on equality basically impossible anyway — but this is cheap.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/**
 * Extracts the candidate secret from the request, preferring headers over
 * the legacy query string. Returns null when no candidate is present.
 */
function extractCandidateSecret(req: Request): string | null {
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const vapiHeader = req.headers.get('x-vapi-secret') ?? req.headers.get('X-Vapi-Secret');
  if (vapiHeader) return vapiHeader.trim();
  const url = new URL(req.url);
  const queryParam = url.searchParams.get('secret');
  if (queryParam) return queryParam;
  return null;
}

/**
 * Verify an incoming webhook against the configured shared secret.
 * Returns a Response (401) when authentication fails, otherwise null.
 *
 * Usage:
 *   const unauthorized = verifyWebhookSecret(req, WEBHOOK_SECRET);
 *   if (unauthorized) return unauthorized;
 */
export function verifyWebhookSecret(req: Request, expected: string): Response | null {
  const candidate = extractCandidateSecret(req);
  if (!candidate || !constantTimeEqual(candidate, expected)) {
    return new Response('Unauthorized', { status: 401 });
  }
  return null;
}

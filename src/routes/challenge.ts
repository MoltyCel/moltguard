// Challenge-Response Holder Binding — Routes
import { Hono } from 'hono';

import { createChallenge, verifyBinding, registerPublicKey } from '../services/challenge.js';

const app = new Hono();

// GET /vc/challenge — Generate a new challenge nonce
app.get('/challenge', async (c) => {
  const did = c.req.query('did') || undefined;

  try {
    const challenge = await createChallenge(did);

    return c.json({
      nonce: challenge.nonce,
      expires_at: challenge.expires_at,
      message: 'Sign this nonce with the private key corresponding to your DID to prove holder binding.',
    });
  } catch (err: any) {
    console.error('[Challenge] Error generating challenge:', err);
    return c.json({ error: 'challenge_generation_failed', message: err.message }, 500);
  }
});

// POST /vc/verify-binding — Verify a signed challenge
app.post('/verify-binding', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const { did, nonce, signature } = body;

  // Validate required fields
  if (!did || typeof did !== 'string') {
    return c.json({ error: 'validation_error', message: 'did is required (string)' }, 422);
  }
  if (!nonce || typeof nonce !== 'string') {
    return c.json({ error: 'validation_error', message: 'nonce is required (hex string from /vc/challenge)' }, 422);
  }
  if (!signature || typeof signature !== 'string') {
    return c.json({ error: 'validation_error', message: 'signature is required (base64url-encoded Ed25519 signature)' }, 422);
  }

  try {
    const result = await verifyBinding(did, nonce, signature);

    if (result.verified) {
      return c.json({
        binding_verified: true,
        did: result.did,
        verified_at: result.verified_at,
        method: 'ed25519-challenge-response',
      });
    }

    return c.json({
      binding_verified: false,
      error: result.error,
      detail: result.detail,
    }, result.status as any);
  } catch (err: any) {
    console.error('[Challenge] Error verifying binding:', err);
    return c.json({ error: 'verification_failed', message: err.message }, 500);
  }
});

// POST /vc/register-key — Register a public key for an agent DID
app.post('/register-key', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const { did, publicKeyHex } = body;

  if (!did || typeof did !== 'string') {
    return c.json({ error: 'validation_error', message: 'did is required' }, 422);
  }
  if (!publicKeyHex || typeof publicKeyHex !== 'string') {
    return c.json({ error: 'validation_error', message: 'publicKeyHex is required (64 hex chars, Ed25519)' }, 422);
  }

  const success = await registerPublicKey(did, publicKeyHex);
  if (!success) {
    return c.json({ error: 'registration_failed', message: 'DID not found or invalid public key format (expected 64 hex chars)' }, 400);
  }

  return c.json({
    registered: true,
    did,
    algorithm: 'Ed25519',
    message: 'Public key registered. You can now use /vc/verify-binding to prove holder binding.',
  });
});

export default app;

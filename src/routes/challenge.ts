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

// POST /vc/register-key — Set or replace the public key of an agent DID.
//
// No key on record yet: authorised by the API key bound to the DID, sent as
// X-API-Key (E1 owner channel). Works exactly once per DID.
//
// Key already on record: requires proof of possession of that key —
//   proof: { nonce, signatureB64url }
// where nonce comes from GET /vc/challenge?did=<did> and the signature is made
// with the CURRENT key. An API key grants nothing on this path.
app.post('/register-key', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const { did, publicKeyHex, proof } = body;

  if (!did || typeof did !== 'string') {
    return c.json({ error: 'validation_error', message: 'did is required' }, 422);
  }
  if (!publicKeyHex || typeof publicKeyHex !== 'string') {
    return c.json({ error: 'validation_error', message: 'publicKeyHex is required (64 hex chars, Ed25519)' }, 422);
  }

  const apiKey = c.req.header('X-API-Key') ?? c.req.header('x-api-key') ?? null;

  const result = await registerPublicKey(did, publicKeyHex, proof ?? null, apiKey);
  if (!result.registered) {
    return c.json({ error: result.error, message: result.detail }, result.status as any);
  }

  return c.json({
    registered: true,
    did,
    algorithm: 'Ed25519',
    message: 'Public key registered. You can now use /vc/verify-binding to prove holder binding.',
  });
});

export default app;

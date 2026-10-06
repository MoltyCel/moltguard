// What this service has signed, asked back.
//
// A relying party that holds an attestation can ask whether it is still good
// without holding anything but the artefact: the digest of the signed body is
// the key, and the caller computes it from what it already has.
import { Hono } from 'hono';
import { lookupSignature, signaturesForSubject, revokeSignature, bodyDigest }
  from '../services/signatureRegister.js';

const app = new Hono();

/** The digest of a payload the caller already holds, so it need not send the body. */
app.post('/registry/digest', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'invalid_body', message: 'send the signed payload as JSON' }, 400);
  }
  return c.json({ body_digest: bodyDigest(body) });
});

app.get('/registry/signature/:digest', async (c) => {
  const digest = c.req.param('digest');
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    return c.json({ error: 'invalid_digest', message: 'expected 64 lowercase hex characters' }, 400);
  }
  const entry = await lookupSignature(digest);
  if (!entry) {
    // Not a judgement about the signature. This service began registering on
    // 2026-10-05; anything signed before that is absent because nothing wrote
    // it down, not because it was never issued.
    return c.json({
      body_digest: digest,
      status: 'unknown',
      message: 'no register entry. The register starts 2026-10-05; a signature '
             + 'issued before that is absent here whether or not it was issued.',
    }, 404);
  }
  return c.json(entry);
});

app.get('/registry/subject/:did', async (c) => {
  const entries = await signaturesForSubject(c.req.param('did'));
  return c.json({ subject_did: c.req.param('did'), count: entries.length, signatures: entries });
});

/** Revocation is an operator action, so it sits behind the internal auth. */
app.post('/internal/registry/revoke/:digest', async (c) => {
  const digest = c.req.param('digest');
  const { reason } = await c.req.json().catch(() => ({ reason: '' }));
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    return c.json({ error: 'invalid_digest' }, 400);
  }
  if (!reason || typeof reason !== 'string') {
    return c.json({ error: 'reason_required', message: 'a revocation without a reason is not one' }, 400);
  }
  const done = await revokeSignature(digest, reason);
  if (!done) {
    return c.json({ error: 'not_revocable', message: 'unknown digest, or already revoked' }, 404);
  }
  return c.json({ body_digest: digest, status: 'revoked', reason });
});

export default app;

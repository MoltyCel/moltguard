// FIX 1 (K2) — replacing a registered key requires proof of possession of the
// key currently on record; first-time registration is closed (E1).
//
// The signatures here are real Ed25519, produced by node:crypto and verified by
// the same code path production uses. Only the database layer is stubbed: the
// only Postgres reachable from this repo is the live one, and moltguard has no
// sandbox of its own.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateKeyPairSync, sign as edSign, randomBytes } from 'node:crypto';

const queryMock = vi.fn();
vi.mock('./db.js', () => ({
  query: (text: string, params?: any[]) => queryMock(text, params),
  default: {},
}));

const { registerPublicKey } = await import('./challenge.js');

// ── helpers ────────────────────────────────────────────────────────────────

function makeKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  // Ed25519 SPKI = 12-byte prefix + 32-byte raw key
  const hex = der.subarray(12).toString('hex');
  return { privateKey, publicKeyHex: hex };
}

function signNonce(privateKey: any, nonceHex: string): string {
  return edSign(null, Buffer.from(nonceHex, 'hex'), privateKey).toString('base64url');
}

const DID = 'did:moltrust:aaaabbbbccccdddd';

type World = {
  agentRow?: { public_key_hex: string | null } | null;
  challenge?: { id: number; did: string | null; expires_at: string; used: boolean } | null;
};

let world: World;
let updates: Array<{ text: string; params: any[] }>;

function installQueryHandler() {
  queryMock.mockImplementation(async (text: string, params: any[] = []) => {
    if (text.includes('SELECT public_key_hex FROM agents')) {
      return world.agentRow === null || world.agentRow === undefined
        ? { rows: [], rowCount: 0 }
        : { rows: [world.agentRow], rowCount: 1 };
    }
    if (text.includes('FROM vc_challenges WHERE nonce')) {
      return world.challenge
        ? { rows: [world.challenge], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (text.includes('UPDATE vc_challenges SET used')) {
      updates.push({ text, params });
      if (world.challenge) world.challenge.used = true;
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('UPDATE agents SET public_key_hex')) {
      updates.push({ text, params });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('DELETE FROM vc_challenges')) return { rows: [], rowCount: 0 };
    throw new Error(`unexpected query: ${text.slice(0, 60)}`);
  });
}

function freshChallenge(boundTo: string | null = DID) {
  const nonce = randomBytes(32).toString('hex');
  world.challenge = {
    id: 1,
    did: boundTo,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    used: false,
  };
  return nonce;
}

beforeEach(() => {
  world = {};
  updates = [];
  queryMock.mockReset();
  installQueryHandler();
});

// ── FIX 1 (K2): register-key ───────────────────────────────────────────────

describe('registerPublicKey', () => {
  it('refuses to overwrite an existing key without proof', async () => {
    const victim = makeKeypair();
    const attacker = makeKeypair();
    world.agentRow = { public_key_hex: victim.publicKeyHex };

    const result = await registerPublicKey(DID, attacker.publicKeyHex, null);

    expect(result.registered).toBe(false);
    if (!result.registered) {
      expect(result.error).toBe('proof_required');
      expect(result.status).toBe(401);
    }
    expect(updates.filter((u) => u.text.includes('UPDATE agents'))).toHaveLength(0);
  });

  it('refuses a proof signed with the attackers own key', async () => {
    const victim = makeKeypair();
    const attacker = makeKeypair();
    world.agentRow = { public_key_hex: victim.publicKeyHex };
    const nonce = freshChallenge();

    const result = await registerPublicKey(DID, attacker.publicKeyHex, {
      nonce,
      signatureB64url: signNonce(attacker.privateKey, nonce), // wrong key
    });

    expect(result.registered).toBe(false);
    if (!result.registered) expect(result.error).toBe('invalid_signature');
    expect(updates.filter((u) => u.text.includes('UPDATE agents'))).toHaveLength(0);
  });

  it('accepts a proof signed with the key currently on record', async () => {
    const current = makeKeypair();
    const replacement = makeKeypair();
    world.agentRow = { public_key_hex: current.publicKeyHex };
    const nonce = freshChallenge();

    const result = await registerPublicKey(DID, replacement.publicKeyHex, {
      nonce,
      signatureB64url: signNonce(current.privateKey, nonce),
    });

    expect(result.registered).toBe(true);
    const keyUpdate = updates.find((u) => u.text.includes('UPDATE agents'));
    expect(keyUpdate?.params[0]).toBe(replacement.publicKeyHex);
  });

  it('consumes the nonce so the same proof cannot be replayed', async () => {
    const current = makeKeypair();
    const first = makeKeypair();
    const second = makeKeypair();
    world.agentRow = { public_key_hex: current.publicKeyHex };
    const nonce = freshChallenge();
    const signature = signNonce(current.privateKey, nonce);

    const ok = await registerPublicKey(DID, first.publicKeyHex, { nonce, signatureB64url: signature });
    expect(ok.registered).toBe(true);

    const replay = await registerPublicKey(DID, second.publicKeyHex, { nonce, signatureB64url: signature });
    expect(replay.registered).toBe(false);
    if (!replay.registered) expect(replay.error).toBe('nonce_already_used');
  });

  it('locks first-time registration when no key is on record (E1)', async () => {
    const fresh = makeKeypair();
    world.agentRow = { public_key_hex: null };

    const result = await registerPublicKey(DID, fresh.publicKeyHex, null);

    expect(result.registered).toBe(false);
    if (!result.registered) {
      expect(result.error).toBe('first_registration_locked');
      expect(result.status).toBe(403);
    }
    expect(updates.filter((u) => u.text.includes('UPDATE agents'))).toHaveLength(0);
  });

  it('returns 404 for an unknown DID', async () => {
    const k = makeKeypair();
    world.agentRow = null;

    const result = await registerPublicKey(DID, k.publicKeyHex, null);
    expect(result.registered).toBe(false);
    if (!result.registered) expect(result.status).toBe(404);
  });

  it('rejects a malformed public key before touching the database', async () => {
    const result = await registerPublicKey(DID, 'not-hex', null);
    expect(result.registered).toBe(false);
    if (!result.registered) expect(result.error).toBe('invalid_public_key');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('refuses a nonce that was issued for a different DID', async () => {
    const current = makeKeypair();
    const replacement = makeKeypair();
    world.agentRow = { public_key_hex: current.publicKeyHex };
    const nonce = freshChallenge('did:moltrust:1111111111111111');

    const result = await registerPublicKey(DID, replacement.publicKeyHex, {
      nonce,
      signatureB64url: signNonce(current.privateKey, nonce),
    });

    expect(result.registered).toBe(false);
    if (!result.registered) expect(result.error).toBe('did_mismatch');
  });
});

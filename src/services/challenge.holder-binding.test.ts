// FIX 11 (H9) — a credential is only signed for a subject the caller can prove
// it holds the key for.
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

const { requireHolderBinding } = await import('./challenge.js');

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

// ── FIX 11 (H9): issuance gate ─────────────────────────────────────────────

describe('requireHolderBinding', () => {
  it('refuses issuance without a proof', async () => {
    const result = await requireHolderBinding(DID, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('proof_required');
      expect(result.status).toBe(401);
    }
  });

  it('refuses issuance for a DID the caller cannot sign for', async () => {
    const owner = makeKeypair();
    const attacker = makeKeypair();
    world.agentRow = { public_key_hex: owner.publicKeyHex };
    const nonce = freshChallenge();

    const result = await requireHolderBinding(DID, {
      nonce,
      signatureB64url: signNonce(attacker.privateKey, nonce),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_signature');
  });

  it('allows issuance for the key holder', async () => {
    const owner = makeKeypair();
    world.agentRow = { public_key_hex: owner.publicKeyHex };
    const nonce = freshChallenge();

    const result = await requireHolderBinding(DID, {
      nonce,
      signatureB64url: signNonce(owner.privateKey, nonce),
    });

    expect(result.ok).toBe(true);
  });

  it('refuses issuance when the subject has no key on record', async () => {
    world.agentRow = { public_key_hex: null };
    const nonce = freshChallenge();
    const stranger = makeKeypair();

    const result = await requireHolderBinding(DID, {
      nonce,
      signatureB64url: signNonce(stranger.privateKey, nonce),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('no_public_key');
  });
});

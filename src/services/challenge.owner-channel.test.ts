// E1 — the owner channel for first-time key registration.
//
// An agent with no key on record cannot prove possession of one, so possession
// cannot be the test. What can be tested is who holds the API key bound to that
// DID. The channel opens once per DID and only while public_key_hex is null;
// every later change goes back through K2 proof-of-possession.
//
// Ed25519 signatures below are real. Only the database layer is stubbed —
// moltguard has no sandbox database, MOLTGUARD_DB_URL points at the live one.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateKeyPairSync, sign as edSign, randomBytes } from 'node:crypto';

const queryMock = vi.fn();
vi.mock('./db.js', () => ({
  query: (text: string, params?: any[]) => queryMock(text, params),
  default: {},
}));

const { registerPublicKey } = await import('./challenge.js');

const DID = 'did:moltrust:aaaabbbbccccdddd';
const OTHER_DID = 'did:moltrust:1111222233334444';
const OWNER_KEY = 'mt_owner_key_abcdef0123456789';

function makeKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  return { privateKey, publicKeyHex: der.subarray(12).toString('hex') };
}

function signNonce(privateKey: any, nonceHex: string): string {
  return edSign(null, Buffer.from(nonceHex, 'hex'), privateKey).toString('base64url');
}

type World = {
  agentKey?: string | null;          // agents.public_key_hex
  apiKeys?: Array<{ key: string; owner_did: string | null; active: boolean }>;
  challenge?: { id: number; did: string | null; expires_at: string; used: boolean } | null;
  updateRowCount?: number;           // lets a test simulate losing the race
};

let world: World;
let writes: Array<{ text: string; params: any[] }>;

function install() {
  queryMock.mockImplementation(async (text: string, params: any[] = []) => {
    if (text.includes('SELECT public_key_hex FROM agents')) {
      return world.agentKey === undefined
        ? { rows: [], rowCount: 0 }
        : { rows: [{ public_key_hex: world.agentKey }], rowCount: 1 };
    }
    if (text.includes('FROM api_keys WHERE key')) {
      // The stub honours `AND active = TRUE` the way Postgres would.
      const match = (world.apiKeys ?? []).find(
        (k) => k.key === params[0] && k.active === true,
      );
      return match
        ? { rows: [{ key: match.key, owner_did: match.owner_did }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (text.includes('FROM vc_challenges WHERE nonce')) {
      return world.challenge ? { rows: [world.challenge], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (text.includes('UPDATE vc_challenges SET used')) {
      writes.push({ text, params });
      if (world.challenge) world.challenge.used = true;
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('UPDATE agents SET public_key_hex')) {
      writes.push({ text, params });
      return { rows: [], rowCount: world.updateRowCount ?? 1 };
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

const keyUpdates = () => writes.filter((w) => w.text.includes('UPDATE agents'));

beforeEach(() => {
  world = { apiKeys: [{ key: OWNER_KEY, owner_did: DID, active: true }] };
  writes = [];
  queryMock.mockReset();
  install();
});

// ── 1 — the case the channel exists for ─────────────────────────────────────

describe('E1 first registration', () => {
  it('registers the first key for the DID the API key is bound to', async () => {
    const fresh = makeKeypair();
    world.agentKey = null;

    const result = await registerPublicKey(DID, fresh.publicKeyHex, null, OWNER_KEY);

    expect(result.registered).toBe(true);
    const update = keyUpdates()[0];
    expect(update?.params[0]).toBe(fresh.publicKeyHex);
    expect(update?.text).toContain('public_key_hex IS NULL');
  });

  // ── 2 — a foreign key must not claim the identity ─────────────────────────

  it('refuses an API key bound to a different DID', async () => {
    const fresh = makeKeypair();
    world.agentKey = null;
    world.apiKeys = [{ key: OWNER_KEY, owner_did: OTHER_DID, active: true }];

    const result = await registerPublicKey(DID, fresh.publicKeyHex, null, OWNER_KEY);

    expect(result.registered).toBe(false);
    if (!result.registered) {
      expect(result.error).toBe('owner_key_mismatch');
      expect(result.status).toBe(403);
    }
    expect(keyUpdates()).toHaveLength(0);
  });

  // ── 3 — no key at all ─────────────────────────────────────────────────────

  it('refuses when no API key is presented', async () => {
    const fresh = makeKeypair();
    world.agentKey = null;

    const result = await registerPublicKey(DID, fresh.publicKeyHex, null, null);

    expect(result.registered).toBe(false);
    if (!result.registered) {
      expect(result.error).toBe('owner_key_required');
      expect(result.status).toBe(401);
    }
    expect(keyUpdates()).toHaveLength(0);
  });

  // ── 4 — unknown or deactivated key ────────────────────────────────────────

  it('refuses an unknown API key', async () => {
    const fresh = makeKeypair();
    world.agentKey = null;

    const result = await registerPublicKey(DID, fresh.publicKeyHex, null, 'mt_not_a_real_key');

    expect(result.registered).toBe(false);
    if (!result.registered) expect(result.error).toBe('owner_key_invalid');
    expect(keyUpdates()).toHaveLength(0);
  });

  it('refuses a deactivated API key even though it is bound to the DID', async () => {
    const fresh = makeKeypair();
    world.agentKey = null;
    world.apiKeys = [{ key: OWNER_KEY, owner_did: DID, active: false }];

    const result = await registerPublicKey(DID, fresh.publicKeyHex, null, OWNER_KEY);

    expect(result.registered).toBe(false);
    if (!result.registered) expect(result.error).toBe('owner_key_invalid');
    expect(keyUpdates()).toHaveLength(0);
  });

  it('refuses a valid but unbound API key', async () => {
    const fresh = makeKeypair();
    world.agentKey = null;
    world.apiKeys = [{ key: OWNER_KEY, owner_did: null, active: true }];

    const result = await registerPublicKey(DID, fresh.publicKeyHex, null, OWNER_KEY);

    expect(result.registered).toBe(false);
    if (!result.registered) expect(result.error).toBe('owner_key_invalid');
  });
});

// ── 5 — THE critical case: the API key must not unlock K2 ───────────────────

describe('the owner channel does not reach an existing key', () => {
  it('refuses to replace an existing key on a valid API key alone', async () => {
    const current = makeKeypair();
    const attacker = makeKeypair();
    world.agentKey = current.publicKeyHex;

    const result = await registerPublicKey(DID, attacker.publicKeyHex, null, OWNER_KEY);

    expect(result.registered).toBe(false);
    if (!result.registered) {
      expect(result.error).toBe('proof_required');
      expect(result.status).toBe(401);
    }
    expect(keyUpdates()).toHaveLength(0);
  });

  it('does not even consult api_keys once a key is on record', async () => {
    const current = makeKeypair();
    world.agentKey = current.publicKeyHex;

    await registerPublicKey(DID, makeKeypair().publicKeyHex, null, OWNER_KEY);

    const lookups = queryMock.mock.calls.filter((c) => String(c[0]).includes('FROM api_keys'));
    expect(lookups).toHaveLength(0);
  });

  it('still refuses a bad proof even with a valid API key', async () => {
    const current = makeKeypair();
    const attacker = makeKeypair();
    world.agentKey = current.publicKeyHex;
    const nonce = freshChallenge();

    const result = await registerPublicKey(DID, attacker.publicKeyHex, {
      nonce,
      signatureB64url: signNonce(attacker.privateKey, nonce),
    }, OWNER_KEY);

    expect(result.registered).toBe(false);
    if (!result.registered) expect(result.error).toBe('invalid_signature');
    expect(keyUpdates()).toHaveLength(0);
  });
});

// ── 6 — once only ───────────────────────────────────────────────────────────

describe('the channel closes after the first registration', () => {
  it('sends a second attempt down the K2 path', async () => {
    const first = makeKeypair();
    world.agentKey = null;

    expect((await registerPublicKey(DID, first.publicKeyHex, null, OWNER_KEY)).registered).toBe(true);

    // The row now carries a key, exactly as the database would after that write.
    world.agentKey = first.publicKeyHex;

    const second = await registerPublicKey(DID, makeKeypair().publicKeyHex, null, OWNER_KEY);
    expect(second.registered).toBe(false);
    if (!second.registered) expect(second.error).toBe('proof_required');
  });

  it('reports a lost race instead of overwriting the winner', async () => {
    const fresh = makeKeypair();
    world.agentKey = null;
    world.updateRowCount = 0; // the IS NULL guard matched nothing — someone won first

    const result = await registerPublicKey(DID, fresh.publicKeyHex, null, OWNER_KEY);

    expect(result.registered).toBe(false);
    if (!result.registered) {
      expect(result.error).toBe('already_registered');
      expect(result.status).toBe(409);
    }
  });
});

// ── 7 — K2 keeps working ────────────────────────────────────────────────────

describe('K2 replacement is unchanged', () => {
  it('replaces the key on a valid proof of the current one', async () => {
    const current = makeKeypair();
    const replacement = makeKeypair();
    world.agentKey = current.publicKeyHex;
    const nonce = freshChallenge();

    const result = await registerPublicKey(DID, replacement.publicKeyHex, {
      nonce,
      signatureB64url: signNonce(current.privateKey, nonce),
    }, null); // no API key needed on this path

    expect(result.registered).toBe(true);
    expect(keyUpdates()[0]?.params[0]).toBe(replacement.publicKeyHex);
  });

  it('still rejects a malformed public key before touching the database', async () => {
    const result = await registerPublicKey(DID, 'not-hex', null, OWNER_KEY);
    expect(result.registered).toBe(false);
    if (!result.registered) expect(result.error).toBe('invalid_public_key');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('still returns 404 for an unknown DID', async () => {
    world.agentKey = undefined; // no agents row at all
    const result = await registerPublicKey(DID, makeKeypair().publicKeyHex, null, OWNER_KEY);
    expect(result.registered).toBe(false);
    if (!result.registered) expect(result.status).toBe(404);
  });
});

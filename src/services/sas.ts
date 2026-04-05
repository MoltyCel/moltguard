/**
 * Sequential Action Safety (SAS) — Service
 * Deterministic pre-execution safety check for agent action sequences.
 * Spec: SAS Tech Spec v0.2 (April 2026)
 */

// --- Action Reversibility Tables ---

const ACTION_REVERSIBILITY: Record<string, number> = {
  DELETE: 1.0,
  PURGE: 1.0,
  REVOKE: 1.0,
  TERMINATE: 1.0,
  TRANSFER: 0.95,
  WRITE: 0.6,
  UPDATE: 0.5,
  READ: 0.0,
  LIST: 0.0,
  QUERY: 0.0,
};

const SCOPE_REVERSIBILITY: Record<string, number> = {
  'payments:write': 0.95,
  'credentials:write': 0.7,
  'data:write': 0.6,
  'governance': 0.5,
  'data:read': 0.0,
};

// --- Types ---

export interface ActionPayload {
  type: string;
  resource: string;
  scope?: string;
}

export interface SASResult {
  safe: boolean;
  residual: number;
  verdict: 'SAFE' | 'WARN' | 'BLOCK';
  reason: string | null;
  conflicting_action: ActionPayload | null;
}

// --- Resource Overlap ---

function resourceOverlap(pathA: string, pathB: string): number {
  const partsA = pathA.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const partsB = pathB.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  let common = 0;
  for (let i = 0; i < Math.min(partsA.length, partsB.length); i++) {
    if (partsA[i] === partsB[i]) {
      common++;
    } else {
      break; // Stop at first divergence
    }
  }

  if (common === 0) return 0.0;
  return common / Math.min(partsA.length, partsB.length);
}

// --- Safety Residual ---

function getReversibility(action: ActionPayload): number {
  const typeRev = ACTION_REVERSIBILITY[action.type.toUpperCase()];
  if (typeRev !== undefined) return typeRev;
  if (action.scope) {
    const scopeRev = SCOPE_REVERSIBILITY[action.scope];
    if (scopeRev !== undefined) return scopeRev;
  }
  return 0.5; // Unknown action default
}

const DESTRUCTIVE_ACTIONS = new Set(['DELETE', 'PURGE', 'TERMINATE']);

function computeSafetyResidual(proposed: ActionPayload, past: ActionPayload): number {
  const revProposed = getReversibility(proposed);
  const revPast = getReversibility(past);
  const overlap = resourceOverlap(proposed.resource || '', past.resource || '');

  if (overlap === 0.0) return 0.0;

  // Special rule: destructive action after read/write on same resource
  if (DESTRUCTIVE_ACTIONS.has(proposed.type.toUpperCase()) && revPast < 0.8) {
    return Math.min(0.9, (revProposed - revPast) * overlap * 2);
  }

  return Math.max(0.0, (revProposed - revPast) * overlap);
}

// --- Session Store ---

const sessions = new Map<string, { actions: ActionPayload[]; lastAccess: number }>();

// Cleanup sessions older than 1 hour
const SESSION_TTL_MS = 60 * 60 * 1000;

function cleanupSessions(): void {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL_MS) {
      sessions.delete(key);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupSessions, 10 * 60 * 1000);

// --- Main Check ---

const THRESHOLD_WARN = 0.3;
const THRESHOLD_BLOCK = 0.7;
const WARN_ONLY = true; // Phase 1: no automatic BLOCK

export function checkAction(proposed: ActionPayload, sessionId?: string): SASResult {
  const pastActions = sessionId ? (sessions.get(sessionId)?.actions ?? []) : [];

  let maxResidual = 0.0;
  let conflictAction: ActionPayload | null = null;

  for (const past of pastActions) {
    const r = computeSafetyResidual(proposed, past);
    if (r > maxResidual) {
      maxResidual = r;
      conflictAction = past;
    }
  }

  const roundedResidual = Math.round(maxResidual * 1000) / 1000;

  let verdict: 'SAFE' | 'WARN' | 'BLOCK';
  if (maxResidual >= THRESHOLD_BLOCK && !WARN_ONLY) {
    verdict = 'BLOCK';
  } else if (maxResidual >= THRESHOLD_WARN) {
    verdict = 'WARN';
  } else {
    verdict = 'SAFE';
  }

  // Add action to session (unless BLOCK in Phase 2)
  if (verdict !== 'BLOCK' && sessionId) {
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { actions: [], lastAccess: Date.now() });
    }
    const session = sessions.get(sessionId)!;
    session.actions.push(proposed);
    session.lastAccess = Date.now();
  }

  const reason = conflictAction
    ? `${proposed.type} on ${proposed.resource} conflicts with ${conflictAction.type} on ${conflictAction.resource}`
    : null;

  return {
    safe: verdict === 'SAFE',
    residual: roundedResidual,
    verdict,
    reason,
    conflicting_action: conflictAction,
  };
}

// --- Exports for testing ---

export { resourceOverlap, computeSafetyResidual, getReversibility };

# MT Shopping Protocol Specification

**Version:** 1.0.0
**Date:** 2026-03-05
**Status:** Draft
**Author:** MolTrust (CryptoKRI GmbH)

---

## 1. Overview

MT Shopping is MolTrust's trust layer for autonomous shopping agents. It enables merchants to verify that an incoming purchase request originates from a legitimate, human-authorized agent — independently of any single platform's ecosystem.

The protocol introduces **BuyerAgentCredentials** — W3C Verifiable Credentials that encode spend limits, currency restrictions, category scopes, and expiry — allowing merchants to trust autonomous agents without relying on platform-specific auth systems.

## 2. Roles

| Role | Description |
|------|-------------|
| **Human Principal** | The person who owns the wallet and authorizes the agent. Identified by a MolTrust DID. |
| **Buyer Agent** | The AI agent executing purchases on behalf of the human. Holds its own DID and a BuyerAgentCredential. |
| **Merchant** | Any e-commerce endpoint (Shopify store, API marketplace, etc.) that accepts agent purchases. |
| **MolTrust Issuer** | Issues and signs BuyerAgentCredentials. Anchors credential hashes on Base. |
| **MoltGuard** | Verifies credentials at transaction time. Returns signed VerificationReceipts. |

## 3. Flow

```
Human → requests Buyer Agent VC from MolTrust (sets spend limits)
MolTrust → issues signed BuyerAgentCredential, anchors hash on Base
Agent → stores VC in its DID document
Agent → initiates purchase at merchant
Merchant → calls MoltGuard POST /shopping/verify with agent DID + VC
MoltGuard → verifies signature, checks expiry, checks spend limits, checks trust score
MoltGuard → returns signed VerificationReceipt
Merchant → fulfills order, logs receipt
Base → VerificationReceipt hash written on-chain
```

### Sequence Diagram

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  Human   │   │  Agent   │   │ Merchant │   │MoltGuard │   │   Base   │
└────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘
     │  issue VC    │              │              │              │
     │─────────────>│              │              │              │
     │  VC signed   │              │              │              │
     │<─────────────│              │              │              │
     │              │  purchase    │              │              │
     │              │─────────────>│              │              │
     │              │              │  verify      │              │
     │              │              │─────────────>│              │
     │              │              │              │  anchor      │
     │              │              │              │─────────────>│
     │              │              │  receipt     │              │
     │              │              │<─────────────│              │
     │              │  confirmed   │              │              │
     │              │<─────────────│              │              │
```

## 4. BuyerAgentCredential Schema

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://moltrust.ch/schemas/shopping/v1"
  ],
  "type": ["VerifiableCredential", "BuyerAgentCredential"],
  "issuer": {
    "id": "did:web:moltrust.ch",
    "name": "MolTrust"
  },
  "issuanceDate": "2026-03-05T00:00:00Z",
  "expirationDate": "2026-06-03T00:00:00Z",
  "credentialSubject": {
    "id": "did:base:<agent-did>",
    "humanDID": "did:base:<human-did>",
    "authorization": {
      "spendLimit": 300,
      "currency": "USDC",
      "validFrom": "2026-03-05T00:00:00Z",
      "validUntil": "2026-06-03T00:00:00Z",
      "scope": {
        "categories": ["electronics", "books", "clothing"],
        "merchants": null,
        "maxTransactionsPerDay": 5
      }
    },
    "trustLevel": "verified",
    "issuedBy": "did:base:moltrust-issuer"
  },
  "proof": {
    "type": "JsonWebSignature2020",
    "created": "2026-03-05T00:00:00Z",
    "verificationMethod": "did:web:moltrust.ch#moltguard-key-1",
    "proofPurpose": "assertionMethod",
    "jws": "<Ed25519 JWS compact serialization>"
  }
}
```

## 5. VerificationReceipt Schema

```json
{
  "receiptId": "uuid-v4",
  "agentDID": "did:base:0x...",
  "humanDID": "did:base:0x...",
  "merchant": "merchant-domain",
  "amount": 299.00,
  "currency": "USDC",
  "guardScore": 87,
  "result": "approved",
  "reason": null,
  "timestamp": "2026-03-05T12:00:00Z",
  "onChainTx": "0x..."
}
```

### Result values

| Value | Meaning |
|-------|---------|
| `approved` | Transaction verified. Receipt anchored on-chain. |
| `rejected` | Verification failed. See `reason` field. |
| `review` | Agent trust score below threshold. Merchant decides. |

## 6. Threat Model — What MT Shopping Prevents

| Threat | Mitigation |
|--------|-----------|
| **Agent hijacking** | VC is bound to specific agentDID + humanDID. Stolen agent cannot use another human's VC. |
| **Unauthorized spend** | VC encodes spendLimit, currency, and per-day transaction caps. MoltGuard enforces at verification. |
| **Spoofed agents** | Agents without valid DID or VC are rejected. Ed25519 signature verification prevents forgery. |
| **Replay attacks** | VC has expiry (validUntil). Each VerificationReceipt has a unique receiptId (nonce). |
| **Sybil merchants** | Future: only verified merchant DIDs accepted. Currently: merchant identity logged in receipt. |
| **Overspend via multiple merchants** | Per-day transaction cap in scope. Future: global spend tracking via on-chain state. |

## 7. API Endpoints

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/shopping/schema` | GET | Returns BuyerAgentCredential JSON schema | Free |
| `/shopping/verify` | POST | Verifies agent VC and returns receipt | Free (early access) |
| `/shopping/receipt/:id` | GET | Retrieves a verification receipt by ID | Free |
| `/vc/buyer-agent/issue` | POST | Issues a new BuyerAgentCredential | API key |

## 8. Integration Guide

### For Merchants

```typescript
// At checkout, verify the agent's credential
const response = await fetch('https://api.moltrust.ch/guard/shopping/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentDID: order.agentDID,
    vc: order.buyerAgentVC,
    merchant: 'your-domain.com',
    amount: order.total,
    currency: 'USDC'
  })
});

const receipt = await response.json();
if (receipt.result === 'approved') {
  // Fulfill order
}
```

### For Agent Developers

```typescript
// 1. Request a BuyerAgentCredential
const vc = await fetch('https://api.moltrust.ch/guard/vc/buyer-agent/issue', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentDID: myDID,
    humanDID: ownerDID,
    spendLimit: 300,
    currency: 'USDC',
    validDays: 7,
    categories: ['electronics']
  })
});

// 2. Include VC in purchase requests
const order = await merchantAPI.checkout({
  agentDID: myDID,
  vc: vc,
  itemId: 'product-123',
  amount: 249,
  currency: 'USDC'
});
```

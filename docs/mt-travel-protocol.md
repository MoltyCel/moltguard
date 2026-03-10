# MT Travel Protocol Specification v1.0

## Overview

MT Travel is MolTrust's trust layer for autonomous travel booking agents. It verifies that hotel, flight, and car rental bookings originate from legitimately authorized agents — independent of any single OTA (Online Travel Agency) or GDS (Global Distribution System) platform.

## Roles

| Role | Description |
|------|-------------|
| **Human Principal / Company** | Authorizes the agent, sets travel policy (budget, cabin class, destinations) |
| **Travel Agent (AI)** | Executes bookings on behalf of the principal |
| **Intermediary** (optional) | Travel agency or corporate travel manager with delegated authority |
| **Travel Merchant** | Hotel, airline, car rental API endpoint |
| **MolTrust Issuer** | Issues and signs TravelAgentCredentials |
| **MoltGuard** | Verifies credentials at booking time, issues on-chain receipts |

## Protocol Flow

### Standard Flow (Individual)
```
Human Principal → requests TravelAgentCredential
MolTrust → issues signed VC, anchors on Base
Travel Agent → presents VC to hotel API → MoltGuard verifies → BookingReceipt
```

### Delegation Chain Flow (Corporate)
```
Company HR System
  → requests TravelAgentCredential for Corporate Travel AI
    → employee name, passport hash, cabin class limits, budget
MolTrust → issues signed TravelAgentCredential, anchors on Base
Travel Agent → initiates hotel + flight booking for employee trip
  → presents VC to hotel API   → MoltGuard verifies → BookingReceipt (segment: hotel)
  → presents VC to airline API → MoltGuard verifies → BookingReceipt (segment: flight)
  → presents VC to car rental  → MoltGuard verifies → BookingReceipt (segment: car_rental)
All three BookingReceipts anchored on Base under same tripId
```

### Sequence Diagram
```
Principal       MolTrust       Agent          Merchant       MoltGuard       Base
    |               |            |               |               |            |
    |--issue VC---->|            |               |               |            |
    |               |--sign+anchor-------------->|               |            |
    |               |<--VC------ |               |               |            |
    |               |            |               |               |            |
    |               |            |--book+VC----->|               |            |
    |               |            |               |--verify VC--->|            |
    |               |            |               |               |--anchor--->|
    |               |            |               |<--receipt-----|            |
    |               |            |<--confirmed---|               |            |
```

## TravelAgentCredential Schema

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://moltrust.ch/schemas/travel/v1"
  ],
  "type": ["VerifiableCredential", "AuthorizedAgentCredential", "TravelAgentCredential"],
  "credentialSubject": {
    "id": "did:base:<agent-did>",
    "principalDID": "did:base:<human-or-company-did>",
    "delegationChain": ["did:base:<intermediary-did>"],
    "authorization": {
      "vertical": "travel",
      "validFrom": "2026-03-05T00:00:00Z",
      "validUntil": "2026-06-05T00:00:00Z",
      "spendLimit": 5000,
      "currency": "USDC",
      "maxTransactionsPerDay": 10,
      "travel": {
        "segments": ["hotel", "flight", "car_rental"],
        "cabinClass": ["economy", "business"],
        "hotelMaxStarRating": 5,
        "advanceBookingDays": 90,
        "travelers": [
          { "name": "Lars Müller", "passportHash": "sha256:abc...", "type": "adult" }
        ],
        "allowedMerchants": null,
        "allowedDestinations": ["DE", "CH", "NL"]
      }
    },
    "trustLevel": "verified",
    "issuedBy": "did:web:moltrust.ch"
  }
}
```

## BookingReceipt Schema

```json
{
  "receiptId": "uuid",
  "tripId": "uuid",
  "agentDID": "did:base:...",
  "principalDID": "did:base:...",
  "delegationChain": [],
  "merchant": "booking.com",
  "segment": "hotel",
  "amount": 450.00,
  "currency": "USDC",
  "guardScore": 91,
  "result": "approved",
  "timestamp": "2026-03-05T12:00:00Z",
  "onChainTx": "0x..."
}
```

## Verification Checks

MoltGuard performs these checks in order:

1. **Type check** — VC must include `TravelAgentCredential` type
2. **Signature check** — Ed25519 JWS verification
3. **Expiry check** — `validUntil` must be in the future
4. **Not-before check** — `validFrom` must be in the past
5. **Spend limit** — Transaction amount must not exceed `spendLimit`
6. **Currency match** — Must match VC currency
7. **Segment authorization** — Booking segment must be in `segments` list
8. **Traveler validation** — If travelers provided, must match VC traveler manifest
9. **Daily limit** — Must not exceed `maxTransactionsPerDay`
10. **Trust score** — Agent wallet scored 0-100; <20 rejected, 20-49 review, 50+ approved

## Threat Model

| Threat | Mitigation |
|--------|------------|
| Unauthorized agent booking outside travel policy | Segment, cabin class, and budget constraints in VC |
| Booking for unlisted travelers | Traveler manifest validation against VC |
| Spoofed corporate travel agents | Delegation chain with cryptographic DID verification |
| Overbooking attacks | maxTransactionsPerDay limit per agent |
| Cross-merchant replay attacks | Unique receiptId per segment, tripId grouping |
| Rogue intermediary in delegation chain | Each DID in chain verifiable, chain anchored in VC |
| Budget overruns across segments | Per-transaction spend limit (per-trip aggregation in v2) |

## API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/travel/schema` | TravelAgentCredential JSON schema | Free |
| GET | `/travel/info` | Service info | Free |
| GET | `/travel/receipt/:id` | Retrieve booking receipt | Free |
| GET | `/travel/trip/:tripId` | All receipts for a trip | Free |
| POST | `/travel/verify` | Verify travel booking | Early Access |
| POST | `/vc/travel-agent/issue` | Issue TravelAgentCredential | Early Access |

## Integration Guide

### For Travel Merchants (Hotels, Airlines, Car Rentals)

```javascript
// Before fulfilling any AI agent booking:
const receipt = await fetch('https://api.moltrust.ch/guard/travel/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentDID: booking.agentDID,
    vc: booking.credential,
    merchant: 'your-hotel.com',
    segment: 'hotel',
    amount: booking.totalPrice,
    currency: 'USDC',
    tripId: booking.tripId,
    travelers: booking.guests
  })
}).then(r => r.json());

if (receipt.result === 'approved') {
  // Fulfill booking, store receipt.onChainTx for audit
}
```

### For Corporate Travel Managers

Issue TravelAgentCredentials with company-wide policies:

```javascript
const vc = await fetch('https://api.moltrust.ch/guard/vc/travel-agent/issue', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentDID: 'did:base:corporate-travel-ai',
    principalDID: 'did:base:company-did',
    delegationChain: ['did:base:hr-manager-did'],
    spendLimit: 3000,
    currency: 'USDC',
    validDays: 30,
    segments: ['hotel', 'flight'],
    cabinClass: ['economy'],
    travelers: [{ name: 'Lars Müller', type: 'adult' }],
    allowedDestinations: ['DE', 'CH', 'NL']
  })
}).then(r => r.json());
```

# FIX-REPORT — moltguard, Security-Review 2026-08-31

Branch `security/hardening-2026-08`, ab `origin/main` = `1ed2c08` (28.07.).
Phase 1 des Console-Auftrags, Reihenfolge nach realem Risiko: K2 → H9 → H3.

Kein Merge, kein Deploy. Der Branch ist PR-ready.

## Vorbedingung

`origin/main` steht seit dem 28.07. auf `1ed2c08` — älter als der Review. Der
deployte Baum `/home/moltstack/moltguard` steht auf demselben Commit, `git
status` sauber, `dist/` gebaut am 28.07. um 11:49. Geprüfter Stand = HEAD =
laufender Stand.

## Erledigt

| FIX | Fund | Commit |
|---|---|---|
| FIX 1 | 🔴 K2 — `/vc/register-key`: Key-Takeover ohne Auth und ohne PoP | `129e850` |
| FIX 11 | 🟠 H9 — VC-Issuance ohne Subjekt-Nachweis (travel + shopping) | `2762a5d` |
| FIX 9 | 🟠 H3 — x402-Receipt fakebar, dazu Hackathon-Bypass vor der Preisprüfung | `65710c5` |
| FIX 6 | 🟠 H5 — `/hackathon/register` gibt bestehende Keys aus | `1f0b4af` |

```
npx tsc --noEmit   → sauber
npx vitest run     → 5 Dateien, 36 passed
                     (25 neu, 11 bestehend)
```

Die Signaturen in den Binding-Tests sind echtes Ed25519 aus `node:crypto`,
verifiziert durch denselben Codepfad, den die Produktion nutzt. Gemockt ist nur
die DB-Schicht und der Chain-Client. Grund: die einzige von diesem Repo aus
erreichbare Postgres ist die Live-Datenbank — moltguard hat keine eigene
Sandbox, und `MOLTGUARD_DB_URL` zeigt auf `moltstack`.

## FIX 1 — Korrektur am Playbook

Schritt 1a des Playbooks (`/vc/register-key` aus `X402_FREE_PATHS` entfernen)
ist wirkungslos. Die Middleware fällt bei jedem Pfad ohne Preiseintrag durch:

```ts
const price = getPrice(method, path);
if (price === null) return next();   // kein Preis = frei
```

Das Entfernen aus der Free-Liste gated die Route also nicht. Das Gate sitzt im
Service.

`verifyBinding` prüft bereits Nonce-Gültigkeit, Ablauf, Einmalnutzung, das DID
der Challenge und die Ed25519-Signatur gegen den *aktuell hinterlegten*
Schlüssel — genau Proof-of-Possession des zu ersetzenden Keys. Der Fix ist
Wiederverwendung, keine neue Krypto.

Erst-Registrierung ist gesperrt (E1, deine Entscheidung).

**Blast-Radius:** 2 von 98 Agents haben überhaupt einen `public_key_hex`,
`vc_challenges` enthält 2 Zeilen mit 0 benutzten. Der Flow ist produktiv
praktisch ungenutzt; die Sperre bricht heute nichts.

## FIX 9 — keine neue Abhängigkeit nötig

Der Auftrag erlaubte eine neue Dependency. Es braucht keine: `viem` und der
Base-RPC werden bereits in `services/chain.ts` verwendet, und die Verifikation
läuft über `getTransactionReceipt` plus Dekodierung der USDC-`Transfer`-Logs.

Nebenbefund für Phase 2 oder später: **`@x402/evm`, `@x402/hono`, `@x402/core`
und `@x402/extensions` stehen bereits in `package.json` und sind installiert —
verwendet wird keines davon.** `@x402/hono` exportiert
`paymentMiddlewareFromConfig(routes, facilitatorClients, schemes, …)`, also
genau die protokollkonforme Server-Middleware, die die handgeschriebene
ersetzen würde. Der Review notiert unter E4 „x402 ohne neues Paket … bis die
Dependency-Entscheidung getroffen ist" — die Entscheidung ist längst getroffen,
die Pakete liegen ungenutzt im Baum.

Ich habe sie **nicht** eingebaut. Der Umstieg tauscht das gesamte
Zahlungsprotokoll (402-Antwortform, akzeptiertes Header-Format, EIP-3009-
Autorisierungen statt TX-Hashes) und lässt sich ohne Facilitator und zahlenden
Client nicht end-to-end prüfen. Das gehört als eigener Vorgang entschieden.

### Vertragsänderung für zahlende Clients

Feldbasierte Receipts ohne `txHash` werden jetzt mit 402 und
`paymentError: missing_tx_hash` abgewiesen. Ein Client muss on-chain zahlen und
den Transaktions-Hash vorlegen.

Belastbarkeit dieser Änderung: auf den `/vc/*-agent/issue`-Routen steht im
`request_log` über den gesamten Zeitraum kein einziger 2xx — nur 404er von
Aufrufen gegen die API statt gegen `/guard/*`. Eine erfolgreiche Ausstellung
hat es nie gegeben. Auf den bepreisten Leseendpunkten stehen in 30 Tagen 788
mal 200 gegen 731 mal 402; welcher Anteil davon über Hackathon-Keys lief, lässt
sich aus dem Log nicht trennen.

### Neue Tabelle

`x402_receipts(tx_hash PK, path, amount_usdc, seen_at)`, idempotent per
`CREATE TABLE IF NOT EXISTS` beim ersten Zugriff angelegt. Kein Migrationslauf
nötig, keine Änderung an bestehenden Tabellen.

## FIX 6 — aus Phase 2 vorgezogen

Der Hackathon-Pfad hing an FIX 9: die Waiver-Prüfung lief **vor** der
Preisermittlung, ein `mt_hack_`-Key umging damit jeden bepreisten Endpoint
einschließlich der 5-USDC-Credential-Routen. `/hackathon/register` gibt jeder
unverifizierten E-Mail-Adresse einen 72-Stunden-Key. Ohne beide Teile zusammen
wäre FIX 9 wirkungslos geblieben.

Der Waiver greift jetzt erst nach der Preisermittlung und nie auf
Issuance-Routen. `/hackathon/register` antwortet auf eine bekannte Adresse mit
409 und Ablaufdatum, ohne Schlüsselmaterial.

Live-Stand: 7 Keys angelegt, davon 0 gültig — der Weg war kalt, aber offen.

## Reihenfolge-Kopplung, die eingehalten wurde

FIX 11 ruft `verifyBinding`, das einen registrierten Schlüssel voraussetzt.
FIX 1 schränkt genau die Registrierung ein. Bei 2 von 98 Agents mit Schlüssel
heißt das: solange E1 gilt, kann nur wer bereits einen Schlüssel hat ein
Credential beziehen. Der Eigentümer-Kanal für Erst-Registrierungen ist damit
Voraussetzung für die Nutzbarkeit der Issuance-Routen und sollte vor einem
Deploy stehen.

## Offen (nicht in diesem Branch)

- **Eigentümer-Kanal für Erst-Registrierung** — Folge aus E1, siehe oben.
- **Umstieg auf `@x402/hono`** — die Pakete liegen bereit, der Protokollwechsel
  ist eine eigene Entscheidung.
- **Restliche moltguard-MITTEL** (M4 `timingSafeEqual` in `auth.ts`/`hackathon.ts`,
  M9 Trusted-Proxy-CIDR in `rateLimit.ts`, M13 TS-KMS-Prod-Gate, R3-E Rate-Limit
  auf `/internal/auth/login`, R3-F `UNSIGNED_`-Fallback in `credential.ts`) —
  Phase 2 und 3.

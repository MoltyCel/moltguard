# SKILL_HASH_SPEC — Canonical Skill Hashing Algorithm v1.0

## Purpose

This specification defines the canonical hashing algorithm used by MT Skill Verification to produce a deterministic SHA-256 hash of a SKILL.md file. Any party can independently reproduce the hash to verify integrity.

## Algorithm

### Input
- The raw `SKILL.md` file content as a byte sequence (UTF-8 encoded).

### Normalization Steps (applied in order)

1. **Decode to UTF-8 string**
2. **Strip BOM** — Remove Unicode BOM (`U+FEFF`) if present at position 0
3. **Normalize line endings** — Replace `\r\n` and standalone `\r` with `\n`
4. **Trim trailing whitespace** — For each line, remove trailing spaces and tabs
5. **Collapse blank lines** — Replace sequences of 2+ consecutive blank lines with a single blank line
6. **Strip boundaries** — Remove leading and trailing blank lines from the entire document
7. **Unicode NFC** — Normalize Unicode to NFC form (Canonical Decomposition, followed by Canonical Composition)

### Hashing

- Compute SHA-256 over the normalized content encoded as UTF-8 bytes
- Output format: `sha256:<64-hex-lowercase-chars>`

## Reference Implementation — TypeScript

```typescript
import { createHash } from 'node:crypto';

export function canonicalSkillHash(raw: string): string {
  let s = raw;
  // 1. Strip BOM
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  // 2. Normalize line endings
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // 3. Trim trailing whitespace per line
  s = s.split('\n').map(line => line.replace(/[\t ]+$/, '')).join('\n');
  // 4. Collapse consecutive blank lines
  s = s.replace(/\n{3,}/g, '\n\n');
  // 5. Strip leading/trailing blank lines
  s = s.replace(/^\n+/, '').replace(/\n+$/, '');
  // 6. NFC normalization
  s = s.normalize('NFC');
  // 7. SHA-256
  const hash = createHash('sha256').update(s, 'utf8').digest('hex');
  return `sha256:${hash}`;
}
```

## Reference Implementation — Python

```python
import hashlib
import unicodedata

def canonical_skill_hash(raw: str) -> str:
    s = raw
    # 1. Strip BOM
    if s and s[0] == '\ufeff':
        s = s[1:]
    # 2. Normalize line endings
    s = s.replace('\r\n', '\n').replace('\r', '\n')
    # 3. Trim trailing whitespace per line
    s = '\n'.join(line.rstrip(' \t') for line in s.split('\n'))
    # 4. Collapse consecutive blank lines
    import re
    s = re.sub(r'\n{3,}', '\n\n', s)
    # 5. Strip leading/trailing blank lines
    s = s.strip('\n')
    # 6. NFC normalization
    s = unicodedata.normalize('NFC', s)
    # 7. SHA-256
    h = hashlib.sha256(s.encode('utf-8')).hexdigest()
    return f'sha256:{h}'
```

## Versioning

This is version 1.0.0 of the canonical hashing algorithm. The `auditorVersion` field in VerifiedSkillCredentials records which version was used. Future versions will be backwards-compatible or clearly versioned.

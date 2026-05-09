# Field-Level Encryption — User PII

## Background

User PII (email, full name, phone number, address) is stored encrypted in the database. The goal: if the database is leaked, an attacker cannot read user data directly.

The challenge: some fields must still be queryable (login by email, name search in the admin panel), while standard encryption produces a different output each time — making `WHERE` conditions impossible.

Two different techniques are used depending on the field's query requirements.

---

## Techniques Used

### 1. AES-256-GCM (Authenticated Encryption)

Used to store the actual value securely so it can be decrypted and displayed.

- Each encryption call produces different output (random 12-byte IV).
- Output is stored as `iv:authTag:ciphertext` (Base64).
- Decryption requires `FIELD_ENCRYPTION_KEY` (32 bytes / 64 hex chars).
- **If the key is lost, data cannot be recovered.**

Applied to: `email_encrypted`, `full_name`, `phone_number`, `address`.

### 2. HMAC-SHA256 (Blind Index)

Used to create a deterministic fingerprint of the original value — the same input always produces the same output, so it can be used as a `WHERE` condition in the database.

- Output is a 64-character hex string.
- One-way — cannot be reversed.
- Requires `BLIND_INDEX_KEY` (32 bytes / 64 hex chars, **different** from the encryption key).

Applied to: `email` (primary column), `full_name_tokens`.

---

## `users` Table Column Layout

| Column | Type | Content | Purpose |
|--------|------|---------|---------|
| `email` | `VARCHAR UNIQUE` | `HMAC(normalizeEmail(email))` | Login, duplicate check, forgot password |
| `email_encrypted` | `VARCHAR` | `AES-GCM(email)` | Display to user/admin after decryption |
| `full_name` | `VARCHAR` | `AES-GCM(fullName)` | Display to user/admin after decryption |
| `full_name_tokens` | `VARCHAR[]` | `[HMAC(word1), HMAC(word2), …]` | Name search in admin panel |
| `phone_number` | `VARCHAR NULL` | `AES-GCM(phoneNumber)` | Display after decryption |
| `address` | `VARCHAR NULL` | `AES-GCM(address)` | Display after decryption |
| `deleted_at` | `TIMESTAMPTZ NULL` | Set on soft delete | Blocks login; excludes row from all list queries |

### Why does `email` store HMAC instead of the real email?

The `email` column needs a `UNIQUE` constraint and is frequently used in `WHERE email = ?`. AES-GCM cannot satisfy this because its output is always different. HMAC satisfies both: deterministic and indexable.

The real email is still stored in `email_encrypted` for display purposes.

### Why is `full_name_tokens` an array?

Encrypted `full_name` cannot be queried with `LIKE '%john%'`. The solution: the name is split per word, each word is HMACed, and the results are stored as a PostgreSQL array.

When an admin searches "John Smith":
1. `"john"` → `HMAC("john")` → `a3f8c2d1…`
2. `"smith"` → `HMAC("smith")` → `c2d1e9b4…`
3. Query: `WHERE full_name_tokens @> ARRAY['a3f8c2d1…', 'c2d1e9b4…']`

This supports word-level matching (search by word), not substring matching. An acceptable trade-off for an admin panel.

---

## Login Flow

```
User types email → normalizeEmail() → HMAC (blind index)
                                           ↓
                          WHERE email = <blind_index>
                                           ↓
                              User row found in DB
                                           ↓
                        decryptField(emailEncrypted) → real email
                        decryptField(fullName)        → real name
```

The user always types a plain email. Normalization and hashing happen on the server before the DB query.

---

## Registration Flow

```
Input: { email, fullName, phoneNumber, address }
           ↓
encryptUserFields()
           ↓
Store in DB:
  email          = HMAC(normalizeEmail(email))
  emailEncrypted = AES-GCM(email)
  fullName       = AES-GCM(fullName)
  fullNameTokens = [HMAC("word1"), HMAC("word2"), …]
  phoneNumber    = AES-GCM(phoneNumber)   // if provided
  address        = AES-GCM(address)       // if provided
```

The values returned to the caller (to send by email) are plaintext from the input — not the stored DB values.

---

## Environment Variables

| Variable | Length | Purpose |
|----------|--------|---------|
| `FIELD_ENCRYPTION_KEY` | 64 hex chars (32 bytes) | AES-256-GCM encryption/decryption |
| `BLIND_INDEX_KEY` | 64 hex chars (32 bytes) | HMAC-SHA256 blind indexes |

Generate with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Run twice and use a different output for each key.

**Important:**
- Both keys must differ from each other.
- Never commit keys to git.
- Back them up securely — if lost, all encrypted user data becomes unrecoverable.
- If a key needs to be rotated, all encrypted data in the DB must be re-encrypted first (no rotation script exists yet).

---

## Key Files

| File | Description |
|------|-------------|
| `src/utils/field-encryption.ts` | Crypto primitives: `encryptField`, `decryptField`, `computeBlindIndex` |
| `src/utils/user-crypto.ts` | User-specific helpers: `encryptUserFields`, `decryptUser`, `emailToBlindIndex` |
| `src/config/env.ts` | Validates `FIELD_ENCRYPTION_KEY` and `BLIND_INDEX_KEY` at startup |
| `prisma/schema.prisma` | Defines `emailEncrypted` and `fullNameTokens` columns on the `User` model |

---

## Known Limitations

| Feature | Status |
|---------|--------|
| Login by email | ✅ Works (via blind index) |
| Name search per word | ✅ Works (via token array) |
| Name substring search | ❌ Not supported |
| Partial email search | ❌ Exact match only |
| Key rotation | ❌ Not yet implemented (requires data migration script) |

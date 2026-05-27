# Authentication System

## Overview

Aspire uses a dual-token authentication system:

| Token | Lifetime | Purpose |
|-------|----------|---------|
| Access token (JWT) | 15 minutes | Proves identity on every authenticated request |
| Refresh token (opaque) | 7 days | Used only to rotate into a new token pair |

Every session is represented by one row in `refresh_tokens`. The access-token `jti` must match an active, non-expired refresh-token row for authenticated requests to continue.

---

## Current Auth Policy

- Self-registration is only for parents. A parent registration creates the parent account and one or more student accounts in one DB transaction.
- Tutor and admin accounts are not self-registered — they must be created by an admin via `POST /api/v1/admin/users`.
- Email addresses are normalized with `trim().toLowerCase()` before any create/login lookup.
- Single-device login is intentional: a successful login revokes the user's previous active sessions.
- v1 onboarding sends auto-generated passwords by email. Production should move to invite/set-password links when that product decision changes.
- **Soft delete**: deleting a user sets `deleted_at` on the `users` row and revokes all their refresh tokens immediately. The row is never physically removed. Deleted users cannot log in (403) and are excluded from all list queries.

---

## JWT Token Structure

The JWT payload is intentionally minimal. Email and name are **never** stored in the token.

```json
{
  "sub":  "uuid-of-the-user",
  "role": "STUDENT | PARENT | TUTOR | ADMIN",
  "jti":  "uuid-identifying-this-session",
  "iat":  1700000000,
  "exp":  1700000900
}
```

| Claim | Type | Description |
|-------|------|-------------|
| `sub` | `string` | User ID. Used to identify the user on every request (`request.user.sub`). |
| `role` | `string` | User role. Used by `requireRole()` preHandlers for RBAC. |
| `jti` | `string` | Session identifier. Linked to exactly one `refresh_tokens` row. Invalidating the row immediately kills the session. |
| `iat` | `number` | Issued-at timestamp (set automatically by `@fastify/jwt`). |
| `exp` | `number` | Expiry timestamp (set from `JWT_EXPIRES_IN` env var). |

Profile data (full name, email, status, subscriptions) is always fetched fresh from the database via `GET /api/v1/users/me`, never read from the token.

---

## Token Storage and Transport

### Why HttpOnly cookies only

Tokens are **never** exposed in response bodies or JavaScript-accessible storage. They travel exclusively as `HttpOnly; SameSite=Lax` cookies. This prevents XSS attacks from stealing tokens even if arbitrary JavaScript executes on the page.

### Two-layer cookie architecture

The frontend (Next.js) and backend (Fastify) run on different domains. Browsers only send cookies to the domain that set them, so the Next.js proxy layer intercepts the backend's `Set-Cookie` headers, extracts the token values, and re-issues them under its own domain.

| Cookie name | Set by | Domain | Path | MaxAge | Content |
|-------------|--------|--------|------|--------|---------|
| `access_token` | Fastify (backend) | backend domain | `/` | 15 min | signed JWT |
| `refresh_token` | Fastify (backend) | backend domain | `/api/v1/auth/refresh` | 7 days | opaque random token |
| `aspire_access_token` | Next.js (frontend) | frontend domain | `/` | 15 min | same JWT value |
| `aspire_refresh_token` | Next.js (frontend) | frontend domain | `/` | 7 days | same opaque value |

The backend cookies are read by `authProxy.ts`, which extracts their values from `Set-Cookie` headers and re-issues them as `aspire_*` cookies via `setAuthCookies()`. The browser only ever sees and stores the `aspire_*` cookies.

> Note: `aspire_refresh_token` is set on path `/` (not restricted to `/api/auth/refresh`) so the Next.js proxy can gate dashboard route checks. Forwarding protection is handled in code: `serverBackend.ts` only includes the refresh token in the `Cookie` header when the backend path is exactly `/auth/refresh`.

---

## Frontend–Backend Communication Flow

```
Browser
  │
  │  1. API call via mdwClient (axios, withCredentials: true)
  │     Cookies aspire_access_token + aspire_refresh_token sent automatically
  ▼
Next.js API Route (/api/...)
  │
  │  2. serverBackend.ts reads aspire_access_token from cookie,
  │     sends it as   Authorization: Bearer <token>   to backend
  │     (for /auth/refresh, also sends aspire_refresh_token as Cookie header)
  ▼
Fastify Backend (/api/v1/...)
  │
  │  3. fastify.authenticate reads JWT from Authorization header,
  │     validates signature + DB session row + user status + deletedAt
  │
  │  4. Response includes Set-Cookie: access_token + refresh_token
  ▼
Next.js API Route (response path)
  │
  │  5. authProxy.ts extracts values from Set-Cookie headers,
  │     calls setAuthCookies() to write aspire_* cookies onto the response
  ▼
Browser
     6. Browser stores aspire_access_token + aspire_refresh_token as HttpOnly cookies
```

### Key frontend files

| File | Role |
|------|------|
| `src/lib/mdwClient.ts` | Axios instance used by all client-side service calls. Sets `withCredentials: true` so cookies are sent automatically. Contains the 401 interceptor that triggers silent refresh. |
| `src/lib/serverBackend.ts` | Used by Next.js API route handlers (server-side). Reads `aspire_access_token` from the incoming cookie header and forwards it as an `Authorization: Bearer` header to the backend. |
| `src/lib/authProxy.ts` | Used by auth API routes (`/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`). Calls the backend, extracts `access_token`/`refresh_token` from `Set-Cookie`, and re-issues them as `aspire_*` cookies. |
| `src/lib/authCookies.ts` | Defines cookie names (`aspire_access_token`, `aspire_refresh_token`) and the shared cookie options (`httpOnly`, `secure`, `sameSite=lax`). |
| `src/proxy.ts` | Next.js request proxy. Gates `/dashboard/*` navigation based on auth cookie presence; it does not rotate tokens. |

---

## Silent Token Refresh

### Client-side: 401 interceptor in `mdwClient`

When any API call returns `401`, the response interceptor in `mdwClient.ts` automatically:

1. Calls `doRefresh()` — POST to `/api/auth/refresh`.
2. If the refresh succeeds, retries the original request with the new cookies.
3. If the refresh token is rejected and a confirming retry is still unauthorized, calls `clearAuth()` and navigates through `/api/auth/logout` to clear stale cookies before returning to `/login`.
4. If refresh is temporarily unavailable (for example, a network failure or timeout), preserves the cookies so a later request can recover the session.

```
Request → 401 ──► doRefresh() ──► success → retry original request
                             ├──► rejected → confirm 401 → /api/auth/logout → /login
                             └──► unavailable → preserve session for retry
```

The auth endpoints (`/auth/login`, `/auth/refresh`, `/auth/register`) are explicitly excluded from the retry loop.

### Cross-tab coordination via `BroadcastChannel`

If two browser tabs both detect a 401 at the same moment, both will try to call `POST /auth/refresh`. But the backend rotates the refresh token atomically — only the first call wins; the second gets `401`.

To handle this gracefully, `mdwClient` uses a `BroadcastChannel('aspire_refresh')`:

- A `refreshPromise` mutex prevents two concurrent refresh calls within the same tab.
- When the winning tab's refresh completes, it broadcasts `{ type: 'done' }`.
- The losing tab receives `{ type: 'done' }` (or recognizes a recently received success signal) and retries its original request using the fresh cookies in the shared browser cookie store.
- If no `'done'` signal arrives within 3 seconds, the losing tab confirms authentication with the original request before deciding whether to log out.
- A `401` from `/api/auth/refresh` does not clear cookies immediately, because it may be the losing request after another tab has already rotated the same one-time refresh token.
- When `BroadcastChannel` is unavailable, the losing tab retries the original authenticated request before clearing anything; a successful retry proves that another tab refreshed the shared cookies.

### Navigation gate: Next.js proxy

The `src/proxy.ts` file runs on `/dashboard/*` navigation and auth pages:

| State | Action |
|-------|--------|
| `aspire_access_token` present | Allow request through |
| `aspire_access_token` missing, `aspire_refresh_token` present | Allow dashboard shell through; its initial `mdwClient` request performs coordinated refresh if required |
| Both cookies missing | Redirect to `/login?next=<current-path>` |
| On an auth page with either session cookie | Redirect to `/dashboard`, where API validation accepts or clears the session |

Dashboard pages are client-rendered and the layout fetches `GET /users/me` through `mdwClient`. Keeping refresh-token rotation in that single coordinated path prevents the request proxy and browser client from racing the same one-time refresh token when the 15-minute access cookie expires.

---

## `fastify.authenticate` — Full Validation Sequence

Every protected route passes through `fastify.authenticate` as a `preHandler`. It performs these checks in order:

1. **JWT signature and expiry** — `request.jwtVerify()`. The token is read from the `Authorization: Bearer` header or the `access_token` cookie. A bad signature or expired token immediately returns `401`.
2. **DB session lookup** — queries `refresh_tokens` for a row where `jti = token.jti` AND `userId = token.sub` AND `revokedAt IS NULL` AND `expiresAt > now`. If no row matches, the session has been invalidated (logout, password change, soft delete) → `401`.
3. **User status check** — reads `user.status` from the session join. `SUSPENDED` or `BANNED` → `403`.

> The `deletedAt` check is enforced separately at the service layer (`loginUser`, `findUserById`) and at the account-deletion point (refresh tokens are revoked, blocking future session validation at step 2).

| Failure | Status |
|---------|--------|
| Invalid JWT / expired / bad signature | `401 Invalid or expired access token` |
| Session not found / revoked / expired | `401 Session has been invalidated. Please login again.` |
| Account suspended or banned | `403 Your account is SUSPENDED/BANNED.` |
| Account soft-deleted (blocks at login / refresh) | `403 This account has been deleted.` |

---

## Endpoints

### `POST /api/v1/auth/register`

Creates one parent and at least one student in a single transaction.

**Request body:**
```json
{
  "parent": {
    "fullName": "Jane Doe",
    "email": "jane@example.com",
    "phoneNumber": "+61412345678",
    "address": "123 Main Street, Truganina VIC 3029"
  },
  "students": [
    {
      "fullName": "Alex Doe",
      "email": "alex@example.com",
      "gender": "MALE",
      "yearLevel": "Year 7",
      "schoolName": "Melbourne High School"
    }
  ]
}
```

**Response body** (201):
```json
{
  "success": true,
  "message": "Registration successful. Login credentials have been emailed to all accounts.",
  "data": {
    "parent":   { "id": "...", "email": "jane@example.com", "fullName": "Jane Doe" },
    "students": [{ "id": "...", "email": "alex@example.com", "fullName": "Alex Doe" }]
  }
}
```

Duplicate emails inside the request → `400`. Email already in the database → `409`.

---

### `POST /api/v1/auth/login`

Authenticates an active, non-deleted user and invalidates previous active sessions.

**Request body:**
```json
{ "email": "user@example.com", "password": "Password1!" }
```

**Response body** (200):
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "...",
      "email": "user@example.com",
      "fullName": "Jane Doe",
      "role": "PARENT",
      "status": "ACTIVE"
    },
    "expiresIn": "15m"
  }
}
```

**Response cookies** (set by Next.js proxy, HttpOnly):
- `aspire_access_token` — JWT, 15 min
- `aspire_refresh_token` — opaque token, 7 days

Tokens are **not** in the response body. Wrong credentials → `401`. Account suspended/banned/deleted → `403`.

---

### `POST /api/v1/auth/refresh`

Rotates a valid refresh token into a new access/refresh pair. Rotation is atomic — concurrent reuse of the same refresh token can only succeed once (the second call gets `401`).

No request body required — the refresh token is read from the `aspire_refresh_token` cookie.

**Response body** (200):
```json
{ "success": true, "message": "Token refreshed successfully" }
```

New cookies are set (same names, fresh values). User data is not returned — fetch `GET /users/me` if fresh profile data is needed. Invalid, expired, revoked, or already-rotated refresh token → `401`.

---

### `POST /api/v1/auth/logout`

Requires a valid access token. Revokes the session linked to the access-token `jti` and clears both `aspire_*` cookies.

---

### `POST /api/v1/auth/change-password`

Requires a valid access token.

```json
{ "oldPassword": "OldPassword1!", "newPassword": "NewPassword1!" }
```

Old password must match. Password update and other-session revocation happen in one transaction. The current session's `jti` is preserved so the user stays logged in.

---

### `POST /api/v1/auth/forgot-password`

Always returns `200` — never reveals whether the email exists.

```json
{ "email": "user@example.com" }
```

If the email is registered and the account is active, a password reset link is emailed. Existing unused reset tokens are invalidated first.

---

### `GET /api/v1/auth/reset-password?token=<token>`

Validates a reset token without consuming it. Returns `{ data: { valid: true|false } }`.

---

### `POST /api/v1/auth/reset-password`

Consumes the token (one-time use), sets the new password, and revokes all active sessions.

```json
{ "token": "<64-char-hex-token>", "newPassword": "NewPassword1!" }
```

Invalid, expired, or already-used token → `400`.

---

### `DELETE /api/v1/users/me`

Requires a valid access token. Soft-deletes the authenticated user's own account:

1. Revokes all active refresh tokens for the user.
2. Sets `deleted_at = now()` on the user row.

The user is immediately unable to log in. No data is physically removed.

```json
{ "success": true, "message": "Account deleted successfully." }
```

---

### `DELETE /api/v1/admin/users/:id`

Requires a valid access token + `ADMIN` role. Soft-deletes any user account by ID. Same mechanics as self-delete above.

`404` if the user does not exist, `409` if already deleted.

```json
{ "success": true, "message": "User deleted successfully." }
```

---

## Field-Level Encryption (User PII)

User PII (email, full name, phone number, address) is stored encrypted in the database. If the database is leaked, an attacker cannot read user data directly.

Two complementary techniques are used:

### AES-256-GCM (Authenticated Encryption)

Stores the actual value securely so it can be decrypted and displayed. Each call produces different output (random 12-byte IV). Output format: `iv:authTag:ciphertext` (Base64). Applied to: `email_encrypted`, `full_name`, `phone_number`, `address`.

### HMAC-SHA256 (Blind Index)

Creates a deterministic fingerprint — same input always produces the same output, so it can be used in `WHERE` conditions. One-way, cannot be reversed. Applied to: `email` (primary column), `full_name_tokens`.

### `users` Table Columns

| Column | Content | Purpose |
|--------|---------|---------|
| `email` | `HMAC(normalizeEmail(email))` | Login, duplicate check |
| `email_encrypted` | `AES-GCM(email)` | Display after decryption |
| `full_name` | `AES-GCM(fullName)` | Display after decryption |
| `full_name_tokens` | `[HMAC(word1), HMAC(word2), …]` | Word-level name search |
| `phone_number` | `AES-GCM(phoneNumber)` | Display after decryption |
| `address` | `AES-GCM(address)` | Display after decryption |
| `deleted_at` | Timestamp or `NULL` | Blocks login; excludes row from list queries |

See [field-encryption.md](./field-encryption.md) for full details, login/registration flow diagrams, environment variable setup, and known limitations.

---

## RBAC and Ownership

| Helper | Location | Purpose |
|--------|----------|---------|
| `requireRole(...roles)` | `src/utils/authz.ts` | Route-level role gate (used as `preHandler`) |
| `assertParentOwnsStudent(...)` | `src/utils/authz.ts` | Verifies parent → student ownership |
| `assertCanAccessStudent(...)` | `src/utils/authz.ts` | Admin/tutor/student/parent student-access check |

Role-specific data constraints are enforced at the service layer. Examples:
- Only parents have parent-registration fields.
- Only students have `gender` / `yearLevel`.
- Parent-child access always goes through `parent_student_relations`.

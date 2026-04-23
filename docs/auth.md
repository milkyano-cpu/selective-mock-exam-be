# Authentication System

## Overview

Aspire uses a dual-token authentication system:

| Token | Lifetime | Purpose |
|-------|----------|---------|
| Access token | 15 minutes by default | Sent via `Authorization: Bearer <token>` |
| Refresh token | 7 days by default | Used only to rotate into a new token pair |

Every session is represented by one row in `refresh_tokens`. The access-token `jti` must match an active, non-expired refresh-token row for authenticated requests to continue.

## Current Auth Policy

- Self-registration is only for parents.
- A parent registration creates the parent account and one or more student accounts in one DB transaction.
- Tutor and admin accounts are not self-registered; they must be created by admin tooling.
- Email addresses are normalized with `trim().toLowerCase()` before create/login lookup.
- Single-device login is intentional: a successful login revokes the user's previous active sessions.
- v1 onboarding intentionally sends auto-generated passwords by email. This is an accepted v1 risk; production should move to invite/set-password links when that product decision changes.

## Endpoints

### `POST /api/v1/auth/register`

Creates one parent and at least one student.

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

Response:

```json
{
  "success": true,
  "message": "Registration successful. Login credentials have been emailed to all accounts.",
  "data": {
    "parent": { "id": "...", "email": "jane@example.com", "fullName": "Jane Doe" },
    "students": [
      { "id": "...", "email": "alex@example.com", "fullName": "Alex Doe" }
    ]
  }
}
```

Duplicate emails inside the request return `400`. Emails already present in the database, including race-time unique constraint conflicts, return `409`.

### `POST /api/v1/auth/login`

Authenticates an active user and invalidates previous active sessions for that user.

```json
{
  "email": "user@example.com",
  "password": "Password1!"
}
```

Response includes:

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
    "accessToken": "eyJhbGci...",
    "refreshToken": "opaque-refresh-token",
    "expiresIn": "15m"
  }
}
```

### `POST /api/v1/auth/refresh`

Rotates a valid refresh token into a new access/refresh pair. Rotation is atomic: concurrent reuse of the same refresh token can only succeed once.

```json
{
  "refreshToken": "opaque-refresh-token"
}
```

Invalid, expired, revoked, or already-used refresh tokens return `401`.

### `POST /api/v1/auth/logout`

Requires a valid access token. Revokes the session linked to the access-token `jti`.

### `POST /api/v1/auth/change-password`

Requires a valid access token.

```json
{
  "oldPassword": "OldPassword1!",
  "newPassword": "NewPassword1!"
}
```

The old password must match. The password update and other-session invalidation happen in one transaction.

## Authenticated Request Validation

`fastify.authenticate` checks:

- JWT signature and expiry.
- `refresh_tokens.jti` equals the access-token `jti`.
- `refresh_tokens.user_id` equals the access-token `sub`.
- `refresh_tokens.revoked_at IS NULL`.
- `refresh_tokens.expires_at > now`.
- linked user status is `ACTIVE`.

Failure returns `401` for invalid/session-invalid cases and `403` when the account status is not active.

## RBAC And Ownership Foundation

Current routes only require authentication, but shared helpers exist for upcoming modules:

- `requireRole(...roles)` for role-gated route preHandlers.
- `assertParentOwnsStudent(...)` for parent-child ownership checks.
- `assertCanAccessStudent(...)` for admin/tutor/student/parent student-access checks.

Role-specific data constraints remain service-layer responsibilities for now. Examples: only parents should have parent registration fields, only students should have `gender`/`yearLevel`, and parent-child access must use `parent_student_relations`.

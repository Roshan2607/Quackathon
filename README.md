# Quackathon — PES University Hackathon Teammate Finder

A student platform for finding hackathon teammates at PES University: discover
**people** and **teams** for a verified hackathon, **Pass/Connect** on candidates,
exchange mutual **matches**, send **team join requests**, and chat in persistent
conversations.

- Frontend: React 19 + Vite (TypeScript), mobile-first, student-scoped.
- Backend: one Express API (`server.ts`) with Postgres + Drizzle ORM.
- Optional integrations: PESU-Dev OAuth2, Firebase Auth, GitHub REST, Gemini.

This repository is the existing Google AI Studio project, continued in OpenCode.
Nothing in the app is stubbed with fake students, events, teams or chats — the
live UI reads only what is actually in Postgres.

---

## 1. Requirements

| Requirement | Version | Notes |
| --- | --- | --- |
| Node.js | >= 22.12.0 | `npm install` warns that some Firebase packages prefer Node >= 24.12 |
| Package manager | npm (lockfile `package-lock.json`) or bun (lockfile `bun.lock`) | Both lockfiles are kept in sync |
| PostgreSQL | 14+ (tested on 18.6) | Any reachable instance; use a dedicated dev/test database |

Optional (only needed for the matching integration): a Gemini API key, a GitHub
token, PESU-Dev OAuth2 client credentials, a Firebase service account.

## 2. Install

```bash
npm ci          # or: bun install
```

Both lockfiles are committed. `npm ci` reproduces `package-lock.json` exactly.

## 3. Configure the environment

```bash
cp .env.example .env    # Windows: copy .env.example .env
```

Fill in at least the Postgres block in `.env`:

```dotenv
SQL_HOST=127.0.0.1
SQL_PORT=5432
SQL_DB_NAME=quackathon
SQL_USER=quackathon_app
SQL_PASSWORD=your-local-password
```

`.env` is git-ignored. Never commit keys or passwords; `.env.example` only ever
contains placeholders.

## 4. Create the database and apply migrations

Create a role and a database (example for a local Postgres):

```sql
CREATE ROLE quackathon_app LOGIN PASSWORD 'choose-a-local-password';
CREATE DATABASE quackathon OWNER quackathon_app;
```

Then apply the committed Drizzle migrations:

```bash
npm run db:migrate      # applies ./drizzle/*.sql to SQL_DB_NAME
```

Helper scripts: `npm run db:generate` (regenerate migrations after editing
`src/db/schema.ts`), `npm run db:push` (push the schema directly, dev only),
`npm run db:studio` (Drizzle Studio).

Migration commands read `SQL_HOST`, `SQL_PORT`, `SQL_DB_NAME` and
`SQL_USER`/`SQL_PASSWORD`; `SQL_ADMIN_USER`/`SQL_ADMIN_PASSWORD` can be used
instead when DDL must run with a more privileged role.

## 5. Run

```bash
# Development: Express API + Vite dev server in middleware mode (single port)
npm run dev             # http://127.0.0.1:3000 by default (override with PORT)

# Production: build the bundle, then serve it from Express
npm run build
NODE_ENV=production npm start
# Windows PowerShell: $env:NODE_ENV="production"; npm start
```

`PORT` and `NODE_ENV` can also be set in `.env`.

## 6. Verify the stack

```bash
npm run typecheck       # tsc --noEmit
npm test                # node:test suite via tsx (21 tests)
npm run build           # vite build -> dist/
```

Smoke test the running server:

```bash
curl http://127.0.0.1:3000/api/health
# {"ok":true,"status":"healthy","service":"quackathon-api",...}

curl -i http://127.0.0.1:3000/api/does-not-exist
# HTTP/1.1 404 ... {"ok":false,"errorCategory":"NOT_FOUND",...}

curl http://127.0.0.1:3000/api/bootstrap
# {"ok":true,"users":[],...} — empty when the database is empty
```

Every `/api/*` route answers with JSON (including 404 and error responses);
non-API routes serve the SPA.

## 7. Project layout

```
server.ts                 Express API: auth, events, teams, swipes, chat, integrations
src/App.tsx               Student shell (Discover / Hackathons / Matches / Profile)
src/components/           Discover, Hackathons, Teams & Requests, Matches & Chat,
                          Onboarding & Profile, Admin Review Queue, Integration Tests
src/db/schema.ts          Drizzle schema (12 tables)
src/db/repository.ts      All database access (users, events, teams, swipes, chat)
src/db/index.ts           Postgres pool (SQL_* env vars)
src/db/drizzle.config.ts  drizzle-kit configuration
src/middleware/auth.ts    Session / Firebase / PESU token resolution
src/lib/apiClient.ts      Typed fetch wrapper (JSON guards, timeouts, auth header)
src/services/adapters.ts  Event URL/file extraction, GitHub import, PESU OAuth start
src/services/matchingEngine.ts  Deterministic People/Teams ranking
src/types/                Domain model and shared API contracts
tests/integration.test.ts node:test suite (21 tests)
drizzle/                  Committed SQL migrations
```

## 8. Current status and known gaps

Working and verified locally (see the OpenCode stage-1 report):
install, typecheck, tests (21/21), production build, `/api/health`,
JSON 404 for unknown API routes, Postgres schema + migrations, and the
two-user persistence flow (profile update, event publish, mutual match,
messaging, team creation, join request accept/reject, capacity limits).

Known gaps (not fixed in this stage, by design):

1. **Identity verification is not trustworthy yet.** Any successfully verified
   Firebase ID token is stored as `verified_pesu_oidc`. Arbitrary Google
   sign-in must not be treated as PESU student verification; student-only
   discovery has to be restricted until enrolment is verified separately.
2. **`/api/bootstrap` is not scoped per viewer.** It returns all users,
   profiles, candidates and teams to any caller. It must be restricted to
   public profile fields and viewer-authorized swipes/requests/candidates, and
   the admin queue has to move behind admin auth.
3. **OAuth tokens are stored in plain text** (`oauth_sessions.access_token`,
   `refresh_token`, `session_token`). They need hashing/encryption at rest,
   expiry/revocation, and cookie hardening.
4. **Test hygiene:** the integration test creates rows in the configured
   database and only cleans up when it passes; a failed run leaves rows
   behind. Use a dedicated test database, and wrap the suite in a transaction
   or add `after` cleanup.
5. **Firebase admin verification needs credentials.** Without a service
   account (`GOOGLE_APPLICATION_CREDENTIALS`) Google sign-in cannot be
   verified server-side.

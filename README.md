# WSHS Science Day Stamp Program

Science Day stamp, profile, leaderboard, and reward coupon site.

## Run locally

```bash
npm install
cp .env.example .env
# Edit .env and replace APP_SECRET / LOCAL_SUPERADMIN_PASSWORD.
npm run local:dev
```

Open:

```txt
http://127.0.0.1:3000/local
```

Default local mode uses SQLite at:

```txt
.data/local.sqlite
```

This avoids requiring PostgreSQL on the Mac during testing. For Docker or a dedicated PostgreSQL server, set `LOCAL_DATABASE_URL` to the Postgres URL instead.

The first local auth/health request creates the tables and bootstraps the super admin account.

```txt
ID: superadmin
Password: LOCAL_SUPERADMIN_PASSWORD in .env
```

Keep `.env` and `.data/` server-side only. They are ignored by git.

## Roles

- `participant`: participant QR, stamp gallery, profile customization, leaderboard, one reward coupon after 7 stamps
- `boothAdmin`: 40 booth codes, 10 per club
- `rewardAdmin`: 8 reward codes, 2 per reward
- `superAdmin`: 2 super admin codes

## Security model

- Passwords are stored with `scrypt` hashes, never as plain text.
- Sessions use signed server-side tokens in `HttpOnly`, `SameSite=Strict` cookies.
- QR values are signed server tokens. The client cannot create valid participant or coupon tokens.
- Stamp grant, coupon creation, coupon redemption, name changes, and stamp-image saving are server API actions.
- Duplicate booth stamps and duplicate reward coupons are blocked server-side.
- Admin invite codes are stored as hashes. The secret code-status page never shows raw invite codes.
- Profile avatar selection is validated against stamps the participant actually owns.
- Mutating API routes enforce same-origin checks, payload size limits, role checks, and basic rate limits.
- `npm audit` currently reports zero known vulnerabilities.

## Firebase App Hosting

Project:

```txt
stampwooshin
```

This repo is prepared for Firebase App Hosting with GitHub deployment:

- `.firebaserc`: Firebase project alias
- `firebase.json`: App Hosting backend config
- `apphosting.yaml`: runtime config and Secret Manager references
- `firestore.rules`: denies browser-side Firestore access

The production database backend is enabled by:

```txt
STAMP_DB_BACKEND=firestore
FIREBASE_PROJECT_ID=stampwooshin
```

Production is server-backed only. If `STAMP_DB_BACKEND=firestore` or `APP_SECRET` is missing while `NODE_ENV=production`, the server fails instead of falling back to `.data/`.

Production secrets are not stored in git. Generate values:

```bash
npm run secrets:generate
```

Create these Firebase App Hosting / Secret Manager secrets:

```txt
APP_SECRET
ADMIN_CODE_SEED
BOOTSTRAP_SUPERADMIN_PASSWORD
```

`BOOTSTRAP_SUPERADMIN_PASSWORD` must be at least 12 characters. Prefer the generated value.

After setting `ADMIN_CODE_SEED` locally, print the deterministic admin invite codes:

```bash
ADMIN_CODE_SEED="same-secret-value" npm run codes:print
```

Deploy from GitHub:

```bash
firebase init apphosting
firebase deploy --only apphosting:stampwooshin
```

Do not commit `.data/`, `.env*`, raw admin codes, or secret values.

# WSHS Science Day Stamp Program

Science Day stamp, profile, leaderboard, and reward coupon site.

## Run locally

```bash
npm install
npm run dev
```

Open:

```txt
http://127.0.0.1:3000
```

The first server-side auth request creates a local development database in `.data/`.
Initial super admin credentials and the 50 one-time admin invite codes are written to:

```txt
.data/bootstrap-secrets.txt
```

Keep that file server-side only. It is ignored by git.

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

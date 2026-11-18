# Google sign-in for Strikz players

## Using it

Open `/book` and choose **Player sign in**, **My bookings**, or an available session. The Player account dialog offers **Continue with Google** on both Sign in and Create account. Google opens its account chooser; a verified identity creates a player profile on the first visit and signs in to that profile on later visits. A selected available session is restored after sign-in, subject to a fresh availability check.

If the email already belongs to a password account, sign in with that password first, then choose **Connect Google** beside the player name. Choose the Google account with the same email. Password sign-in continues to work after linking. Accounts are not linked automatically just because an email matches.

Staff sign-in stays at `/login`. Staff or administrator accounts cannot sign in or link through Google. Google sessions cannot gain staff access if the account is later assigned operational permissions; staff must use password sign-in.

## Google Cloud setup

Use an OAuth 2.0 client with application type **Web application**. Set its **Authorized JavaScript origins** to each exact origin used by the frontend, without a path or trailing slash:

- Current local preview: `http://127.0.0.1:32085`
- If using the localhost hostname: `http://localhost:32085`
- Production: `https://strikzclub.techwing.cloud`

The host, protocol, and port must match the browser address. For another local port, register that exact origin and ensure the backend `FRONTEND_ORIGIN` matches it. If Google reports `origin_mismatch` or `The given origin is not allowed for the given client ID`, update these entries in [Google Cloud credentials](https://console.cloud.google.com/apis/credentials). This requires access to the Google Cloud project that owns the client. When the OAuth application is in Testing, the selected Google accounts may also need to be listed as test users.

Set `GOOGLE_CLIENT_ID=<your-web-client-id>.apps.googleusercontent.com` on the backend and restart it. Docker Compose passes this variable from its `.env`. The public client ID is already set in the ignored `.local-strikz/api.env`; it is not a client secret. No Google client secret, Google access token, or refresh token is required or persisted.

The browser uses Google Identity Services at `https://accounts.google.com/gsi/client`. This implementation uses its popup ID-token flow, so a Google redirect URI is not required. Allow the script and Google account popup in the browser; if a blocker prevents loading, the dialog provides a retry and email sign-in remains available.

## Application configuration and security

- `GET /api/google-sign-in?tenant=<slug>` is served by Next.js. It returns the public client ID and a random nonce, with a ten-minute, HttpOnly, SameSite challenge cookie bound to the arena. Cross-site challenge requests are rejected.
- `POST /api/session?scope=customer` accepts `action=google` or `action=link-google`, checks origin and the nonce cookie, and forwards the credential to NestJS. The challenge cookie is cleared after the attempt. Only the customer session cookie is written.
- NestJS uses Google's official authentication library to verify signature, issuer, audience, expiry, verified email, subject, and nonce. The account is identified by a tenant-scoped Google subject, not an email supplied by the browser.
- New accounts receive only the Web Customer role and unpaid-hold permission. Existing password accounts require explicit authenticated linking, and accounts with operational permissions are rejected.
- Nginx must route exact `/api/google-sign-in` and `/api/session` paths to Next.js. Remaining `/api/` paths, including `/api/auth/google`, are routed to NestJS. The supplied configuration includes these rules.

Migration `20261118000400_google_customer_login` adds a nullable Google subject and a tenant-scoped unique index. It preserves existing accounts and bookings. Apply migrations before starting the updated API.

## Verification

Backend TypeScript compilation and the web production build pass. Google account integration tests use Google's real JWT verifier with a locally generated RSA signing key and locally supplied verification certificate; they do not use a real Google account or send tokens to Google:

```powershell
node --env-file=.sample-auth/api.env scripts/check-google-auth.cjs
node scripts/check-google-session.cjs
```

The first script performs 54 HTTP checks covering invalid signatures/claims, profile creation, repeated identities, linking, tenant isolation, inactive users, and staff permission changes. It accepts only the local `techwing_auth_sample` database and deactivates its isolated fixtures. The second script checks the running local web app with 13 HTTP checks for client configuration, challenge cookies, nonce/tenant/expiry/origin validation, customer-only scope, and cleanup. Existing customer/staff session-isolation checks also pass.

An interactive Google account chooser and provider-side authorized-origin configuration were not verified in this chat because browser control was unavailable. Complete a real Google sign-in from `/book` to verify those external settings.

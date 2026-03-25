# Authsignal Push Auth Demo

A full-stack demo of push authentication using [Authsignal](https://www.authsignal.com/), with a web app that initiates push challenges and a mobile app that approves or denies them.

## Use cases

- **Sign-in approval** — user logs in on web, approves on mobile.
- **Transaction approval** — high-risk action with number matching (3-digit code shown on web, verified on mobile).

## Project structure

| App | Stack | Role |
|-----|-------|------|
| `apps/api` | Express + Authsignal Node SDK | Backend API |
| `apps/web` | Vite + React | Web sender console |
| `apps/mobile` | Expo + React Native | Mobile approver app |

## Prerequisites

- Node.js 20+
- An [Authsignal](https://www.authsignal.com/) tenant with Push enabled
- Expo development build for mobile testing

## Getting started

### 1. Configure environment

```bash
cp apps/api/.env.example apps/api/.env    # set AUTHSIGNAL_SECRET_KEY and AUTHSIGNAL_TENANT_ID
cp apps/web/.env.example apps/web/.env
cp apps/mobile/.env.example apps/mobile/.env
```

If running mobile on a physical device, set `EXPO_PUBLIC_API_BASE_URL` to your machine's LAN address (e.g. `http://192.168.1.20:4000`).

### 2. Install and run

```bash
npm install

# In separate terminals:
npm run dev:api
npm run dev:web
npm run dev:mobile
```

## Demo flow

1. Open the web app and save a user profile.
2. Open the mobile app with the same user ID and tap **Enroll Device**.
3. In web, trigger **Send Sign-In Push** or **Send Transaction Push**.
4. In mobile, approve or deny the challenge (with number matching for transactions).
5. Web shows the result after backend validation.

## Authsignal dashboard setup

Enable Push and configure these actions:

- `addAuthenticator` (scope: `add:authenticators`) — for enrollment
- `signIn`
- `approveTransaction`

## Notes

- Challenge context is stored in memory — use a database in production.
- The webhook endpoint verifies `x-signature-v2` and can be extended to forward native push notifications.
- `react-native-authsignal` requires an Expo development build (not Expo Go).

## Links

- [Authsignal docs](https://docs.authsignal.com/)
- [Push authentication](https://docs.authsignal.com/authentication-methods/app-verification/push)

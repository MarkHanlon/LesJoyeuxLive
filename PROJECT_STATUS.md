# Project Status: Les Joyeux Live

**Last Updated**: 2026-04-20 (PIN auth planned; onboarding flow deployed)

## Project Overview
Family organization Progressive Web App using Expo, Expo Router, and Neon Postgres (via `@neondatabase/serverless`) with secure API Routes pattern.

---

## ✅ Completed Tasks

### Initial Setup
- [x] Initialized Expo project with blank template
- [x] Installed and configured Expo Router
- [x] Installed @neondatabase/serverless SDK (replaced deprecated @vercel/postgres)
- [x] Created app directory structure with API routes support
- [x] Configured TypeScript (tsconfig.json)
- [x] Updated app.json with correct app name and scheme

### Project Structure
- [x] Created `app/_layout.tsx` (root layout with Stack)
- [x] Created `app/(tabs)/_layout.tsx` (tab navigation layout)
- [x] Created `app/(tabs)/index.tsx` (home screen)
- [x] Created `app/api/hello+api.ts` (example API route)

### Configuration Files
- [x] Created `.env.local.example` (environment variable template)
- [x] Created `vercel.json` (Vercel deployment config)
- [x] Created `README.md` (full project documentation)
- [x] Created `SECURITY.md` (security architecture guide)
- [x] Created `PROJECT_STATUS.md` (this file)
- [x] Verified `.gitignore` includes `.env*.local`

### Documentation
- [x] Documented security architecture (API Routes pattern)
- [x] Created examples for GET/POST/dynamic routes
- [x] Added architecture diagrams
- [x] Documented deployment process

### Source Control & Tooling
- [x] Renamed default branch from `master` to `main` (local + global git default)
- [x] Pushed to GitHub: https://github.com/MarkHanlon/LesJoyeuxLive
- [x] Installed Vercel CLI globally (`vercel --version` → 51.7.0)
- [x] Signed in to Vercel CLI (`vercel login`)
- [x] Added project-scoped Claude Code Stop hook (`.claude/settings.json`) that blocks stop and injects a reminder whenever the working tree has uncommitted changes but PROJECT_STATUS.md has not been touched

---

## 🔄 In Progress

### PIN-based Multi-device Auth (2026-04-20)
Replace device-UUID-only identity with name + PIN so the same person can log in from multiple devices. A 4-digit PIN is set on first registration; subsequent devices enter name + PIN to retrieve their existing account UUID.

**Steps:**
- [ ] **1. DB migration** — add `pin_hash TEXT` column to `users`; make `api/migrate.ts` idempotent (`ADD COLUMN IF NOT EXISTS`)
- [ ] **2. Update `api/register.ts`** — accept `{ name, pin }`; hash PIN with Node `crypto` (scrypt/pbkdf2); three cases:
  - name + correct PIN already exists → return existing UUID + status (multi-device login)
  - name exists but wrong PIN → 401
  - new name → create pending user with hashed PIN (first-ever user still auto-admin)
- [ ] **3. Update `app/enter-name.tsx`** — add 4-digit PIN input; label adapts ("Set your PIN" vs "Enter your PIN") based on whether name is already known
- [ ] **4. Update `contexts/AuthContext.tsx`** — pass PIN through to register call
- [ ] **5. Reset DB + re-run migration** — existing users have no PIN hash; clear table and re-run `POST /api/migrate`
- [ ] **6. Deploy + re-register** — `vercel deploy --prod`, then register as Mark (first user → auto-admin again)

---

### Family Access / Onboarding Flow — ✅ Largely complete (2026-04-20)
Name-based access control scaffolding — superseded by PIN work above for multi-device support.

- [x] **Neon Postgres** — provisioned via Vercel Marketplace; `DATABASE_URL` in `.env.local` and Vercel project env
- [x] **Database schema** — `users` table (UUID id, name, status, is_admin, created_at); `/api/migrate` endpoint (run once ✓)
- [x] **AsyncStorage** — `@react-native-async-storage/async-storage` ^3.0.2 installed
- [x] **API routes** — `POST /api/register`, `GET /api/status/[id]`, `GET /api/admin/users`, `POST /api/admin/approve/[id]`
- [x] **Auth context** — `contexts/AuthContext.tsx`
- [x] **Screens** — `enter-name.tsx`, `pending.tsx`, `app/(tabs)/admin.tsx` (French-provincial design)
- [x] **Auth-aware root layout** — `app/_layout.tsx` + `app/(tabs)/_layout.tsx`
- [x] **Deployed** — `vercel deploy --prod` ✓; migration run ✓

---

## 📋 To-Do / Requested by User

### Database Setup
- [x] Migrated from deprecated @vercel/postgres to @neondatabase/serverless
- [ ] Provision Neon via Vercel Marketplace (`vercel integration add neon`)
- [ ] Pull env vars locally (`vercel env pull .env.local`)
- [ ] Create database schema for family organization features
- [ ] Create migration files or setup scripts
- [ ] Implement database connection in API routes

### Core Features (User Requested)
- [ ] Family calendar/scheduling feature
- [ ] Task/chore management system
- [ ] Shopping list functionality
- [ ] Family member profiles
- [ ] Notifications/reminders

### Authentication & Security
- [x] Implement authentication system — name-based, password-free family access (see In Progress above)
- [ ] Add authorization/permissions per family member
- [ ] Secure API routes with auth middleware

### PWA Installation (iPhone + Android, share via link / QR code)
**Goal**: Family members scan a QR code → open the Vercel URL in their phone browser → *Add to Home Screen* (iOS Safari) or accept the install prompt (Android Chrome) → app launches standalone with its own icon, no browser chrome.

- [x] Extend `app.json` `expo.web` block: `display: "standalone"`, `themeColor`, `backgroundColor`, `shortName`, `description`, `lang`, `orientation`, `bundler: "metro"`, `output: "static"`
- [x] Generate proper PWA icon set from `assets/icon.png` — `public/icon-192.png`, `public/icon-512.png`, `public/icon-512-maskable.png` (80% canvas with white safe-zone padding); used `sharp` npm package (added as devDependency)
- [x] Add `apple-touch-icon.png` at 180×180 → `public/apple-touch-icon.png`
- [x] Add web-only HTML head tags — created `app/+html.tsx`: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`, `viewport` with `viewport-fit=cover`, `<link rel="apple-touch-icon">`
- [ ] Run a Lighthouse PWA audit against `npm run web` locally and fix any warnings before deploying
- [x] Deploy the Expo web build to Vercel — live at **https://les-joyeux-live.vercel.app** (linked via `vercel link --yes --project les-joyeux-live`, deployed via `vercel deploy`; GitHub auto-deploy still needs wiring via Vercel dashboard)
- [ ] Generate a QR code pointing at the production URL (or a custom subdomain) for easy family sharing
- [ ] Manually test the *Add to Home Screen* flow end-to-end on at least one iPhone (Safari) and one Android (Chrome) device
- [x] **Install prompt UX**: created `components/InstallPrompt.web.tsx` — detects browser vs. standalone mode; Android shows native install sheet via `beforeinstallprompt`; iOS shows step-by-step Share → Add to Home Screen instructions; dismissal persisted to localStorage; slides in with spring animation; wired into root layout via `app/_layout.tsx`
- [ ] **Follow-up (optional, not required for v1)**: add a service worker for offline support — Expo does not ship one by default; Workbox/Serwist plugin, or a custom `public/sw.js`

### Other UI/UX Development
- [ ] Design and implement main navigation
- [ ] Create reusable component library
- [ ] Implement theme/styling system
- [ ] Add loading states and error handling

### Testing & Deployment
- [ ] Set up testing framework (Jest, React Native Testing Library)
- [ ] Write unit tests for API routes
- [ ] Write integration tests for features
- [ ] Deploy to Vercel
- [ ] Test PWA functionality on mobile devices

---

## 🎯 Current Priority
**Next Step** (in this order):
1. **PWA configuration** — work through the "PWA Installation" task list above so the web build is installable on iOS and Android home screens
2. **Link this folder to a Vercel project** (`vercel link`) — or import the GitHub repo via the Vercel dashboard for automatic preview/production deploys
3. **First deploy** — push and verify the production URL serves the PWA over HTTPS
4. **Generate and share QR code** — for family onboarding
5. Provision Neon Postgres via Vercel Marketplace (`vercel integration add neon`) and `vercel env pull .env.local`
6. Define requirements for first feature to implement

---

## 📝 Important Notes

### Security Architecture (CRITICAL)
- **All database operations MUST go through API routes** (`app/api/*+api.ts`)
- React Native components should NEVER import database clients directly
- Environment variables only accessible in API routes
- See `SECURITY.md` for detailed patterns

### Known Issues
- `app.json` has two invalid schema fields flagged by `expo-doctor`: `newArchEnabled` (top-level) and `android.edgeToEdgeEnabled` — safe to remove on next cleanup pass
- ~~Legacy `App.js`/`index.js` shadowed Expo Router~~ — fixed: deleted both files, `package.json` `main` now points to `expo-router/entry`

### User Preferences
- Family organization app focus
- PWA deployment to Vercel, installable on iPhones and Androids via shared link / QR code (one-tap *Add to Home Screen* flow)
- Security-first approach with API Routes pattern

### Known PWA Tradeoff (iOS vs Android)
- Android Chrome shows a native install prompt and supports full service-worker features including push notifications
- iOS Safari does **not** show an install prompt — users must manually tap *Share → Add to Home Screen*. Push notifications require iOS 16.4+. Background sync is limited. For a family-organization use-case this is acceptable, but worth calling out in any onboarding instructions / QR-code landing copy

---

## 🔗 Key Files Reference
- Entry point: `app/(tabs)/index.tsx`
- API routes: `app/api/*.ts` files
- Config: `app.json`, `vercel.json`, `tsconfig.json`
- Docs: `README.md`, `SECURITY.md`

---

## Development Commands
```bash
npm start          # Start development server
npm run web        # Start web version
npm run android    # Start Android (requires Android Studio)
npm run ios        # Start iOS (requires macOS + Xcode)
```

---

_This file should be updated after completing tasks or when user requests new features._

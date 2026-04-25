# Project Status: Les Joyeux Live

**Last Updated**: 2026-04-26 (Vercel function consolidation + routing fixes)

## Project Overview
Family organization Progressive Web App using Expo, Expo Router, and Neon Postgres (via `@neondatabase/serverless`) with secure API Routes pattern.

---

## ✅ Completed Tasks

### Auth & Access Control
- [x] **Family onboarding** — name-based access; first user auto-approved as admin
- [x] **PIN-based multi-device auth** — 4-digit PIN set on first registration; name + PIN retrieves existing account on new devices; wrong PIN → 401
- [x] **Database schema** — `users` table with `pin_hash` (scrypt); `push_subscriptions` table; `/api/migrate` idempotent
- [x] **API routes** — `POST /api/register`, `GET /api/status/[id]`, `GET /api/admin/users`, `POST /api/admin/approve/[id]`
- [x] **Auth context** — `contexts/AuthContext.tsx`; screens: `enter-name.tsx`, `pending.tsx`, `app/(tabs)/admin.tsx`

### iOS PWA Push Notifications
- [x] **VAPID keys** configured (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` in Vercel env)
- [x] **Service worker** — `public/sw.js` handles `push` and `notificationclick` events
- [x] **Subscription flow** — admin enables via banner in admin tab; stored in `push_subscriptions`
- [x] **Send function** — `api/push/_send.ts` (`sendPushToAdmins`); auto-cleans stale 410/404 endpoints
- [x] **Trigger** — fires on new user registration (`api/register.ts` — awaited correctly so Vercel doesn't terminate early)
- [x] **Test endpoint** — `POST /api/push/test` for smoke-testing delivery
- [x] **Verified working** on iOS PWA (Apple push service endpoint confirmed)

### My Visit Feature
- [x] Arrival/departure date pickers with calendar — on web/PWA tapping the date opens the browser's native date picker; on native, `«»` month-jump buttons added alongside day arrows
- [x] Time slots, plate saving (lunch/dinner)
- [x] **Apéritif selection** — separate section card with 2-column drink grid (15 drinks: Pastis, Kir, Kir Royale, Crémant, Lillet, Suze, wines, G&T, beer, soft drinks) plus "I'll choose on the day!"; drink shown with emoji in summary view; `aperitif` column added to `visits` table via `ADD COLUMN IF NOT EXISTS`

### Home Screen
- [x] **Photo ticker** — 5 placeholder images crossfade every 3 s; two stacked `Animated.Image` layers swap with 700 ms opacity crossfade; progress pill-dots
- [x] **Ambient background** — current/previous photos rendered at 150% scale, ~14% opacity, blurred; crossfades in sync with ticker for a shifting colour wash behind the UI
- [x] **Visit CTA** — adapts to 5 states: no visit (Plan My Visit prompt), future visit (big serif countdown + arrival date), today (celebration), currently visiting (Bienvenue + departure date), past visit (Plan Next Visit prompt)
- [ ] Wire real photos into the `PHOTOS` array in `app/(tabs)/index.tsx` — four photos now in `public/`: `cheers.JPG`, `chicken-pond.JPG`, `simon-bra.jpg`, `show.jpg`; update the array to use `/cheers.JPG` etc.

### PWA Icons & Install Prompt
- [x] **French château icon set** — stone château with three pointed towers, red flags, battlements on forest green; all four sizes regenerated (192, 512, 512-maskable, apple-touch-icon) via `scripts/generate-icons.js` using `sharp`; `public/favicon.png` added
- [x] **Install prompt re-shows after uninstall** — clears dismissed flag when app runs in standalone mode so returning Safari users see the prompt again

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

_Nothing actively in progress — ready for next feature._

---

## 📋 To-Do / Requested by User

### Family Page
- [x] **Family tab open to all** — removed admin-only restriction; tab icon updated to 👨‍👩‍👧‍👦
- [x] **Member cards** — all approved users shown with: avatar, name, admin badge, visit status (here now / arriving date+slot / in N days / no plans), aperitif emoji for specific drink selections
- [x] **Admin section** — pending approvals shown below family list for admins only, with divider; quiet "all caught up" message when queue is empty
- [x] **Community notifications on acceptance** — `sendPushToAll` sends "👋 New family member!" to every approved subscriber (not just admins) when someone is approved; new `GET /api/family/members` endpoint authenticated by any approved user
- [x] **Admin remove-member** — admins can remove approved (non-admin) family members; `DELETE /api/admin/remove/[id]` with guards: cannot remove self or another admin; confirmation prompt shown before deletion
- [x] **Admin screen refactor** — two-section layout: pending approvals + approved members with remove button; `GET /api/admin/users` now returns all non-admin users (pending + approved)
- [x] **Invalid date bug fix** — Postgres DATE columns were returned as JS Date objects by `@neondatabase/serverless`, causing "Invalid Date" display; fixed by casting `arrive_date` and `depart_date` to `::text` in `api/visit/[id].ts`

### Vercel Function Consolidation (2026-04-26)
- [x] **Hit Hobby plan 12-function limit** — 14 individual `api/*.ts` files exceeded Vercel's free tier cap
- [x] **Consolidated to single catch-all** — all API handlers merged into `api/[...path].ts`; helper modules use underscore prefix (`_db.ts`, `push/_send.ts`) to be excluded from function count; result: 14 functions → 1 function
- [x] **Path routing hardened** — dual-source path parsing: tries `req.url` first (strips `/api/` prefix), falls back to `req.query.path` catch-all parameter (Expo's `moduleResolution: bundler` tsconfig can interfere with the latter)
- [x] **Login routing fixed** — `POST /api/register` now routes correctly after `req.url`-based parsing
- [ ] **Family/visit routing** — fix pushed (ebb8277) but not yet deployed to Vercel; `GET /api/family/members` and `GET /api/visit/:id` were returning 404 — awaiting manual `vercel --prod` deploy + test

### Core Features (not yet started)
- [ ] Family calendar/scheduling feature
- [ ] Task/chore management system
- [ ] Shopping list functionality
- [ ] Family member profiles
- [ ] Allocation of people to rooms

### Admin features
- [ ] Ability to print out schedule of all people, by room / date

### Authentication & Security
- [ ] Add authorization/permissions per family member
- [ ] Secure API routes with auth middleware
- [ ] Ability to make some users Admin

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
- [x] **Install prompt UX**: created `components/InstallPrompt.web.tsx` — detects browser vs. standalone mode; Android shows native install sheet via `beforeinstallprompt`; iOS shows step-by-step Share → Add to Home Screen instructions; dismissal persisted to localStorage; slides in with spring animation; wired into root layout via `app/_layout.tsx`; re-shows after uninstall (clears dismissed flag in standalone mode)
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
**Immediate**: Deploy routing fix and verify family/visit tabs load correctly.
```
vercel --prod
```
Then test: Family tab (family members list), My Visit tab (Mark's visit data).

**Next up:**
- Replace placeholder photos in `PHOTOS` array (`app/(tabs)/index.tsx`) with real family photo URIs
- Wire GitHub → Vercel auto-deploy (currently manual `vercel --prod`)
- Lighthouse PWA audit
- QR code for family onboarding sharing

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

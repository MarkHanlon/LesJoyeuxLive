# Project Status: Les Joyeux Live

**Last Updated**: 2026-07-13 (Auto-refresh across screens; Android Events scroll-jump fix)

## Version Testing Log

| Build stamp (live site) | Commit | Features tested | Result |
|---|---|---|---|
| _(pending — first build with stamp)_ | 5ff1dec | Build stamp, THEME fix, aperitif labels, Events tab date diagnostic | 🕐 Not yet tested |
| _(pending)_ | 86f8293 | Auto-refresh (focus + interval + foreground + push nudge) | 🕐 Not yet tested |
| _(pending)_ | 20c404c | Android Events scroll-jump fix | 🕐 Not yet tested |
| _(pending)_ | f69df6d | Cold-open Home fetch (no 30s delay) | 🕐 Not yet tested |
| _(pending)_ | (visit-status) | My {year} Visit title + not-coming/undecided status | 🕐 Not yet tested |

_How to update: after testing against the live site, read the "Build: …" stamp at the bottom of the home screen and record it here with the commit hash, what was tested, and the outcome (✅ Pass / ⚠️ Partial / ❌ Fail)._

---

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

### Events Tab & Arrivals/Departures (2026-05-03)
- [x] **Events tab on La Famille screen** — in-page "People / Events" tab switcher; Events tab shows date-by-date view of the user's stay; admin can add/delete events per day; event time (optional) shown in a badge
- [x] **Arrivals & departures as event entries** — each family member's arrival (🚗) and departure (👋) automatically derived from the `members` array and shown as read-only rows at the top of each day's section in the Events tab; no database changes required
- [x] **Defensive date comparison** — `.slice(0, 10)` guard on `arriveDate`/`departDate` comparisons handles ISO timestamp strings returned by the neon driver (`2026-05-10T00:00:00.000Z` → `2026-05-10`)
- [x] **GET /api/events** — returns events between a date range; auto-creates `events` table on first call; **POST /api/events** and **DELETE /api/events/:id** for admin create/delete
- [x] **Print aperitifs** — tapping "Tonight's aperitifs" title opens a print popup with a clean A4-formatted drink list; 🖨 hint icon and dotted underline signal it's clickable on web; popup includes a Close button
- [x] **iOS install prompt fix** — changed permanent dismissal flag to 30-day TTL; `> 1000000` check migrates devices with the old permanent flag; prompt reappears after 30 days or immediately after uninstall
- [x] **Home screen icon rename** — `apple-mobile-web-app-title` and `app.json` `shortName` updated to `LesJoyeuxLive`
- [x] **Tab bar label fix** — Safari's ~49px toolbar was cropping tab labels; fixed with `paddingBottom: calc(env(safe-area-inset-bottom, 0px) + 16px)` (TypeScript cast for React Native Web)

### Playwright Testing Infrastructure (2026-05-03)
- [x] **Playwright installed** — `@playwright/test` added as devDependency
- [x] **`playwright.config.ts`** — supports `BASE_URL` env var (production) or auto-starts `vercel dev` for local full-stack testing
- [x] **`tests/e2e/events-tab.spec.ts`** — asserts arrival/departure rows appear; intercepts `/api/family/members` to log raw date format; dedicated test checks dates are `YYYY-MM-DD` not ISO strings
- [x] **`tests/helpers/auth.ts`** — `loginAs(page, name)` helper for use across test files
- [ ] **One-time setup to enable closed-loop testing**: run `vercel env pull .env.local` + `npx playwright install chromium` so future sessions can do `npm test` against a live local stack
- [x] **Build stamp** — `EXPO_PUBLIC_BUILD_TIME` injected at Vercel build time via `date -u` in `vercel.json` build command; shown at bottom of home screen in 10px muted text; invisible in local dev
- [x] **Build error fixed** — `THEME` constant was missing in `InstallPrompt.web.tsx`; caused all Vercel deployments since last night to fail with `ReferenceError: THEME is not defined`
- [x] **Aperitif display names fixed** — home screen news feed was showing raw DB keys (`gt`, `red_wine`) instead of labels; fixed by aligning `DRINK_EMOJI`/`DRINK_LABELS` in `index.tsx` with DB key format from `admin.tsx`

### Auto-Refresh & Live Updates (2026-07-13)
- [x] **`useAutoRefresh` hook** (`hooks/useAutoRefresh.ts`) — replaced the plain `useFocusEffect` refetch on all three tabs. Re-fetches on focus, on an interval while the screen is focused **and** visible (Family 20s, Home/Visit 30s), and instantly when the PWA returns to the foreground, the window regains focus, or the network reconnects. Backgrounded/hidden screens do not poll (saves battery + DB calls).
- [x] **Mid-edit guard** — My Visit passes `enabled: false` to the hook while editing / changing a drink / saving, so a background poll can never clobber unsaved form input.
- [x] **Push-triggered instant refresh (Layer 2)** — `public/sw.js` now `postMessage`s all open app windows on `push`; `useAutoRefresh` listens for the `{ type: 'refresh' }` message and re-fetches. Signups/approvals refresh the open screen in ~1s, with polling as the backstop. Fixes the reported bug where an admin's **pending-approvals list didn't update without closing/reopening the app** (PR #10, commit `86f8293`).
- [x] **Android Events scroll-jump fix** — the 20s Family poll used to toggle `eventsLoading` on every refresh, swapping the Events `ScrollView` content for a spinner and back; the content-height collapse reset Android scroll to the top (iOS unaffected). Fixed by gating the spinner behind a first-load `useRef` (`eventsLoadedRef`) in `admin.tsx` so background polls refresh the list silently and preserve scroll position (PR #11, commit `20c404c`). See the Auto-Refresh Gotcha note below.

### My Visit — Year Title & Attendance Status (2026-07-13)
- [x] **Year in title** — My Visit page header now reads "My {current year} Visit".
- [x] **Attendance status** — two tappable options at the top of My Visit: "Not coming this year" and "Not finalised yet". Selecting one grays out (disables) the date/aperitif/transport sections; saving persists the status. Tapping the active option returns to "coming". New `visits.status` column (`coming`/`not_coming`/`undecided`, default `coming`); date/slot columns relaxed to nullable so a status-only row can be stored, and dates are cleared server-side when status ≠ coming.
- [x] **Consumers** — a not-coming/undecided member carries no dates, so Home news, Tonight summary, aperitif/meal counts and Events arrivals/departures already exclude them; the Family tab member card + detail modal show "Not coming this year" / "Plans not finalised" instead of a bare "No upcoming visit", and the Home CTA reflects the user's own status.

### Family Tab Improvements (2026-04-30)
- [x] **Tonight's Aperitifs card** — summary card at the top of the Family tab showing everyone's drink choice for tonight; only visible when at least one person is visiting or arriving today
- [x] **Manage toggle** — admin-only "Manage" button in the Family tab header switches between the normal member view and the admin management view (approvals + remove); simplifies the default view for admins
- [x] **Member grouping** — Family tab members now grouped into four sections: "Here now", "Arriving soon", "Already left", "No plans"; each section has a header label
- [x] **Removed arrival countdown text** — removed the verbose "arriving in N days" text from member cards in favour of the cleaner section grouping
- [x] **Focus-refresh** — all three tabs (Home, Family, Visit) now re-fetch their data on tab focus via `useFocusEffect`; ensures data stays in sync when switching tabs after making changes

### Test Data (2026-04-28)
- [x] **10 test users seeded to live DB** — Pappy, Joan, Emma, Simon, Izzy, Sam, Hayley, Jack, Beth, Max; all approved; visits set across early August 2026 (overlapping, 1–2 weeks each); aperitifs assigned; all use PIN `1234`; script at `scripts/seed-test-users.mjs`

### Home Screen News Feed (2026-04-28)
- [x] **Family news card** — new middle box on home screen showing: current visitors, next arrival, imminent departures, drink choices for upcoming guests, recent visit plan changes; auto-scrolls one item every 3.2 s, loops back; card is scrollable by touch too
- [x] **Compact visit CTA** — old tall "Next Visit In" box replaced with a compact single-row card (countdown number inline with date, or Bienvenue/Plan prompt); entire home screen now fits without scrolling
- [x] **API: visitUpdatedAt** — `GET /api/family/members` now returns `visitUpdatedAt` (visits.updated_at) so recent plan changes can surface in the news feed

### Photo Avatars & Visit UI (2026-04-27)
- [x] **Personalised photo avatars** — users can upload a profile photo from the Visit tab; image is resized to 256×256 and stored in Neon (`avatar` column on `users` table via `ADD COLUMN IF NOT EXISTS`); displayed as circular avatar in the Family tab member cards and admin screens; `POST /api/user/[id]/avatar` endpoint handles upload + resize via `sharp`
- [x] **Aperitif drink label on Family tab** — small label (10 px) rendered beneath the drink emoji so the selection is readable without icon recognition alone

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
- [x] **Multi-segment API routing fixed** — Root cause found: Vercel's auto-generated routing for `api/[...path].ts` used `([^/]+)$` (single segment only); every 2+ segment path (`/api/family/members`, `/api/status/:id`, `/api/visit/:id`) hit a hardcoded 404 rule. Fixed by replacing `rewrites` with explicit `routes` in `vercel.json` using `(.+)` to match all API segments. Deployed 2026-04-27, all endpoints verified.

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
- [x] Set up Playwright E2E testing framework (`playwright.config.ts`, `tests/e2e/`, `tests/helpers/`)
- [ ] One-time setup: `vercel env pull .env.local` + `npx playwright install chromium` to enable closed-loop testing
- [ ] Write unit tests for API routes
- [ ] Write integration tests for features
- [ ] Deploy to Vercel
- [ ] Test PWA functionality on mobile devices

---

## 🎯 Current Priority
**Latest**: ✅ Timely in-app auto-refresh across all tabs (focus + interval + foreground + push nudge); fixed the Android Events-list scroll-jump caused by a loading spinner toggling on background polls.

**Next up:**
- Run `vercel env pull .env.local` + `npx playwright install chromium` to enable closed-loop E2E testing
- Verify arrivals/departures show correctly after the `.slice(0, 10)` date fix deploys
- Replace placeholder photos in `PHOTOS` array (`app/(tabs)/index.tsx`) with real family photo URIs
- Wire GitHub → Vercel auto-deploy (currently manual `vercel --prod`)
- QR code for family onboarding sharing

---

## 📝 Important Notes

### Security Architecture (CRITICAL)
- **All database operations MUST go through API routes** (`app/api/*+api.ts`)
- React Native components should NEVER import database clients directly
- Environment variables only accessible in API routes
- See `SECURITY.md` for detailed patterns

### Auto-Refresh Gotcha (background polls must be silent)
- Any screen wired to `useAutoRefresh` (or otherwise polling) **must not toggle a loading spinner, unmount, or otherwise collapse list content on a background poll** — only on the first load or a manual pull-to-refresh.
- Why: on **Android**, when a `ScrollView`/`FlatList`'s content height shrinks below the current scroll offset (e.g. swapping a long list for a small spinner), the platform clamps the scroll position back to the top. **iOS tolerates it**, so this bug is invisible on iPhone and only shows on Android.
- Precedent: the Events list in `app/(tabs)/admin.tsx` hit exactly this — fixed by gating `setEventsLoading(true)` behind a first-load `useRef` so polls update the list in place (stable per-item keys, unchanged height). Follow the same pattern for any future auto-refreshing list.

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

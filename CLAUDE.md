# LesJoyeuxLive — Claude Code Instructions

## 📖 Start here (read first, every new session)

**Read [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) before doing anything.** It is the source of truth for what's built, what's on the backlog, and — in its **"Conventions & Handoff"** section — the working agreements, architecture decisions, and gotchas that don't live in the code (auth model, single-master-list pattern, git/PR workflow, migrations, etc.). This file (CLAUDE.md) covers deployment/testing rules; PROJECT_STATUS.md covers everything else.

## Deployment verification before any web testing

Before testing any feature against the live site, always:

1. **Check the build stamp** — open the home screen and read the "Build: DD Mon YYYY, HH:MM UTC" line at the bottom of the scroll area.
2. **Compare against PROJECT_STATUS.md → "Version Testing Log"** — find the most recent entry in that table.
   - If the live build stamp matches the last **Committed** entry but not the **Tested** entry → the build has deployed but hasn't been tested yet. Proceed with testing and update the Tested column.
   - If the live build stamp is older than the most recent commit → Vercel hasn't finished building yet. Wait and re-check before testing.
   - If no build stamp is visible → the THEME build fix may not have deployed yet, or the user is on a cached version.
3. **After testing**, record the result in the Version Testing Log in PROJECT_STATUS.md (see format below).

## Updating the Version Testing Log

After every test session, add or update a row in the **Version Testing Log** table in PROJECT_STATUS.md:

| Build stamp (from live site) | Commit | Features tested | Result |
|---|---|---|---|
| 03 May 2026, 11:42 UTC | a140199 | Aperitif labels, build stamp | ✅ Pass |

Use ✅ Pass, ⚠️ Partial, or ❌ Fail. Note any failures briefly in the Result column.

## General project notes

- Stack: Expo / React Native Web, deployed on Vercel, Neon PostgreSQL via `@neondatabase/serverless`
- All DB access goes through `api/[...path].ts` (single Vercel function, catch-all routing)
- Environment variables are in Vercel; pull locally with `vercel env pull .env.local`
- Branch for active development: `claude/pwa-ios-push-notifications-9fouZ` — keep in sync with `main`
- Playwright tests: `npm test` (requires `vercel env pull .env.local` + `npx playwright install chromium` one-time setup)
- Build stamp is injected via `EXPO_PUBLIC_BUILD_TIME` in `vercel.json` build command

# AGENTS.md

## Cursor Cloud specific instructions

### Overview

This is a **Next.js 14** (App Router) application — the "ALLGOAI Filing Orchestrator" (package name `pos-system`). It automates global filing workflows: receipt OCR → AI expense classification → accountant review queue → draft posting to accounting platforms (freee/QuickBooks/Xero).

### Quick reference

| Action | Command |
|--------|---------|
| Install deps | `npm install` |
| Dev server | `npm run dev` (port 3000) |
| Lint | `npm run lint` |
| Build | `npm run build` |

### Important caveats

- **Clerk auth is mandatory.** The Clerk middleware (`middleware.ts`) runs on every route. Without valid `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, the app returns 500 on all pages. You must have real Clerk API keys in `.env.local` for the UI to load.
- **ESLint config.** If `.eslintrc.json` is missing, `npm run lint` will prompt interactively. The expected config is `{"extends": "next/core-web-vitals"}`.
- **TypeScript/ESLint errors are ignored during build** (`next.config.js` sets `ignoreBuildErrors: true` and `ignoreDuringBuilds: true`), so `npm run build` will succeed even with type errors.
- **No automated test suite.** There are no test scripts or test frameworks configured. Validation is done via lint + build + manual testing.
- **Environment template.** Copy `.env.taxman.template` → `.env.local` and fill in real values. See `README.md` for the full list.
- **Optional services.** freee/QuickBooks/Xero connectors, Supabase, Ollama, and Groq are all optional. The app degrades gracefully without them.

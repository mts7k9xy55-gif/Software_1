# ALLGOAI Filing Orchestrator

Global filing automation app focused on:

- All-transaction intake
- AI expense classification
- Accountant-first review queue
- freee draft posting

The default UX is now a two-screen shell:

1. `All Transactions`
2. `Decision Queue`

Legacy POS/tax views remain in the repo but are not the default home flow.

## Core Principles

- Non-retention first: receipt images are processed in-memory and not persisted in the new pipeline.
- Draft-first posting: send to freee as draft expense deals, accountant confirms final booking.
- Minimal support boundary: app handles connectivity/pipeline; freee handles accounting-internal behavior.

## Required Environment Variables

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...

NEXT_PUBLIC_FREEE_CLIENT_ID=...
FREEE_CLIENT_SECRET=...
NEXT_PUBLIC_FREEE_REDIRECT_URI=https://pos.allgoai.org/api/freee/oauth/callback

GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash-lite
ENABLE_EXTERNAL_LLM=1
ENABLE_RECEIPT_OCR=1
```

Shared-token mode (optional, owner token for all users):

```bash
FREEE_SHARED_MODE=1
FREEE_SHARED_ACCESS_TOKEN=...
FREEE_SHARED_REFRESH_TOKEN=...
FREEE_SHARED_COMPANY_ID=1234567
```

Optional for legacy endpoints only:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Run

```bash
npm install
npm run dev
```

## New API Surface (V1)

- `POST /api/intake/ocr-classify`
- `POST /api/intake/manual`
- `POST /api/decision/evaluate`
- `POST /api/posting/freee/draft`
- `GET /api/queue/review`
- `GET /api/connectors/status`

## Architecture Modules

- `lib/core/types.ts`: canonical types (`CanonicalTransaction`, `ClassificationDecision`, etc.)
- `lib/core/decision.ts`: rule-first + LLM supplement + confidence gate
- `lib/core/jurisdiction.ts`: country profile plugin contract (JP default)
- `lib/core/packs.ts`: business-pack extension model
- `lib/connectors/freee.ts`: OAuth token refresh + posting/list adapters
- `lib/connectors/ocr/gemini.ts`: receipt OCR extractor

## Security / Privacy

- Clerk auth required on new orchestrator APIs.
- PII masking before LLM usage.
- No receipt body/image in audit metadata logs.
- Policy docs:
  - `docs/security/PRIVACY_POLICY_MINIMAL.md`
  - `docs/security/RLS_AUDIT_STORAGE_HARDENING.sql` (legacy DB setups)

## PWA

- Manifest: `/public/manifest.json`
- Service Worker: `/public/sw.js`
- Offline fallback: `/public/offline.html`

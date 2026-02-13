# ALLGOAI Filing Orchestrator

Global filing automation app focused on:

- All-transaction intake
- AI expense classification
- Accountant-first review queue
- region-based accounting draft posting

The default UX is now:

1. `Region Door` (region selection)
2. Two-screen regional shell:
   - `All Transactions`
   - `Decision Queue`

Legacy POS/tax views remain in the repo but are not the default home flow.

## Core Principles

- Non-retention first: receipt images are processed in-memory and not persisted in the new pipeline.
- Draft-first posting: send to freee as draft expense deals, accountant confirms final booking.
- Minimal support boundary: app handles connectivity/pipeline; freee handles accounting-internal behavior.

## Required Environment Variables

Copy `/Users/yutoinoue/Desktop/Software_1/.env.taxman.template` to `.env.local` and fill values.

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...

NEXT_PUBLIC_FREEE_CLIENT_ID=...
FREEE_CLIENT_SECRET=...
NEXT_PUBLIC_FREEE_REDIRECT_URI=https://pos.allgoai.org/api/freee/oauth/callback

QBO_CLIENT_ID=...
QBO_CLIENT_SECRET=...
QBO_REDIRECT_URI=https://pos.allgoai.org/api/connectors/oauth/callback?provider=quickbooks

XERO_CLIENT_ID=...
XERO_CLIENT_SECRET=...
XERO_REDIRECT_URI=https://pos.allgoai.org/api/connectors/oauth/callback?provider=xero

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

QBO_SHARED_MODE=1
QBO_SHARED_ACCESS_TOKEN=...
QBO_SHARED_REFRESH_TOKEN=...
QBO_SHARED_REALM_ID=...

XERO_SHARED_MODE=1
XERO_SHARED_ACCESS_TOKEN=...
XERO_SHARED_REFRESH_TOKEN=...
XERO_SHARED_TENANT_ID=...
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
- `POST /api/posting/draft`
- `GET /api/queue/review?provider=...`
- `GET /api/connectors/catalog?region=...`
- `GET /api/connectors/status`
- `GET /api/connectors/oauth/start`
- `GET /api/connectors/oauth/callback`
- `POST /api/connectors/disconnect`

Legacy compatibility:
- `POST /api/posting/freee/draft` (delegates to common router)
- `GET /api/posting/freee/draft` (freee queue compatibility)

## Architecture Modules

- `lib/core/types.ts`: canonical types (`CanonicalTransaction`, `ClassificationDecision`, etc.)
- `lib/core/decision.ts`: rule-first + LLM supplement + confidence gate
- `lib/core/jurisdiction.ts`: country profile plugin contract (JP default)
- `lib/core/regions.ts`: region door + platform routing map
- `lib/core/tenant.ts`: tenant context resolver (`organization_id`, `mode`)
- `lib/core/packs.ts`: business-pack extension model
- `lib/connectors/freee.ts`: OAuth token refresh + posting/list adapters
- `lib/connectors/accounting/router.ts`: provider router (`freee`, `quickbooks`, `xero`)
- `lib/connectors/ocr/gemini.ts`: receipt OCR extractor

## Security / Privacy

- Clerk auth required on new orchestrator APIs.
- PII masking before LLM usage.
- No receipt body/image in audit metadata logs.
- Policy docs:
  - `docs/security/PRIVACY_POLICY_MINIMAL.md`
- `docs/security/RLS_AUDIT_STORAGE_HARDENING.sql` (legacy DB setups only)

## PWA

- Manifest: `/public/manifest.json`
- Service Worker: `/public/sw.js`
- Offline fallback: `/public/offline.html`

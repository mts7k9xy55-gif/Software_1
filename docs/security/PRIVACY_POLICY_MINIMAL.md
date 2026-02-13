# Privacy Policy (Minimal Ops)

## Scope
This service handles POS sales data, expense ledgers, receipt images, and shift records for tax/accounting workflows.

## Data Handling
- Access control: Row-Level Security (RLS) separates data by shop.
- Receipt files: Stored in non-public Supabase Storage bucket (`expense-receipts`).
- Receipt access: Readable only via short-lived signed URLs.
- Audit trail: Key operations are recorded in `audit_logs`.
- LLM safety: Descriptions are redacted before external model calls when configured.

## What is sent to external services
- Tax/expense classification: only required fields (date, amount, redacted description, receipt flag).
- Receipt OCR: sent only when OCR is explicitly enabled.
- freee integration: accounting payloads required for deal/HR sync.

## Retention and deletion
- Sales/expense/shift records follow tenant retention policy.
- Receipt objects can be deleted by record deletion or lifecycle operations.
- Audit logs are retained for incident investigation and compliance checks.

## Operator policy
- Use least privilege for API keys and Supabase roles.
- Do not store plaintext secrets in code or logs.
- Rotate API keys on incident or role changes.

## Incident response (minimal)
1. Disable external LLM routing (`ENABLE_EXTERNAL_LLM=0`).
2. Revoke impacted API keys/tokens.
3. Export audit logs and investigate access paths.
4. Notify affected tenant operators with timeframe and impact.

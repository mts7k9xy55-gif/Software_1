# Tax Pack Spec

## Archive Name
- `tax-pack-{shop}-{start}-to-{end}.zip`

## Included Files
1. `sales-ledger-{start}-to-{end}.csv`
2. `expense-ledger-{start}-to-{end}.csv`
3. `profit-summary-{start}-to-{end}.csv`
4. `filing-readiness-{start}-to-{end}.json`
5. `tax-accountant-handoff-{start}-to-{end}.md`
6. `summary-{start}-to-{end}.json`
7. `README.txt`

## Readiness JSON Contract
- status: `READY | REVIEW_REQUIRED | BLOCKED`
- score: `0-100`
- exportBlocked: `boolean`
- blockers: `string[]`
- items[]:
- id: stable check id
- title: check name
- status: `READY | REVIEW | BLOCKER`
- reason: why this status was assigned
- action: next action to resolve or confirm

## Handoff Markdown Intent
- Give the accountant a quick human-readable checklist.
- Keep owner-side behavior simple (one-tap), while preserving explainability.

## Blocking Policy
- Export is blocked only when one or more readiness items are `BLOCKER`.
- `REVIEW` items do not stop export but must be visible in handoff outputs.

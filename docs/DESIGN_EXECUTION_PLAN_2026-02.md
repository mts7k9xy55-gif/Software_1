# Design Execution Plan (Tax Workflow)

## Goal
- Deliver a tax-filing draft workflow where the owner can run one tap and hand off only final checks to a tax accountant.
- Keep data leakage risk low and avoid operator-heavy UX.

## Scope for Initial Release
- In scope:
- POS sales aggregation
- Expense ingestion and conservative classification (rule + optional LLM)
- Filing readiness checks (blockers + manual-check items)
- Tax pack export (CSV/JSON/hand-off memo)
- Out of scope:
- Direct e-Tax submission
- Full payroll integration
- Automatic accounting journal finalization

## Non-Negotiables
- Reliability: export must not run when blockers exist.
- Simplicity: owner-facing flow starts from one button.
- Safety: no API keys on client, no sensitive payload over-sharing.

## Workflow Contract
1. Collect period data (sales, expenses, inventory).
2. Classify expenses conservatively.
3. Compute filing readiness.
4. If blockers exist: stop export and show exact blocker reasons.
5. If no blockers: produce tax pack ZIP for accountant review.

## Readiness Status
- READY: no blocking issues.
- REVIEW_REQUIRED: export allowed, but accountant should check listed items.
- BLOCKED: export stopped until blocker items are resolved.

## Operating Checklist (Each Release)
1. Run build successfully.
2. Verify one-tap flow in tax mode.
3. Verify readiness blocker messaging.
4. Verify ZIP includes readiness and handoff files.
5. Confirm environment keys are server-side only.

## Short-Term Milestones
1. Stabilize one-tap flow and blocker gating.
2. Reduce manual fields in tax mode (keep only necessary controls).
3. Add external connector strategy as separate layer (no UI clutter in core flow).

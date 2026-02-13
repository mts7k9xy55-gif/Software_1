# Global Filing Orchestrator V1

## Scope

- Two-screen UX: `All Transactions` and `Decision Queue`
- No internal persistence for receipt binaries in the new path
- freee draft expense posting as default sink

## Pipeline

`Ingest -> Normalize -> Rule Evaluate -> LLM Supplement -> Confidence Gate -> freee Draft -> Review`

## Main Contracts

### CanonicalTransaction
- transaction_id
- source_type
- direction
- occurred_at
- amount
- currency
- counterparty
- memo_redacted
- country_code

### ClassificationDecision
- rank: `OK | REVIEW | NG`
- is_expense
- allocation_rate (0..1)
- category
- amount
- date
- reason
- confidence (0..1)
- rule_version
- model_version

## Operational Defaults

- Standard posting mode: freee draft only
- Final booking responsibility: accountant
- Support boundary:
  - App: OAuth connectivity, intake, decision, posting pipeline
  - freee: accounting semantics, deal internals, platform-side restrictions

## Global Strategy

- Country profile plugin contract in `lib/core/jurisdiction.ts`
- JP profile active in V1
- AirREGI is treated as JP adapter, not global core

## Business Packs (future)

- Core Filing (default)
- Shift Touch Pack
- Inventory Pack
- Marketplace Pack
- POS Pack (JP)

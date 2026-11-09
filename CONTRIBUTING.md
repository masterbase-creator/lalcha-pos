# Contributing to Lalcha POS

Thank you for helping. For anything larger than a small fix, please open an issue first so we can agree on the approach.

## Setup

Follow [Getting started](README.md#getting-started).

## Before opening a pull request

```bash
pnpm typecheck
pnpm test
```

If you changed the database schema, generate a migration with `pnpm --filter @lalcha/api db:generate` and commit it. If you added a table with store data, add it to `apps/api/src/rls.sql`.

## Rules that protect store data

- Money is stored as whole poisha, never decimals.
- Quantities are stored as whole thousandths, so 1 piece is 1000 and 1.25 kg is 1250.
- Every store-owned table has `store_id`, and every store-owned query runs through `withStore`.
- Stock changes only by adding ledger entries.
- Sales, payments and returns are append-only.
- Anything a till records offline must be safe to upload twice.
- User-facing text goes in `apps/pos/src/i18n.ts`, in both English and Bangla.
- By contributing, you agree that your work is licensed under the AGPL-3.0.

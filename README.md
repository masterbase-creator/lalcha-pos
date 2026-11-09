# Lalcha POS

Open source point of sale and retail management for shops in Bangladesh. Built to run a single store or to be hosted for thousands, with each store on its own subdomain.

> **Status: early development.** The core works and is tested, but it has not run in a real shop yet. See [Before production](#before-production).

## Features

**Selling**
- Bangla and English interface, with product images
- Billing keeps working with no internet and uploads when the connection returns
- Barcode scanner input, thermal receipt layout
- Items sold by piece, kg, litre or metre, by quantity or by taka amount
- Cash, bKash, Nagad, card and baki (credit), including part-payments
- Mushak 6.3 VAT details on receipts, with the rate set by the store owner
- Shifts with opening float and closing cash count

**Back office**
- Products, photos and stock, with a permanent stock ledger
- Suppliers, purchase orders, goods received, dues, weighted average cost
- Purchase returns and voids
- Customer baki with credit limits and collections
- Sales returns against the original receipt, with return receipts
- Reports with profit, payment split, top products and staff sales, exportable to Excel and PDF

**Platform**
- Self-service store signup with a free trial and per-store subdomains
- Owner, manager and cashier roles, enforced on the server
- Phone-code device connection and staff PINs, including offline PIN sign-in
- Subscription plans with manual bKash/Nagad payment review
- PostgreSQL row-level security between stores

## Tech stack

| Part | Technology |
|---|---|
| POS and back office | React, TypeScript, Vite, Tailwind CSS |
| On-device storage | SQLite (WebAssembly, OPFS) and a service worker |
| API | Node.js, Hono, Drizzle ORM |
| Database | PostgreSQL |

## Getting started

You need Node.js 22 or newer, pnpm 9 and PostgreSQL. Your PostgreSQL user must be able to create roles.

```bash
createdb lalcha_dev
pnpm install
pnpm db:setup
pnpm start
```

Open <http://localhost:4173>. Sample stores, staff and test sign-ins are listed in `DEV_STAFF` in [`apps/api/src/setup.ts`](apps/api/src/setup.ts). In development, phone codes appear on screen.

| Page | Address |
|---|---|
| Sample store | <http://localhost:4173> |
| A store by subdomain | `http://<subdomain>.localhost:4173` |
| New store signup | <http://localhost:4173/signup> |
| Platform admin | <http://localhost:4173/admin> |

The app is served as a production build, because offline support relies on its service worker. Restart `pnpm start` to see code changes.

## Project layout

```text
apps/
  api/             API server, database schema, migrations, access rules
  pos/             POS and back-office web app
packages/
  domain/          Money, quantity and validation rules shared by both apps
```

## Commands

| Command | What it does |
|---|---|
| `pnpm start` | Build the POS and run the app and API |
| `pnpm test` | Run the shared rules tests |
| `pnpm typecheck` | Type-check every package |
| `pnpm db:setup` | Apply migrations, access rules and sample data |

## Configuration

Local development needs no configuration. Production settings are described in [`.env.example`](.env.example). Plan prices are placeholders in `PLANS` in [`packages/domain/src/index.ts`](packages/domain/src/index.ts).

## Before production

- Connect an SMS provider in `sendLoginCode` in [`apps/api/src/auth.ts`](apps/api/src/auth.ts). Sending codes fails in production until you do.
- Do not load sample data. Add a production migration path that skips the sample seed in `setup.ts`.
- Add network-level rate limiting in front of the API.
- Store product photos in object storage instead of the API server's disk.
- Check the Mushak 6.3 invoice layout, and whether National Board of Revenue approval applies, with a VAT consultant.
- Test with your real scales, scanners and printers.

Not built yet: the customer-facing online store, Android, iOS and desktop packages, and scale-printed barcode labels.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Please report security problems as described in [SECURITY.md](SECURITY.md).

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must offer its source code to your users.

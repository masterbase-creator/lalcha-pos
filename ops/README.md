# Running Lalcha on a server

Everything the server needs besides the code lives here, so a deploy keeps them in step.

| File | What it is |
| --- | --- |
| `deploy.sh` | Checks the code, copies it up, builds, updates the database, restarts, then health-checks from outside. Restores the previous version if the API doesn't come back. |
| `deploy.env.example` | Copy to `deploy.env` (ignored by git) with your server and key. |
| `nginx/` | Web server settings: only Cloudflare may reach the origin, security headers, the visitor's real address. |
| `lalcha-watch` | Emails `PLATFORM_ADMIN_EMAILS` (or `ALERT_EMAILS`) when the site, API, demo, backup or disk has a problem, and again when it clears. |
| `lalcha.cron` | Hourly demo reset, nightly backup and cleanup, and the five-minute watch. |
| `lalcha-db`, `lalcha-maint` | Database updates, demo reset, backups. |
| `harden-ssh.sh` | Run once: key-only SSH sign-in. |

## Deploy

```bash
ops/deploy.sh
```

## Tests

```bash
pnpm e2e
```

runs against a local `pnpm start`: an outsider's security checks, then one shop from signup to reports
(`tests/e2e/`). `pnpm e2e:live` runs the outsider checks against the live site; they create nothing.
To run the whole shop journey on the live site, give it a mailbox you can read:

```bash
E2E_SCHEME=https E2E_DOMAIN=lalcha.com E2E_EMAIL=you@example.com node tests/e2e/journey.mjs
```

## Alerts

`lalcha-watch test` sends a test email. The watcher runs on the server, so it cannot tell you the
whole server is off. Add one outside check as well: any uptime service (or a Cloudflare Health
Check) on `https://lalcha.com/health`, which answers only while the API is up.

## Things only the account owner can do

- Replace any storage (R2) key that has been pasted into a chat or email, then put the new one in `/etc/lalcha/api.env`.
- Put Cloudflare Access in front of the admin address, so the admin sign-in page itself needs your Cloudflare login.

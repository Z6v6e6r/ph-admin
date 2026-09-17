# CUP notification block: technical admin-token login

The CUP «Уведомления» block opens its own PadlHub admin session. The regular flow is a phone code
issued by the identity provider, so a contour without SMS delivery cannot be opened that way at all.
This runbook describes the temporary operator path used for staging verification: mint one
short-lived `phub-admin` access token on the target PadlHub host and paste it into the block.

Use it only while the target contour has no code delivery. It is a verification aid, not a product
login method.

## Mint one token

Run this on the PadlHub host that serves the target contour (root), replacing `<runtime-env-root>`
with the directory that holds the rendered service env files (`/etc/phub/<contour>` for Timeweb, or
the release working directory's env file for a systemd contour), `<admin-user-id>` with an account
that has `notifications.manage`, and `<tenant-id>` with the tenant the campaigns belong to.

```bash
cat > /root/cup-mint-token.mjs <<'JS'
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";

const envPath = process.argv[2];
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);
const b64 = (value) => Buffer.from(value).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const payload = b64(
  JSON.stringify({
    sub: process.argv[3],
    tenants: [process.argv[4]],
    roles: ["admin"],
    permissions: ["notifications.manage"],
    sid: randomUUID(),
    iat: now,
    exp: now + Math.min(Number(process.argv[5] || 3600), 7200),
    iss: env.JWT_ISSUER,
    aud: env.JWT_ADMIN_AUDIENCE || "phub-admin",
  }),
);
const signature = createHmac("sha256", env.JWT_ACCESS_SECRET)
  .update(header + "." + payload)
  .digest("base64url");
writeFileSync("/root/.cup-admin-token", header + "." + payload + "." + signature);
chmodSync("/root/.cup-admin-token", 0o600);
console.log("token written for " + process.argv[3] + ", ttl=" + (process.argv[5] || 3600) + "s");
JS
node /root/cup-mint-token.mjs <runtime-env-root>/api.env <admin-user-id> <tenant-id> 3600
```

The script reads the signing secret on the host and never prints it or the token. Keep the token TTL
short: **one hour is enough and two hours is the ceiling** (`3600`, at most `7200`). Mint for a single
named operator account, never for a shared or service account.

## Use it in the CUP

1. Open the CUP, go to «Уведомления».
2. Expand «Технический вход по admin-токену (временно)».
3. Print the token on the host and paste it:
   `ssh <host> 'cat /root/.cup-admin-token'`
4. Press «Войти по токену». The first request is the channel-capabilities read, and it runs
   **without** the session-refresh fallback, so a token that is expired, minted for the wrong
   audience, or missing `notifications.manage` is rejected here and never reaches a campaign; the
   rejected value is dropped from both the tab storage and the input field. The workspace opens only
   after that read succeeds.

The panel keeps the token in this tab's `sessionStorage` only, clears the input after use (also on
rejection), and forgets the token on «Выйти». A token that expired while stored is dropped and the
block returns to the code flow; a session that expires in the middle of a round hides the workspace
and returns the operator to the login card instead of leaving an armed dead session.

Note that `sessionStorage` is per tab but not a secret store: a duplicated tab or a script in the
same origin can read it. That is why the TTL above is a hard ceiling.

## Clean up

- Log out of the CUP (or close the tab) and delete the minted token:
  `ssh <host> 'rm -f /root/.cup-admin-token /root/cup-mint-token.mjs'`
- Never copy the token into a repository, an env file, a ticket or a chat.

## Owner and removal

- Owner: the CUP operator lead who runs the verification round; the change itself is owned by the
  panel maintainers.
- Review date: **2026-10-17**. If the path is still needed then, re-confirm the entry or remove it.
- Removal criterion: delete the technical token path from `client-sdk/phab-admin-panel.js` (composer
  section, `setAccessToken` plumbing, the `submitNotificationTokenLogin` branch and the
  `sessionStorage` key) once the CUP block has a production login that does not depend on SMS
  delivery (for example the provider OAuth flow), or once the target contour has working code
  delivery. Both panel tests must be updated in the same change.

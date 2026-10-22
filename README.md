# ozow-mcp

An MCP server for [Ozow](https://ozow.com), the South African instant EFT
("pay by bank") gateway. It lets an AI assistant create and track Ozow payment
requests.

**It is locked to Ozow's staging environment unless production is explicitly
unlocked twice over.** That is the main design decision; the rest of this file
explains it.

Node 20+. One runtime dependency (the MCP SDK) plus zod.

## The safety model

An MCP server that wraps a payments API gives a language model the ability to
move money. That deserves more care than a typical API wrapper, so:

**1. Staging by default.** Ozow selects environment by base URL, not a request
flag, so a staging-configured server has no route to production. This is
structural, not a check that can be forgotten.

**2. Production needs two independent keys turned.** `OZOW_ENV=production` *and*
`OZOW_ALLOW_PRODUCTION=i-understand-this-moves-real-money`. Setting only the
first makes the server **refuse to start**. It never silently downgrades to
staging - an operator who believes they are live but is not ends up in a worse
position than one who cannot start at all.

**3. Per-call confirmation, but only where it means something.** In production,
`ozow_create_payment` requires `confirm="CONFIRM LIVE PAYMENT"` exactly. In
staging it does not: confirmation friction on imaginary money teaches people to
click through, which is worse than no friction at all. The tool description
tells the model, in as many words, not to supply that phrase on its own
initiative.

**4. An amount ceiling.** `OZOW_MAX_AMOUNT` (default R1000) caps any single
request, so a miscounted zero hits a wall instead of a bank account.

**5. Honest tool annotations.** Read-only tools declare `readOnlyHint`; payment
and cancel tools declare `destructiveHint`. Clients that surface these can ask
the user before the call rather than after.

**6. Secrets stay out of output.** The environment tool masks the client ID and
never returns the secret. There is a test that fails if either leaks.

## Setup

```
npm install
cp .env.example .env     # fill in from the Ozow Portal
npm run check            # validates config and credentials, moves no money
```

You need an Ozow merchant account first, then ask Ozow support or your account
manager to enable **One API clients** in the portal, where the client ID and
secret are created.

## Tools

| Tool | Reads/writes | Notes |
|---|---|---|
| `ozow_environment` | read | Which environment, limits, whether money is real. No network call. |
| `ozow_verify_credentials` | read | Confirms the client ID and secret get a token. |
| `ozow_create_payment` | **write** | Returns a `redirectUrl` for the payer. Confirmation required in production. |
| `ozow_get_transactions` | read | Whether a payment request was paid. |
| `ozow_cancel_payment` | **write** | Irreversible. |

## Connecting a client

```json
{
  "mcpServers": {
    "ozow": {
      "command": "node",
      "args": ["/absolute/path/to/ozow-mcp/src/index.mjs"],
      "env": {
        "OZOW_CLIENT_ID": "...",
        "OZOW_CLIENT_SECRET": "...",
        "OZOW_SITE_CODE": "XXX-XXX-XXX",
        "OZOW_ENV": "staging"
      }
    }
  }
}
```

## Tests

```
npm test
```

20 tests. The guard tests are pure and need no credentials; the server tests
spawn the real binary and speak MCP to it over stdio, checking that the
staging default holds, that production refuses to start unacknowledged, that
over-ceiling and non-https requests are rejected before any network call, and
that secrets never reach the output.

## Status and caveats

Early. Written against Ozow's One API (`one.ozow.com/v1`), not the legacy i-Pay
Payment API - confirm with Ozow which applies to your account, as the published
docs cover both and disagree.

**One correction to Ozow's own docs:** their quick-start gives the token
endpoint as `<api host>/v1/token`. That path returns 404 on both hosts. Tokens
are actually issued by a separate auth host - `auth.ozow.com/token` and
`stagingauth.ozow.com/token` - which answer `client_credentials` with standard
OAuth2 errors. This server uses those. The `/v1/payments` paths in the docs are
correct (they return 401, not 404, without a valid token).

Not yet covered: payouts (money out), which Ozow gates behind separate approval
and staging tests; refunds, which their docs describe as a dashboard action
rather than an API call; and webhook verification for `transaction.complete`.

Endpoint paths were probed directly and behave as expected for unauthenticated
requests. The server has **not** yet been run against a live Ozow staging
account with real credentials, so request and response bodies are built from
the documentation rather than from observed traffic. Expect to adjust field
names on first contact.

## Licence

MIT

## Publishing

The order matters: the official MCP Registry is upstream of the directories,
so publishing there is what makes the rest happen.

### 1. GitHub and npm

```bash
gh repo create zerotaldev/ozow-mcp --public --source=. --push
npm publish
```

`package.json` carries `"mcpName": "io.github.zerotaldev/ozow"`. The registry
checks that marker matches the `name` in `server.json`; if they drift, the
publish is rejected as an ownership failure.

### 2. The official MCP Registry

```bash
mcp-publisher login github      # device-code OAuth, grants io.github.zerotaldev/*
mcp-publisher publish --dry-run # validates without publishing
mcp-publisher publish
```

The GitHub login is what entitles the `io.github.zerotaldev/*` namespace. If
you would rather publish under your own domain as `com.ciyane/ozow`, use
`mcp-publisher login dns --domain ciyane.com` instead and change `name` in
`server.json` to match — the namespace must agree with the login method or the
publish is refused.

`server.json` validates against the `2025-12-11` schema. Note the registry caps
`description` at 100 characters.

### 3. Glama

`glama.json` in the repo root claims the listing for the `zerotaldev`
maintainer. Glama also discovers servers from GitHub, and you can add one
manually with **Add MCP Server** on their servers page using the repository
URL. Their FAQ says most submissions pass automatically within minutes.

### 4. PulseMCP

Nothing to submit. PulseMCP paused direct submissions while they rework
ingestion, and they build listings by scraping the official registry and
GitHub. Publishing in step 2 is what gets you there.


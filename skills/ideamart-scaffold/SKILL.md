---
name: ideamart-scaffold
description: Scaffold a new Ideamart integration from scratch — environment config, credential handling, the API client, and typed request/response models. Use when adding Ideamart to a project for the first time, or when the user asks to set up, bootstrap, or start an Ideamart integration.
---

# Scaffold an Ideamart integration

Build in this order. The order matters: config first means no credential ever has a chance
to land in a source file.

## 1. Establish what exists

Ask, or find in the code:

- Provisioned app? (`APP_00XXXX` + password) — if not, they are pre-provisioning; read
  `references/01-getting-started.md` and walk them through it. You can still build against a
  local mock.
- Which APIs were provisioned? Calling an unprovisioned service fails `E1309` no matter how
  correct the payload.
- A public HTTPS URL for callbacks? Required for MO SMS, USSD and all notifications.
- A **static egress IP**? Required — `curl -4 https://myip.ideamart.io` on the server that
  will make the calls.

## 2. Pick the stack — the host project's, not the template's

Ideamart is JSON over HTTPS, so build in whatever the project already uses. `templates/` ships
config + client + callbacks for **TypeScript/Node, Python, Java, Go, PHP and C#**
(`templates/README.md` indexes them); for anything else, take the calls from
`references/13-curl-reference.md` and follow the seven components and the acceptance checklist
in `references/11-any-stack.md`. Never add a second runtime for this.

## 3. Config before code

Copy `templates/.env.example` — the variable names are identical in every language — and the
config file from your language's directory. Requirements:

- One module reads the environment; nothing else does.
- Validate at startup and **fail loudly** on anything missing.
- `.env` git-ignored; `.env.example` placeholders only.

## 4. One client, one `post()` helper

Every Ideamart call is the same HTTPS POST, so the client is one `post()` that injects
credentials, sets a timeout and raises a typed error on non-`S1000`, plus a thin wrapper per
service.

Write it from `references/13-curl-reference.md`. Each endpoint is there as a runnable curl with
every parameter defined and every response field explained: translate the request into the
project's own HTTP client, one wrapper per service, and put the seven components from
`references/11-any-stack.md` around them. Run the curl first — a payload proven by hand is one
you cannot get wrong in code.

The error module is `references/08-status-codes.md`: all 86 codes with their handling class, the
four classes, and the three benign codes (`E1351` register, `E1356` unregister, `E1379` debit).
Build the sets from the Class column, or straight from `catalog/ideamart-api.json`.

If the project is in TypeScript/Node, Python, Java, Go, PHP or C#, read the matching
`templates/` implementation for shape and port its structure — but write in this project's
conventions, with its HTTP client, logger and config loader. Keep the `statusCode` branching and
the benign codes exactly as specified.

Never recall parameter names; `show <id>` and the curl reference have the exact contract.

## 5. Callbacks

Half the integration is inbound. Use the `ideamart-callbacks` skill.

## 6. Verify

```bash
node tools/ideamart.mjs validate <id> '<payload you generated>'
./scripts/smoke-test.sh          # or .\scripts\smoke-test.ps1
```

Both scripts are plain curl, so they verify a handler in any language. For a port into a stack
with no template, finish with the acceptance checklist in `references/11-any-stack.md`.

No provisioned application yet? Everything above still works except the live calls. If — and
only if — the developer asks for one, build a local mock server that answers every endpoint
from the catalog's sample responses and can return `E1303` / `E1313` / `E1378` / a timeout on
demand; point the `IDEAMART_*_URL` variables at it. Do not create one unprompted.

Match the host project's stack and conventions. The templates are a specification, not a
framework to impose.

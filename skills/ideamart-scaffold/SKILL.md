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
(`templates/README.md` indexes them); for anything else, follow the seven components and the
acceptance checklist in `references/11-any-stack.md`. Never add a second runtime for this.

## 3. Config before code

Copy `templates/.env.example` — the variable names are identical in every language — and the
config file from your language's directory. Requirements:

- One module reads the environment; nothing else does.
- Validate at startup and **fail loudly** on anything missing.
- `.env` git-ignored; `.env.example` placeholders only.

## 4. One client, one `post()` helper — generate it

```bash
node tools/ideamart.mjs codegen client --lang=<language> --out=<your integration dir>
node tools/ideamart.mjs codegen errors --lang=<language> --out=<same dir>
```

That is every service wrapper over a single `post()` that injects credentials, sets a timeout
and raises a typed error on non-`S1000`, plus all 86 status codes with their handling classes.
Adapt it to the project's conventions — swap in the project's HTTP client, logger and config
loader — but keep the `statusCode` branching and the benign codes exactly as generated.

Generating one call at a time: `node tools/ideamart.mjs codegen <service-id> --lang=<language>`.
Never recall parameter names; `show <id>` has the exact contract.

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

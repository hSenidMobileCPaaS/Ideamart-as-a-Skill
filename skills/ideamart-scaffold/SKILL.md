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

## 2. Config before code

Copy `templates/.env.example` and `templates/typescript/ideamart-config.ts`. Requirements:

- One module reads `process.env`; nothing else does.
- Validate at startup and **throw** on anything missing.
- `.env` git-ignored; `.env.example` placeholders only.

## 3. One client, one `post()` helper

Copy `templates/typescript/ideamart-client.ts`. Every service is a thin wrapper over a single
`post()` that injects credentials, sets a timeout, retries only transient codes, and throws a
typed error on non-`S1000`.

Get each contract with `node tools/ideamart.mjs show <id>` — do not recall parameter names.

## 4. Callbacks

Half the integration is inbound. Use the `ideamart-callbacks` skill.

## 5. Verify

```bash
node tools/ideamart.mjs validate <id> '<payload you generated>'
./scripts/smoke-test.sh          # or .\scripts\smoke-test.ps1
```

Match the host project's stack and conventions. The templates are a specification, not a
framework to impose.

# Contributing

This skill is proprietary software owned by hSenid Mobile Solutions (Pvt) Ltd. See
[LICENSE](LICENSE).

**External pull requests and forks are not accepted.** The licence does not permit modifying
or redistributing the skill, so there is no contribution path that would be lawful to merge
from outside hSenid Mobile.

That does not mean feedback is unwelcome — it is the most valuable thing you can send.

## What to report

Open an issue. Accuracy reports are the highest-value contribution, because a wrong parameter
name in this skill becomes a wrong parameter name in someone's production integration.

- **The API contract has changed** — a parameter that is now required, a new enum value, a
  changed endpoint. Include the docs page or the observed response.
- **A status code** you have seen that is not in the table.
- **Per-operator differences** between Dialog, Hutch and Airtel.
- **Bad guidance** — the skill led an agent to write incorrect, insecure or non-compliant code.
- **Agent support** — a platform that should load the skill but does not.
- **New services**, such as IVR once it is published.

Anything factual needs a source: a link to <https://docs.ideamart.io>, or a real
request/response pair with credentials and MSISDNs redacted.

## Never include in an issue

- A real `applicationId` or `password`. If you have already pasted one anywhere, rotate it in
  the portal first — see [SECURITY.md](SECURITY.md).
- A real subscriber MSISDN. Use `tel:94771234567`.
- Anything copied from a production log.

## For hSenid Mobile maintainers

The catalog is the source of truth. `catalog/ideamart-api.json` drives the CLI, the tests and
much of the documentation. When a contract changes:

1. Edit `catalog/ideamart-api.json`.
2. Update the matching `references/*.md` so prose and data agree.
3. Run `npm test` — the suite checks that every referenced status code exists, every parameter
   is fully specified, every documented sample validates against its own schema, and every
   referenced file is present.

Agent rule files are generated. `AGENTS.md` is the single source; the Cursor, Windsurf, Cline,
Kiro, Qoder, Copilot and `.agents` copies come from it:

```bash
node scripts/sync-rules.mjs          # regenerate
node scripts/sync-rules.mjs --check  # CI check
```

Edit `AGENTS.md`, never a generated copy. CI fails if they drift.

Templates are per-language ports of one specification. Adding a language means: a directory
under `templates/` with config, client and callback handlers; the same `IDEAMART_*` variable
names as every other port; a row in `templates/README.md` and in the shipped-templates table in
`references/11-any-stack.md`; and an entry in `TEMPLATE_LANGUAGES` in
`tests/packaging.test.js`, which enforces all of the above. Ideamart is JSON over HTTPS — no
guidance in this repo may assume a particular runtime.

Before pushing:

```bash
npm test                             # catalog, tooling and packaging tests
node scripts/sync-rules.mjs --check  # rule copies in sync
bash -n scripts/*.sh                 # shell scripts parse
node tools/ideamart.mjs list         # CLI still works
```

### Style

- Write for someone integrating at 2am with a failing call. Lead with what to do.
- State the consequence, not just the rule — "never retry with a new `externalTrxId`" lands
  because the next clause says it double-charges a real person.
- When the official documentation is inconsistent, say so and tell the reader to handle both
  cases. Do not silently pick one.
- No invented endpoints, parameters or status codes. If it is not documented or observed, say
  it is not documented.

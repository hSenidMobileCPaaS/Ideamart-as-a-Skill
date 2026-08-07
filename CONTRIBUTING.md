# Contributing

Corrections are the most valuable contribution here. This skill is only useful if it is
accurate, and Ideamart changes.

## What is most wanted

- **Corrections to the API contract** — a parameter that is now required, a new enum value, a
  changed endpoint. Cite the documentation page or paste the observed response.
- **New services** — IVR when it is published, or anything else Ideamart adds.
- **Status codes** seen in the wild that are not in the table.
- **Per-operator differences** between Dialog, Hutch and Airtel.
- **Reference implementations** in other languages (Python, PHP, Java, Go).

Anything factual needs a source: a link to <https://docs.ideamart.io>, or a real
request/response pair with credentials redacted.

## Never commit

- A real `applicationId` or `password`. CI fails the build if it finds one, but do not rely on
  that.
- A real subscriber MSISDN. Use `tel:94771234567`.
- Anything from a production log.

## The catalog is the source of truth

`catalog/ideamart-api.json` drives the CLI, the tests, and much of the documentation. When you
change a contract:

1. Edit `catalog/ideamart-api.json`.
2. Update the matching `references/*.md` so prose and data agree.
3. Run `npm test` — the suite checks that every referenced status code exists, every parameter
   is fully specified, every sample validates against its own schema, and every referenced file
   is present.

## Agent rule files are generated

`AGENTS.md` is the single source. The Cursor, Windsurf, Cline, Kiro, Qoder, Copilot and
`.agents` copies are generated from it:

```bash
node scripts/sync-rules.mjs          # regenerate
node scripts/sync-rules.mjs --check  # CI check
```

Edit `AGENTS.md`, never a generated copy. CI fails if they drift.

## Before opening a pull request

```bash
npm test                             # 32 catalog and tooling tests
node scripts/sync-rules.mjs --check  # rule copies in sync
bash -n scripts/*.sh                 # shell scripts parse
node tools/ideamart.mjs list         # CLI still works
```

## Style

- Write for someone integrating at 2am with a failing call. Lead with what to do.
- State the consequence, not just the rule — "never retry with a new `externalTrxId`" lands
  because the next clause says it double-charges a real person.
- When the official documentation is inconsistent, say so and tell the reader to handle both
  cases. Do not silently pick one.
- No invented endpoints, parameters or status codes. If it is not documented or observed, say
  it is not documented.

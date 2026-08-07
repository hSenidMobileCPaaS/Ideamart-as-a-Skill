# Security Policy

## This repository contains no secrets

Every credential in this repo is a placeholder. `templates/.env.example` holds only
`APP_XXXXXX` and `replace-me`. CI fails the build if a credential-shaped value is committed.

If you believe a real credential has been committed here, **do not open a public issue**.
Email the maintainers privately, and rotate the credential in the Ideamart portal first —
rotation matters more than disclosure timing.

## If you leak your own Ideamart credentials

An `applicationId` + `password` pair can send SMS to your entire subscriber base and debit
real money from real people's phone accounts. Treat exposure as an active incident.

1. **Rotate the password in the Ideamart portal.** Do this before anything else.
2. Deploy the new value.
3. Review your application reports for unexpected SMS volume or charges.
4. Purge from git history with `git filter-repo` — and understand that anything pushed to a
   public remote must be treated as permanently public regardless.
5. Contact Ideamart support if you see unauthorised usage: `info@ideamart.io`,
   WhatsApp +94767412345.

Assume a credential is compromised the moment it lands anywhere shared: a commit, a chat
message, a screenshot, a log aggregator, a pasted stack trace, or an AI prompt.

## Reporting a problem with this skill

Open an issue for anything that would lead an agent to write insecure code — a missing
warning, guidance that encourages hardcoding, a dangerous default in a template.

Report privately instead if the issue is directly exploitable, for example a template that
leaks credentials or a script that transmits them somewhere.

## Scope

This skill is documentation, reference templates, and an offline CLI. It:

- makes **no network calls** — `tools/ideamart.mjs` reads a local JSON file and nothing else
- **never reads your credentials** — request builders emit `$IDEAMART_APP_ID` placeholders
- has **no runtime dependencies**

The `scripts/smoke-test.*` scripts do call Ideamart, deliberately, using credentials from your
environment. Read them before running them, and note that `--with-charge` moves real money.

## Maintenance

Maintained by hSenid Mobile Solutions for Ideamart. The platform evolves, so verify anything
security- or billing-critical against <https://docs.ideamart.io> before going live, and
confirm with support what your application is actually provisioned for.

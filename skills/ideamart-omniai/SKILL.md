---
name: ideamart-omniai
description: Build against OmniAI, Ideamart's AI gateway — chat completions across Claude, Gemini and GPT models, and image generation, on an OpenAI-shaped API billed from an Ideamart token balance. Use whenever the user mentions OmniAI, omniai.ideamart.io, `api.ideamart.io/omniai`, an Ideamart AI or LLM feature, chat completions, model routing, or generating images through Ideamart — and whenever an AI answer has to reach a subscriber over SMS or USSD.
---

# OmniAI — the Ideamart AI gateway

One OpenAI-shaped API in front of several model providers, authenticated once against Ideamart
and billed from an Ideamart token balance.

```bash
node tools/ideamart.mjs omniai                 # auth, endpoints, models, rules
node tools/ideamart.mjs omniai models          # what each model is for
node tools/ideamart.mjs omniai errors          # every failure and its fix
node tools/ideamart.mjs show omniai-chat-completions
node tools/ideamart.mjs curl omniai-chat-completions model=claude-sonnet-4
node tools/ideamart.mjs validate omniai-chat-completions '<json>'
node tools/ideamart.mjs code TOKEN_QUOTA_EXCEEDED
```

Full contract: **`references/14-omni-ai.md`**. Every endpoint as a runnable curl with each
parameter defined: **`references/13-curl-reference.md`**, section *The AI gateway — OmniAI*.

## Read this before writing a line

**OmniAI is not the telco platform.** It shares the brand, the portal login and the
`api.ideamart.io` host, and nothing else. Every convention the rest of this skill teaches is
inverted here:

| | Telco APIs | OmniAI |
|---|---|---|
| Credential | `applicationId` + `password` in the **body** | one key in the `Authorization` **header** |
| Key source | IdeaPro provisioning | the OmniAI portal — a **different** key |
| Failures | HTTP 200 always; branch on `statusCode` | real HTTP status codes; branch on the status, then `error.code` |
| Success | `statusCode: "S1000"` | HTTP 2xx. There is no `statusCode` field |
| Subject | a subscriber, `tel:947…` | no subscriber, no MSISDN, no operator |
| Inbound | five callbacks you host | none. OmniAI never calls you |
| Timeout | 15s | 60–120s |

**So keep two clients.** A single shared HTTP helper applies exactly one of these conventions
and is wrong for half the calls. The classic bug is an OmniAI client that checks `res.ok`, then
looks for `statusCode`, finds nothing, and reports a good answer as a failure.

## Auth

```
Authorization: app_<keyId>.<keyValue>
```

Verbatim, including `app_`. **Not** an OAuth bearer token — no `Bearer` prefix, no base64. Not
your Ideamart application password. From `OMNIAI_API_KEY`, backend only.

It is a **spend key** against a prepaid balance, and unlike the telco APIs it is **not
IP-whitelisted** — a leak works from anywhere in the world until you rotate it at
<https://omniai.ideamart.io>.

## Endpoints

| Endpoint | Purpose | Variable |
|---|---|---|
| `POST /omniai/api/v1/chat/completions` | chat, on `claude-sonnet-4`, `gemini-2.5-pro`, `gemini-2.5-flash-lite`, `gpt-4o-mini` | `OMNIAI_CHAT_COMPLETIONS_URL` |
| `POST /omniai/api/v1/images/generations` | images, on `gpt-image-1` | `OMNIAI_IMAGE_GENERATIONS_URL` |

Base: `https://api.ideamart.io/omniai/api`.

## Six rules that are never negotiable

1. **Cap every call.** `max_completion_tokens` on every chat request, `n` at 1, image `quality`
   at `low` unless the image is the product. Without a ceiling one loop empties the balance and
   takes every AI feature down with a `402`.
2. **Redact before the prompt.** No MSISDN, no `subscriberId` (a masked hash is still a stable
   identifier), no OTP, no credential, no `externalTrxId` — not in `messages`, not in `prompt`,
   not in `user`, `safety_identifier` or `prompt_cache_key`. Prompts leave your trust boundary
   and reach a third-party provider. Keep `store` false.
3. **Check `finish_reason` before using the content.** `length` means the answer is cut off
   mid-sentence; the request succeeded, the answer did not.
4. **Branch on `error.code`, not the message.** The two `429`s differ:
   `RATE_LIMIT_EXCEEDED` clears within the minute, `TOKEN_QUOTA_EXCEEDED` never will —
   retrying it burns your attempts and delays the alert that would fix it.
5. **Never call a model inside a callback response path.** Ideamart wants `S1000` immediately
   and USSD sessions die in seconds. Acknowledge first, generate out of band, deliver by MT SMS
   or on the next USSD screen.
6. **Treat model output as untrusted input.** Never execute it, never interpolate it into SQL or
   a shell, and never send it to a subscriber unchecked — 160 GSM-7 characters per SMS part, 70
   for Sinhala or Tamil, and every part is billed.

## Retry policy

Retry with capped exponential backoff and jitter: `429` + `RATE_LIMIT_EXCEEDED` (honour
`Retry-After`), `500`, `502`, `503`, and transport errors. Never retry `400`, `401`, `403`,
`404`, `402`, or `429` + `TOKEN_QUOTA_EXCEEDED` — alert on those instead. Chat completions have
no idempotency key, so a timed-out call may already have been billed: cap retries at two.

`INVALID_LLM_CONFIG` is the OmniAI `E1309` — provisioning, not payload. No reformatting fixes it.

## Build it in the project's own stack

Same as everywhere else in this skill: two HTTPS POSTs, no privileged runtime, no SDK required.
Translate the curl in `references/13-curl-reference.md` into the host project's HTTP client.
`references/11-any-stack.md` specifies the surrounding components; `references/14-omni-ai.md`
lists the four that behave differently for OmniAI, and closes with a pre-ship checklist.

Related skills: `ideamart` (the telco platform), `ideamart-callbacks` (what an AI flow must not
block), `ideamart-review`, `ideamart-debug`.

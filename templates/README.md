# Templates

Working reference implementations of an Ideamart integration. **They are a specification, not
a framework to impose.** Read the one closest to the host project, port the structure, and keep
that project's own conventions.

Ideamart is JSON over HTTPS: no language, framework or runtime is privileged. Pick by what the
project already uses — introducing a second runtime because a sample was in another language is
a worse outcome than any template mismatch.

| Stack | Files | Notes |
|---|---|---|
| **Any** | [.env.example](.env.example) | The environment surface, identical everywhere: two credentials plus one URL per provisioned service |
| **TypeScript / Node** | [typescript/](typescript/) — `ideamart-config.ts`, `ideamart-client.ts`, `ideamart-types.ts`, `callbacks-nextjs.ts`, `ussd-session.ts` | The most complete set, with the fullest commentary. Callback routes are Next.js App Router; the logic ports to Express, Fastify, Hono or NestJS unchanged |
| **Python** | [python/](python/) — `ideamart_config.py`, `ideamart_client.py`, `callbacks_fastapi.py`, `ussd_session.py` | Standard library only; `httpx`/`requests` swap noted inline. Callbacks are FastAPI; Django/Flask notes at the foot of the file |
| **Java** | [java/](java/) — `IdeamartConfig.java`, `IdeamartClient.java`, `IdeamartCallbackController.java` | Java 17 `HttpClient` + Jackson. Callbacks are Spring Boot with `@Async` |
| **Go** | [go/](go/) — `config.go`, `client.go`, `callbacks.go` | Standard library only. Handlers are `http.HandlerFunc`, so they mount on chi/gin/echo unchanged |
| **PHP** | [php/](php/) — `IdeamartConfig.php`, `IdeamartClient.php`, `callbacks.php` | cURL extension, no Composer dependency. Framework-neutral callbacks with Laravel notes inline |
| **C# / .NET** | [csharp/](csharp/) — `IdeamartOptions.cs`, `IdeamartClient.cs`, `IdeamartCallbacks.cs` | `IHttpClientFactory` + `System.Text.Json`. Callbacks are minimal APIs with a `BackgroundService` worker |

Every port implements the same seven components and the same environment variable names. The
language-neutral specification — including an acceptance checklist for stacks with no template
here (Ruby, Rust, Kotlin, Elixir, …) — is
[references/11-any-stack.md](../references/11-any-stack.md).

**No template for your stack?** Nothing is missing. Take the calls from
[references/13-curl-reference.md](../references/13-curl-reference.md) — every endpoint as a
runnable curl, with every parameter and response field defined — and build the seven components
around them. Every template on this page is that same contract, already ported.

## What every template does the same way

- **One config module** reads the environment, validates at startup, and refuses to resolve an
  endpoint that was never provisioned.
- **One `post()` helper** injects `applicationId` + `password`, sets a 15-second timeout, and
  decides success on `statusCode == "S1000"` — never on the HTTP status.
- **One `tel:` normaliser** and one `maskAddress()` for logs.
- **Benign codes** (`E1351` register, `E1356` unregister, `E1379` debit) return successfully.
- **Debit never retries internally**, validates `externalTrxId`, and caps it at 32 characters.
- **Broadcast (`tel:all`) is a separate function** guarded by an explicit confirmation token.
- **Callbacks acknowledge `S1000` first**, deduplicate, and process out of band.

## What each template deliberately leaves to you

The persistence layers, because they belong to your architecture rather than to Ideamart:

| Store | Shipped as | Production answer |
|---|---|---|
| USSD sessions | in-process, TTL 2 min | Redis or equivalent, shared across instances |
| Callback dedupe | in-process set/map | Redis `SETNX` + TTL, or a unique database constraint |
| Charge ledger (`externalTrxId`) | not shipped | Your database, written **before** the debit call |

## Testing a port

Both scripts are plain curl and work against any language:

```bash
./scripts/test-callbacks.sh http://localhost:3000   # valid, malformed, wrong-app, duplicate
./scripts/smoke-test.sh                             # every outbound endpoint
```

Then walk the acceptance checklist in
[references/11-any-stack.md](../references/11-any-stack.md#acceptance-checklist-for-a-port).

/**
 * Query library over catalog/ideamart-api.json.
 *
 * Zero dependencies, Node 18+. Importable from your own code, and driven by
 * tools/ideamart.mjs on the command line.
 *
 * This is the whole Ideamart contract as structured data: every service, every
 * parameter, every status code, every callback, every practice.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..");

export const catalog = JSON.parse(
  readFileSync(join(repoRoot, "catalog", "ideamart-api.json"), "utf8")
);

/**
 * Every OmniAI endpoint, tagged so callers can tell it apart from a telco one.
 *
 * OmniAI is a different product behind the same brand: header credentials
 * instead of body credentials, real HTTP status codes instead of the S1000
 * envelope, no subscriber and no callbacks. It lives in its own catalog branch
 * for exactly that reason, and everything that walks the catalog has to know
 * which half it is looking at before it applies a rule.
 */
export function omniaiServices() {
  return (catalog.omniai?.services || []).map((s) => ({ ...s, kind: "service", family: "omniai" }));
}

/** True for an entry that speaks OmniAI's conventions rather than the telco ones. */
export const isOmniai = (entry) => entry?.family === "omniai";

/** Every service and callback in one list, tagged by kind. */
export function allEntries() {
  return [
    ...catalog.services.map((s) => ({ ...s, kind: "service", family: "telco" })),
    ...catalog.callbacks.map((c) => ({ ...c, kind: "callback", family: "telco" })),
    ...omniaiServices(),
  ];
}

/** Look up a service or callback by id, name or alias. Case-insensitive. */
export function findEntry(idOrName) {
  const needle = String(idOrName || "").toLowerCase().trim();
  return (
    allEntries().find(
      (e) =>
        e.id.toLowerCase() === needle ||
        e.name.toLowerCase() === needle ||
        (e.aliases || []).some((a) => a.toLowerCase() === needle)
    ) || null
  );
}

/** Resolve the full URL for a service. */
export function urlFor(service, baseUrl) {
  if (service.absoluteUrl) return service.absoluteUrl;
  const base = (baseUrl || catalog.baseUrls.primary).replace(/\/+$/, "");
  return `${base}${service.path}`;
}

/** Decode a status code into meaning, class, retryability and the fix. */
export function lookupStatusCode(code) {
  const key = String(code || "").toUpperCase().trim();
  const entry = catalog.statusCodes[key];
  if (!entry) {
    const isSuccess = key.startsWith("S");
    return {
      code: key,
      known: false,
      class: isSuccess ? "success" : "unknown",
      description: `Not in the published code list. Treat as ${isSuccess ? "success" : "a failure"} and check https://docs.ideamart.io/developer-docs/response-codes/.`,
      retry: false,
      action: "Escalate to Ideamart support with the requestId if it persists.",
      benignFor: [],
      affects: [],
    };
  }
  const cls = catalog.statusCodeClasses[entry.class] || {};
  return {
    code: key,
    known: true,
    class: entry.class,
    description: entry.description,
    retry: cls.retry ?? false,
    action: entry.fix || cls.action,
    benignFor: entry.benignFor || [],
    affects: allEntries()
      .filter((e) => (e.statusCodes || []).includes(key))
      .map((e) => e.id),
  };
}

/**
 * Decode an OmniAI failure — an HTTP status ("429") or a named code
 * ("TOKEN_QUOTA_EXCEEDED") — into meaning, handling class and the fix.
 *
 * Separate from lookupStatusCode on purpose. An OmniAI 429 and an Ideamart
 * E1603 are both "transient", but they arrive on different channels and a
 * lookup that silently accepted either would let a caller decode a telco code
 * against the AI table and get a confident wrong answer.
 */
export function lookupOmniError(code) {
  const key = String(code || "").toUpperCase().trim();
  const table = catalog.omniai?.errors || {};
  const entry = table[key];
  if (!entry) {
    return {
      code: key,
      known: false,
      class: "unknown",
      description:
        "Not in the published OmniAI error list. Read error.code from the response body and check https://docs.ideamart.io/omni-ai/.",
      retry: false,
      action: "Log the full error object and escalate through the OmniAI portal if it persists.",
      affects: [],
    };
  }
  const cls = catalog.statusCodeClasses[entry.class] || {};
  return {
    code: key,
    known: true,
    http: entry.http,
    class: entry.class,
    description: entry.description,
    retry: cls.retry ?? false,
    action: entry.fix || cls.action,
    affects: omniaiServices()
      .filter((e) => (e.errorCodes || []).includes(key))
      .map((e) => e.id),
  };
}

/** Read a reference document from the repo. */
export function readReference(name) {
  const safe = String(name || "").replace(/[^a-zA-Z0-9._-]/g, "");
  for (const path of [
    join(repoRoot, "references", safe),
    join(repoRoot, "references", `${safe}.md`),
  ]) {
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  return null;
}

/**
 * Build a request payload for a service, with env placeholders for secrets.
 *
 * OmniAI carries no credentials in the body at all — its key travels in the
 * Authorization header — so injecting applicationId and password there would
 * produce a request that fails with a 400 and leaks the telco password to a
 * different product's endpoint.
 */
export function buildPayload(service, values = {}, credentials = {}) {
  if (isOmniai(service)) {
    const body = {};
    for (const p of service.parameters || []) {
      if (values[p.name] !== undefined) body[p.name] = values[p.name];
      else if (service.sampleRequest?.[p.name] !== undefined) body[p.name] = service.sampleRequest[p.name];
      else if (p.required) body[p.name] = `<${p.name}>`;
    }
    return body;
  }
  const payload = {
    applicationId: credentials.applicationId || "$IDEAMART_APP_ID",
    password: credentials.password || "$IDEAMART_PASSWORD",
  };
  for (const p of service.parameters || []) {
    if (p.name === "applicationId" || p.name === "password") continue;
    if (values[p.name] !== undefined) payload[p.name] = values[p.name];
    else if (p.required && service.sampleRequest?.[p.name] !== undefined) {
      payload[p.name] = service.sampleRequest[p.name];
    }
  }
  return payload;
}

/**
 * Validate an OmniAI payload.
 *
 * None of the telco rules apply here — there is no tel: address, no
 * externalTrxId and no credential in the body — so this checks the mistakes
 * that actually cost money or fail on this API: an unavailable model, an
 * uncapped completion, a fan-out of choices nobody reads, and subscriber
 * identity leaking into a prompt that leaves the trust boundary.
 */
function validateOmniaiPayload(entry, payload) {
  const spec = entry.parameters || [];
  const errors = [];
  const warnings = [];
  const known = new Set(spec.map((p) => p.name));

  for (const p of spec) {
    const value = payload?.[p.name];
    if (p.required && (value === undefined || value === null || value === "")) {
      errors.push(`Missing required field "${p.name}" — ${p.description}`);
      continue;
    }
    if (value === undefined) continue;
    if (p.enum && !p.enum.includes(String(value))) {
      errors.push(`"${p.name}" must be one of ${p.enum.join(" | ")}, got ${JSON.stringify(value)}`);
    }
    if (p.type === "object[]" && !Array.isArray(value)) {
      errors.push(`"${p.name}" must be an ARRAY, got ${typeof value}`);
    }
  }

  const messages = payload?.messages;
  if (Array.isArray(messages)) {
    if (!messages.length) errors.push("\"messages\" is empty — there is no conversation to complete.");
    const roles = new Set(["system", "developer", "user", "assistant", "tool"]);
    messages.forEach((m, i) => {
      if (!m || typeof m !== "object") {
        errors.push(`messages[${i}] must be an object with a role and content.`);
        return;
      }
      if (!roles.has(m.role)) {
        errors.push(
          `messages[${i}].role must be one of ${[...roles].join(" | ")}, got ${JSON.stringify(m.role)}`
        );
      }
      const hasContent = m.content !== undefined && m.content !== null && m.content !== "";
      if (!hasContent && !(m.role === "assistant" && m.tool_calls)) {
        errors.push(`messages[${i}] has no content.`);
      }
      if (m.role === "tool" && !m.tool_call_id) {
        errors.push(`messages[${i}] has role "tool" but no tool_call_id — the model cannot match it to its request.`);
      }
    });
  }

  const num = (name, min, max) => {
    const v = payload?.[name];
    if (v === undefined) return;
    if (typeof v !== "number" || Number.isNaN(v)) errors.push(`"${name}" must be a number, got ${JSON.stringify(v)}`);
    else if (v < min || v > max) errors.push(`"${name}" must be between ${min} and ${max}, got ${v}`);
  };
  num("temperature", 0, 2);
  num("top_p", 0, 1);
  num("frequency_penalty", -2, 2);
  num("presence_penalty", -2, 2);
  num("top_logprobs", 0, 20);
  if (payload?.n !== undefined) {
    const max = entry.id === "omniai-image-generation" ? 10 : 128;
    if (!Number.isInteger(payload.n) || payload.n < 1 || payload.n > max) {
      errors.push(`"n" must be an integer between 1 and ${max}, got ${JSON.stringify(payload.n)}`);
    } else if (payload.n > 1) {
      warnings.push(`n=${payload.n} generates and BILLS ${payload.n} results. Leave it at 1 unless you use every one.`);
    }
  }
  if (payload?.prompt !== undefined && String(payload.prompt).length > 32000) {
    errors.push("\"prompt\" exceeds the 32000-character limit for GPT Image 1.");
  }
  if (payload?.background === "transparent" && payload?.output_format === "jpeg") {
    warnings.push("background=transparent is discarded with output_format=jpeg. Use png or webp.");
  }

  if (entry.id === "omniai-chat-completions" && payload?.max_completion_tokens === undefined) {
    warnings.push(
      "No max_completion_tokens — this request has no cost ceiling. Set one on every call; a runaway generation draws down the shared token balance and takes every AI feature down with a 402."
    );
  }
  if (payload?.store === true) {
    warnings.push("store=true keeps this conversation on the provider's side. Leave it false for anything carrying subscriber data.");
  }

  const identity = /\btel:|\b(?:94|0)7\d{8}\b|subscriberId|applicationId|APP_\d{6}/i;
  for (const field of ["messages", "prompt", "safety_identifier", "user", "prompt_cache_key"]) {
    if (payload?.[field] === undefined) continue;
    if (identity.test(JSON.stringify(payload[field]))) {
      errors.push(
        `"${field}" looks like it carries subscriber or application identity. Prompts leave your trust boundary and reach a third-party model provider — redact MSISDNs, subscriberIds and credentials before the call.`
      );
    }
  }

  for (const key of Object.keys(payload || {})) {
    if (!known.has(key)) warnings.push(`Unrecognised field "${key}" — it will be ignored.`);
  }
  if (entry.spendsTokens) {
    warnings.push("This call spends real tokens from your OmniAI balance.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate a payload against a service or callback definition.
 * Catches the mistakes that actually happen, not just missing fields.
 */
export function validatePayload(entry, payload) {
  if (isOmniai(entry)) return validateOmniaiPayload(entry, payload);

  const spec = entry.parameters || entry.fields || [];
  const errors = [];
  const warnings = [];
  const known = new Set(spec.map((p) => p.name));

  for (const p of spec) {
    const value = payload?.[p.name];

    if (p.required && (value === undefined || value === null || value === "")) {
      errors.push(`Missing required field "${p.name}" — ${p.description}`);
      continue;
    }
    if (value === undefined) continue;

    if (p.enum && !p.enum.includes(String(value))) {
      errors.push(`"${p.name}" must be one of ${p.enum.join(" | ")}, got ${JSON.stringify(value)}`);
    }
    if (p.type === "string[]" && !Array.isArray(value)) {
      errors.push(
        `"${p.name}" must be an ARRAY, got ${typeof value}. This is the most common Ideamart integration bug.`
      );
    }
    if (/^(subscriberId|destinationAddress|sourceAddress)$/.test(p.name) && typeof value === "string") {
      if (!value.startsWith("tel:")) {
        errors.push(`"${p.name}" must be tel:-prefixed, got ${JSON.stringify(value)}`);
      }
      if (/[+\s]/.test(value)) {
        errors.push(`"${p.name}" must not contain "+" or spaces`);
      }
    }
    if (p.name === "destinationAddresses" && Array.isArray(value)) {
      for (const a of value) {
        if (!String(a).startsWith("tel:")) {
          errors.push(`destinationAddresses entry ${JSON.stringify(a)} must be tel:-prefixed`);
        }
      }
      if (value.includes("tel:all")) {
        warnings.push(
          "tel:all broadcasts to your ENTIRE subscriber base. Confirm this is intended and check base size first."
        );
      }
    }
    if (p.name === "externalTrxId" && String(value).length > 32) {
      errors.push("externalTrxId must be 32 characters or fewer");
    }
  }

  for (const key of Object.keys(payload || {})) {
    if (!known.has(key)) warnings.push(`Unrecognised field "${key}" — it will be ignored.`);
  }
  if (entry.movesMoney) {
    warnings.push(
      "This call moves real money. Persist externalTrxId BEFORE sending, and never retry with a new one."
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Render a service call as a runnable curl command.
 *
 * The body goes in through an unquoted heredoc so that $IDEAMART_APP_ID and
 * $IDEAMART_PASSWORD expand from the environment: the command runs as printed,
 * and no credential is ever written down. Same shape as
 * references/13-curl-reference.md, so the two paths cannot drift.
 */
export function toCurl(service, payload, baseUrl) {
  if (isOmniai(service)) {
    // The key travels in a header and the body carries no credential, so the
    // heredoc is quoted here: nothing inside it needs to expand, and quoting it
    // stops a $ in a prompt from being eaten by the shell.
    const auth = catalog.omniai.auth;
    return [
      `curl -sS -X POST '${urlFor(service, baseUrl)}' \\`,
      `  --header 'Content-Type: application/json' \\`,
      `  --header "${auth.header}: $${auth.envVar}" \\`,
      `  --max-time 120 \\`,
      `  --data @- <<'REQUEST'`,
      JSON.stringify(payload, null, 2),
      `REQUEST`,
    ].join("\n");
  }
  return [
    `curl -sS -X POST '${urlFor(service, baseUrl)}' \\`,
    `  --header 'Content-Type: application/json' \\`,
    `  --max-time 15 \\`,
    `  --data @- <<REQUEST`,
    JSON.stringify(payload, null, 2),
    `REQUEST`,
  ].join("\n");
}

/** Full-text search across services, callbacks, status codes and practices. */
export function search(query, limit = 20) {
  const needle = String(query || "").toLowerCase().trim();
  if (!needle) return [];
  const hit = (haystack, weight) =>
    String(haystack).toLowerCase().includes(needle) ? weight : 0;
  const results = [];

  for (const e of allEntries()) {
    const score =
      hit(e.id, 10) +
      hit(e.name, 8) +
      hit((e.aliases || []).join(" "), 8) +
      hit(e.path || "", 6) +
      hit(e.summary, 4) +
      hit(JSON.stringify(e.parameters || e.fields || []), 2) +
      hit((e.rules || []).join(" "), 1);
    if (score) results.push({ type: e.kind, id: e.id, name: e.name, summary: e.summary, score });
  }
  for (const [code, meta] of Object.entries(catalog.statusCodes)) {
    const score = hit(code, 12) + hit(meta.description, 3);
    if (score) results.push({ type: "statusCode", id: code, name: code, summary: meta.description, score });
  }
  for (const [code, meta] of Object.entries(catalog.omniai?.errors || {})) {
    const score = hit(code, 12) + hit(meta.description, 3);
    if (score) results.push({ type: "omniaiError", id: code, name: code, summary: meta.description, score });
  }
  for (const p of [...catalog.practices, ...(catalog.omniai?.practices || [])]) {
    const score = hit(p.id, 8) + hit(p.title, 6) + hit(p.detail, 2);
    if (score) results.push({ type: "practice", id: p.id, name: p.title, summary: p.detail, score });
  }
  for (const m of catalog.omniai?.models || []) {
    const score = hit(m.id, 10) + hit(m.provider, 6) + hit(m.note, 2);
    if (score) results.push({ type: "model", id: m.id, name: m.id, summary: m.provider + " — " + m.note, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Symptom signatures for the diagnose command.
 *
 * The OmniAI ones come first deliberately: "429" and "rate limit" mean
 * something specific on the AI gateway and nothing at all on the telco APIs,
 * and a symptom that mentions a model or a prompt is never an SMS problem.
 */
export const SIGNATURES = [
  {
    when: /omni ?ai|chat completion|prompt|llm|gpt|claude|gemini|token (quota|balance)/,
    cause: "This is an OmniAI (AI gateway) call, not a telco call. It authenticates with an Authorization header, returns real HTTP status codes, and spends a token balance — none of the S1000 rules apply.",
    fix: "Send Authorization: app_<keyId>.<keyValue> with no Bearer prefix, branch on the HTTP status rather than a statusCode field, and read error.code from the body. Full contract: references/14-omni-ai.md.",
  },
  {
    when: /\b401\b|unauthoriz|unauthenticat|invalid api key|bearer/,
    cause: "The OmniAI key is missing, malformed, or wrapped in a Bearer prefix it must not have.",
    fix: "The header value is the key verbatim: Authorization: app_<keyId>.<keyValue>. Do not prepend Bearer and do not base64-encode it. Confirm OMNIAI_API_KEY actually reached the process — an unset variable sends an empty header.",
  },
  {
    when: /\b(402|429)\b|quota|insufficient balance|rate ?limit/,
    cause: "OmniAI quota: either the per-minute rate limit (RATE_LIMIT_EXCEEDED, which clears on its own) or the token balance (TOKEN_QUOTA_EXCEEDED / INSUFFICIENT_BALANCE, which does not).",
    fix: "Read error.code, not just the status. Back off on RATE_LIMIT_EXCEEDED using the Retry-After header; alert and top up on the balance codes rather than retrying into a wall.",
  },
  {
    when: /truncat|cut off|incomplete (answer|response)|stops mid/,
    cause: 'The completion hit max_completion_tokens, so finish_reason is "length" and the content is cut off. The request succeeded; the answer is just unfinished.',
    fix: "Check choices[0].finish_reason before using the content. Raise max_completion_tokens, or ask for a shorter answer in the prompt.",
  },
  {
    when: /callback|webhook|notification.*(not|never)|no.*(callback|webhook)/,
    cause: "Callback URL is not publicly reachable, is wrong in the portal, is behind a WAF challenge or auth middleware, or your handler is not returning HTTP 200 with S1000.",
    fix: "Verify the URL in the portal; confirm it is reachable over public HTTPS with a complete certificate chain; exempt it from CSRF and auth middleware, and restrict by Ideamart source IP instead. Test locally with scripts/test-callbacks.sh.",
  },
  {
    when: /nothing happens|gets nothing|no error|silent|not working.*(test|number)/,
    cause: "The test number is not in the app's Whitelisted Numbers list while the app is in Limited Production.",
    fix: "Add the number under Whitelisted Numbers in the portal. In Limited Production only whitelisted numbers can use the app; non-whitelisted access returns E1343.",
  },
  {
    when: /works locally|fails.*(deploy|production|server)|local.*works/,
    cause: "The deployed server's egress IP is not whitelisted, or secrets are not set in the host environment.",
    fix: "Run curl -4 https://myip.ideamart.io ON THE DEPLOYED SERVER and add that IP to Allowed Host Addresses. Confirm IDEAMART_APP_ID and IDEAMART_PASSWORD are set in the host's secret manager.",
  },
  {
    when: /ussd.*(die|drop|hang|stuck|expire)|session.*(lost|expire|die)/,
    cause: "USSD session state is not shared across instances, the flow never sends mt-fin, or the handler is too slow.",
    fix: "Move the session store to Redis with a ~2 minute TTL, end terminal screens with mt-fin, and acknowledge the callback before doing any work.",
  },
  {
    when: /double.?charg|charged twice|duplicate charge/,
    cause: "A debit was retried with a fresh externalTrxId after a timeout.",
    fix: "Persist externalTrxId before the call and reuse it on every retry. E1379 means the original succeeded — treat it as success. Reconcile unknown outcomes against the charging notification.",
  },
  {
    when: /certificate|tls|ssl|self.?signed|unable to verify/,
    cause: "Ideamart serves an incomplete certificate chain, which strict clients reject.",
    fix: "Supply the missing intermediate CA to the HTTPS agent. Do NOT disable verification — that exposes the credentials that can charge your subscribers.",
  },
  {
    when: /success.*but|reports success|no error but.*fail|always succeeds/,
    cause: "The code checks the HTTP status instead of statusCode.",
    fix: "Ideamart returns HTTP 200 for application-level failures. Branch on statusCode; S1000 is the only success.",
  },
  {
    when: /array|destinationaddress/,
    cause: "destinationAddresses was sent as a bare string.",
    fix: "It is always an array, even for a single recipient.",
  },
];

/** Diagnose from a status code or a plain-language symptom. */
export function diagnose(symptom) {
  const codeMatch = String(symptom).match(/\b([SE]\d{4})\b/i);
  if (codeMatch) return { matchedOn: "statusCode", ...lookupStatusCode(codeMatch[1]) };

  // A named OmniAI code is unambiguous, so it resolves before any symptom match.
  const omniNamed = String(symptom)
    .toUpperCase()
    .match(
      /\b(PROJECT_NOT_FOUND|PROJECT_INACTIVE|INVALID_LLM_CONFIG|RATE_LIMIT_EXCEEDED|TOKEN_QUOTA_EXCEEDED|INSUFFICIENT_BALANCE|FORWARDING_FAILED)\b/
    );
  if (omniNamed) return { matchedOn: "omniaiError", ...lookupOmniError(omniNamed[1]) };

  const s = String(symptom).toLowerCase();
  const sig = SIGNATURES.find((x) => x.when.test(s));
  if (sig) return { matchedOn: "symptom", symptom, cause: sig.cause, fix: sig.fix };

  return {
    matchedOn: "none",
    symptom,
    suggestion: "No signature matched. Try `ideamart search <keyword>`, or look up the statusCode from the response body.",
    searchResults: search(symptom, 5),
  };
}

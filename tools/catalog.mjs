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

/** Every service and callback in one list, tagged by kind. */
export function allEntries() {
  return [
    ...catalog.services.map((s) => ({ ...s, kind: "service" })),
    ...catalog.callbacks.map((c) => ({ ...c, kind: "callback" })),
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

/** Build a request payload for a service, with env placeholders for secrets. */
export function buildPayload(service, values = {}, credentials = {}) {
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
 * Validate a payload against a service or callback definition.
 * Catches the mistakes that actually happen, not just missing fields.
 */
export function validatePayload(entry, payload) {
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

const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Render a service call as a runnable curl command. */
export function toCurl(service, payload, baseUrl) {
  return [
    `curl -X POST '${urlFor(service, baseUrl)}' \\`,
    `  --header 'Content-Type: application/json' \\`,
    `  --data ${shellQuote(JSON.stringify(payload, null, 2))}`,
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
  for (const p of catalog.practices) {
    const score = hit(p.id, 8) + hit(p.title, 6) + hit(p.detail, 2);
    if (score) results.push({ type: "practice", id: p.id, name: p.title, summary: p.detail, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Symptom signatures for the diagnose command. */
export const SIGNATURES = [
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

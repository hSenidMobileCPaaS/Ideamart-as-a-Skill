/**
 * Code generation over catalog/ideamart-api.json.
 *
 * Emits ready-to-paste integration code — client functions, request/response
 * types, callback handlers, the config module and the full status-code module —
 * in TypeScript, Python, Java, Go, PHP and C#.
 *
 * Everything here is derived from the catalog, so generated code cannot drift
 * from the documented contract: fix the catalog and every language follows.
 *
 * Zero dependencies. Generates code only — it makes no network calls and never
 * reads a credential.
 */

import { catalog, findEntry, urlFor } from "./catalog.mjs";

/* ── Naming ──────────────────────────────────────────────────────────────── */

/** Wrapper names, identical to templates/ so generated code drops in beside it. */
const FUNCTION_NAMES = {
  "sms-send": "sendSms",
  "ussd-send": "sendUssd",
  "subscription-register": "register",
  "subscription-unregister": "unregister",
  "subscription-status": "getSubscriptionStatus",
  "subscription-query-base": "queryBase",
  "otp-request": "requestOtp",
  "otp-verify": "verifyOtp",
  "caas-direct-debit": "debit",
  "caas-balance-query": "queryBalance",
  "lbs-locate": "locate",
};

/** Values the wrapper fixes for the caller, so a call site cannot get them wrong. */
const FIXED = {
  "subscription-register": { action: "1", version: "1.0" },
  "subscription-unregister": { action: "0", version: "1.0" },
  "ussd-send": { encoding: "440", version: "1.0" },
};

/** Endpoint keys, matching templates/ so generated code and templates interoperate. */
const ENDPOINT_KEYS = { "lbs-locate": "lbsLocate" };

/** Optional parameters that get a sensible default rather than being omitted. */
const DEFAULTS = {
  "caas-direct-debit": { currency: "LKR" },
  "caas-balance-query": { currency: "LKR" },
};

const camel = (s) => s.replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
const pascal = (s) => camel(s).replace(/^./, (c) => c.toUpperCase());
const snake = (s) =>
  camel(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();
const upperSnake = (s) => snake(s).toUpperCase();

const TEL_PARAMS = new Set(["subscriberId", "destinationAddress"]);
const TEL_ARRAY_PARAMS = new Set(["destinationAddresses"]);

/* ── Planning ────────────────────────────────────────────────────────────── */

/** Normalise a catalog service into everything an emitter needs. */
export function planService(service) {
  const fixed = FIXED[service.id] || {};
  const defaults = DEFAULTS[service.id] || {};
  const params = (service.parameters || []).filter(
    (p) => !["applicationId", "password"].includes(p.name) && fixed[p.name] === undefined
  );

  const args = params.map((p) => ({
    wire: p.name,
    required: Boolean(p.required),
    type: p.type,
    enum: p.enum || null,
    description: p.description,
    default: defaults[p.name] ?? null,
    tel: TEL_PARAMS.has(p.name),
    telArray: TEL_ARRAY_PARAMS.has(p.name),
  }));
  // Required first, then defaulted, then plain optional: valid signature order
  // in every language that has optional arguments.
  args.sort((a, b) => rank(a) - rank(b));

  return {
    id: service.id,
    name: service.name,
    summary: service.summary,
    envVar: service.envVar,
    endpointKey:
      ENDPOINT_KEYS[service.id] ||
      camel(service.envVar.replace(/^IDEAMART_/, "").replace(/_URL$/, "").toLowerCase()),
    url: urlFor(service),
    fn: FUNCTION_NAMES[service.id] || camel(service.id),
    args,
    fixed,
    benign: Object.entries(catalog.statusCodes)
      .filter(([, v]) => (v.benignFor || []).includes(service.id))
      .map(([code]) => code),
    benignNote: Object.entries(catalog.statusCodes)
      .filter(([, v]) => (v.benignFor || []).includes(service.id))
      .map(([code, v]) => `${code} (${v.description}) means the desired state already holds.`),
    movesMoney: Boolean(service.movesMoney),
    rules: service.rules || [],
    responseFields: service.responseFields || [],
  };
}

function rank(a) {
  if (a.required) return 0;
  if (a.default !== null) return 1;
  return 2;
}

/** The status-code data every generated error module needs. */
export function planErrors() {
  const byClass = {};
  for (const [code, entry] of Object.entries(catalog.statusCodes)) {
    (byClass[entry.class] ||= []).push(code);
  }
  const benign = {};
  for (const [code, entry] of Object.entries(catalog.statusCodes)) {
    for (const op of entry.benignFor || []) {
      (benign[op] ||= []).push(code);
    }
  }
  return {
    codes: Object.entries(catalog.statusCodes).map(([code, e]) => ({
      code,
      class: e.class,
      description: e.description,
    })),
    byClass,
    benign,
    classes: catalog.statusCodeClasses,
  };
}

/* ── Shared text ─────────────────────────────────────────────────────────── */

const BANNER = (target, langLabel) => [
  `Ideamart ${target} — generated for ${langLabel}.`,
  ``,
  `Generated from catalog/ideamart-api.json (catalog v${catalog.catalogVersion}),`,
  `which is derived from ${catalog.source} and verified working calls.`,
  ``,
  `Regenerate with:  ideamart codegen ${target} --lang=<language>`,
  ``,
  `SERVER-SIDE ONLY. Ideamart returns HTTP 200 for application-level failures,`,
  `so success is decided by statusCode === "S1000" and nothing else.`,
];

const j = (parts) => parts.filter((x) => x !== null && x !== undefined).join("\n");
const q = (s) => JSON.stringify(String(s));

/** Doc line for one argument. */
const argDoc = (a) =>
  `${a.wire}${a.required ? "" : " (optional)"} — ${a.description}${
    a.enum ? ` One of: ${a.enum.join(", ")}.` : ""
  }`;

/* ── TypeScript ──────────────────────────────────────────────────────────── */

const typescript = {
  id: "typescript",
  label: "TypeScript",
  ext: "ts",
  comment: (lines) => j(["/**", ...lines.map((l) => ` * ${l}`.trimEnd()), " */"]),
  name: (s) => camel(s),

  tsType(a) {
    if (a.telArray) return "string | string[]";
    if (a.type === "string[]") return "string[]";
    if (a.type === "object") return "Record<string, unknown>";
    if (a.enum) return a.enum.map((v) => q(v)).join(" | ");
    return "string";
  },

  service(plan) {
    const params = plan.args.map(
      (a) => `  ${camel(a.wire)}${a.required || a.default !== null ? "" : "?"}: ${this.tsType(a)}${
        a.default !== null ? ` = ${q(a.default)}` : ""
      };`
    );
    const body = [
      ...Object.entries(plan.fixed).map(([k, v]) => `    ${k}: ${q(v)},`),
      ...plan.args.map((a) => {
        const v = camel(a.wire);
        if (a.telArray)
          return `    ${a.wire}: (Array.isArray(${v}) ? ${v} : [${v}]).map(toTelAddress),`;
        if (a.tel) return `    ${a.wire}: toTelAddress(${v}),`;
        if (a.required || a.default !== null) return `    ${v === a.wire ? a.wire : `${a.wire}: ${v}`},`;
        return `    ...(${v} === undefined ? {} : { ${a.wire} }),`;
      }),
    ];
    return j([
      this.comment([
        `${plan.name} — POST ${plan.url}`,
        ``,
        plan.summary,
        ...(plan.movesMoney ? ["", "THIS MOVES REAL MONEY. Persist externalTrxId before calling."] : []),
        ...(plan.benignNote.length ? ["", ...plan.benignNote] : []),
        "",
        ...plan.args.map(argDoc),
      ]),
      `export async function ${plan.fn}(input: {`,
      ...params,
      `}): Promise<IdeamartResponse> {`,
      ...guards.typescript(plan),
      `  const { ${plan.args.map((a) => camel(a.wire)).join(", ")} } = input;`,
      `  return post(${q(plan.id)}, requireEndpoint(${q(plan.endpointKey)}), {`,
      ...body,
      `  }${plan.benign.length ? `, [${plan.benign.map(q).join(", ")}]` : ""});`,
      `}`,
    ]);
  },

  client(plans) {
    return j([
      this.comment(BANNER("client", "TypeScript")),
      ``,
      `const TIMEOUT_MS = 15_000;`,
      ``,
      `export interface IdeamartResponse {`,
      `  statusCode: string;`,
      `  statusDetail: string;`,
      `  [key: string]: unknown;`,
      `}`,
      ``,
      `/** One URL per provisioned service. An unset endpoint means "not provisioned". */`,
      `const ENDPOINTS: Record<string, string | undefined> = {`,
      ...uniqueEndpoints(plans).map(([key, envVar]) => `  ${key}: process.env.${envVar},`),
      `};`,
      ``,
      `function requireEndpoint(service: string): string {`,
      `  const url = ENDPOINTS[service];`,
      `  if (!url) {`,
      `    throw new Error(`,
      `      \`[ideamart] \${service} is not configured. Either the API is not enabled on your \` +`,
      `        \`application in IdeaPro, or its URL is missing from the environment.\``,
      `    );`,
      `  }`,
      `  return url;`,
      `}`,
      ``,
      `/** The only place tel: is added. */`,
      `export function toTelAddress(msisdn: string): string {`,
      `  const trimmed = (msisdn ?? "").trim();`,
      `  if (!trimmed) throw new Error("[ideamart] Empty subscriber address");`,
      `  if (trimmed.toLowerCase().startsWith("tel:")) return trimmed;`,
      `  let digits = trimmed.replace(/[\\s()-]/g, "").replace(/^\\+/, "");`,
      `  if (digits.startsWith("00")) digits = digits.slice(2);`,
      `  if (digits.startsWith("0") && digits.length === 10) digits = "94" + digits.slice(1);`,
      `  return \`tel:\${digits}\`;`,
      `}`,
      ``,
      `/**`,
      ` * Credentials are injected here and nowhere else. The HTTP status is never`,
      ` * consulted: Ideamart answers 200 for its own failures.`,
      ` */`,
      `async function post(`,
      `  service: string,`,
      `  url: string,`,
      `  body: Record<string, unknown>,`,
      `  benign: readonly string[] = []`,
      `): Promise<IdeamartResponse> {`,
      `  const controller = new AbortController();`,
      `  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);`,
      `  try {`,
      `    const res = await fetch(url, {`,
      `      method: "POST",`,
      `      headers: { "Content-Type": "application/json" },`,
      `      signal: controller.signal,`,
      `      body: JSON.stringify({`,
      `        applicationId: requireEnv("IDEAMART_APP_ID"),`,
      `        password: requireEnv("IDEAMART_PASSWORD"),`,
      `        ...body,`,
      `      }),`,
      `    });`,
      `    const data = (await res.json()) as IdeamartResponse;`,
      `    if (data.statusCode === "S1000" || benign.includes(data.statusCode)) return data;`,
      `    throw new IdeamartError(data.statusCode, data.statusDetail, service);`,
      `  } finally {`,
      `    clearTimeout(timer);`,
      `  }`,
      `}`,
      ``,
      `function requireEnv(name: string): string {`,
      `  const value = process.env[name];`,
      `  if (!value) throw new Error(\`[ideamart] Missing environment variable \${name}\`);`,
      `  return value;`,
      `}`,
      ``,
      ...plans.map((p) => this.service(p) + "\n"),
    ]);
  },

  errors(data) {
    return j([
      this.comment(BANNER("errors", "TypeScript")),
      ``,
      `export class IdeamartError extends Error {`,
      `  constructor(`,
      `    readonly statusCode: string,`,
      `    readonly statusDetail: string,`,
      `    readonly service?: string`,
      `  ) {`,
      `    super(\`[\${statusCode}] \${statusDetail}\${service ? \` (\${service})\` : ""}\`);`,
      `    this.name = "IdeamartError";`,
      `  }`,
      `  get handling(): StatusClass { return classify(this.statusCode); }`,
      `  get retryable(): boolean { return this.handling === "transient"; }`,
      `  get isConfiguration(): boolean { return this.handling === "configuration"; }`,
      `}`,
      ``,
      `export type StatusClass = ${Object.keys(data.classes).map(q).join(" | ")} | "unknown";`,
      ``,
      `/** Every published status code, with what it means. */`,
      `export const STATUS_CODES: Record<string, { class: StatusClass; description: string }> = {`,
      ...data.codes.map(
        (c) => `  ${c.code}: { class: ${q(c.class)}, description: ${q(c.description)} },`
      ),
      `};`,
      ``,
      ...Object.entries(data.classes).map((entry) =>
        j([
          `/** ${entry[1].meaning || entry[0]} Retry: ${entry[1].retry ? "yes, with backoff" : "never"}. */`,
          `export const ${upperSnake(entry[0])}: ReadonlySet<string> = new Set([`,
          `  ${(data.byClass[entry[0]] || []).map(q).join(", ")},`,
          `]);`,
          ``,
        ])
      ),
      `/** Codes that mean "the outcome you wanted already holds" — treat as success. */`,
      `export const BENIGN: Record<string, readonly string[]> = {`,
      ...Object.entries(data.benign).map(([op, codes]) => `  ${q(op)}: [${codes.map(q).join(", ")}],`),
      `};`,
      ``,
      `export function classify(code: string): StatusClass {`,
      `  return (STATUS_CODES[code]?.class as StatusClass) ?? "unknown";`,
      `}`,
      ``,
      `export function describe(code: string): string {`,
      `  return STATUS_CODES[code]?.description ?? \`Unpublished status code \${code}\`;`,
      `}`,
      ``,
      `export function isBenign(operation: string, code: string): boolean {`,
      `  return (BENIGN[operation] ?? []).includes(code);`,
      `}`,
    ]);
  },

  types(services) {
    return j([
      this.comment(BANNER("types", "TypeScript")),
      ``,
      ...services.flatMap((s) => {
        const plan = planService(s);
        return [
          `/** Request body for ${s.name} — POST ${plan.url} */`,
          `export interface ${pascal(s.id)}Request {`,
          ...(s.parameters || []).map(
            (p) =>
              `  /** ${p.description} */\n  ${p.name}${p.required ? "" : "?"}: ${
                p.enum ? p.enum.map(q).join(" | ") : p.type === "string[]" ? "string[]" : p.type === "object" ? "Record<string, unknown>" : "string"
              };`
          ),
          `}`,
          ``,
          `/** Response body for ${s.name}. */`,
          `export interface ${pascal(s.id)}Response {`,
          ...(s.responseFields || []).map(
            (f) =>
              `  /** ${f.description} */\n  ${f.name}?: ${
                f.type === "object[]" ? "Array<Record<string, unknown>>" : "string"
              };`
          ),
          `}`,
          ``,
        ];
      }),
      ...catalog.callbacks.map((cb) =>
        j([
          `/** Inbound ${cb.name} payload — POST ${cb.suggestedPath} */`,
          `export interface ${pascal(cb.id)}Callback {`,
          ...(cb.fields || []).map(
            (f) => `  /** ${f.description} */\n  ${f.name}${f.required ? "" : "?"}: string;`
          ),
          `}`,
          ``,
        ])
      ),
    ]);
  },

  callback(cb) {
    const fields = cb.fields || [];
    const required = fields.filter((f) => f.required).map((f) => f.name);
    return j([
      this.comment([
        `${cb.name} handler — POST ${cb.suggestedPath}`,
        ``,
        cb.summary,
        ``,
        `Acknowledge first, work second. Always HTTP 200, even for payloads you reject.`,
        `Deduplicate on: ${cb.dedupeKey}`,
      ]),
      `const ACK = { statusCode: "S1000", statusDetail: "Success" } as const;`,
      ``,
      `export async function ${camel(cb.id)}Handler(req: Request): Promise<Response> {`,
      `  let body: Record<string, unknown>;`,
      `  try {`,
      `    body = await req.json();`,
      `  } catch {`,
      `    return Response.json(ACK); // malformed — acknowledge and discard`,
      `  }`,
      ``,
      required.length
        ? `  if (${required.map((f) => `!body.${f}`).join(" || ")}) return Response.json(ACK);`
        : null,
      fields.some((f) => f.name === "applicationId")
        ? `  if (body.applicationId !== process.env.IDEAMART_APP_ID) return Response.json(ACK);`
        : null,
      `  if (isDuplicate(\`${cb.id}:\` + ${dedupeExpr(cb, "js")})) return Response.json(ACK);`,
      ``,
      `  enqueue(${q(cb.id)}, body); // process out of band — never await real work here`,
      `  return Response.json(ACK);`,
      `}`,
    ]);
  },

  config(plans) {
    return j([
      this.comment(BANNER("config", "TypeScript")),
      `export const config = {`,
      `  applicationId: requireEnv("IDEAMART_APP_ID"),`,
      `  password: requireEnv("IDEAMART_PASSWORD"),`,
      `  endpoints: {`,
      ...uniqueEndpoints(plans).map(([key, envVar]) => `    ${key}: process.env.${envVar},`),
      `  },`,
      `} as const;`,
      ``,
      `function requireEnv(name: string): string {`,
      `  const value = process.env[name]?.trim();`,
      `  if (!value) throw new Error(\`[ideamart] Missing environment variable \${name}\`);`,
      `  return value;`,
      `}`,
    ]);
  },
};

/* ── Python ──────────────────────────────────────────────────────────────── */

const python = {
  id: "python",
  label: "Python",
  ext: "py",
  comment: (lines) => j(['"""', ...lines, '"""']),
  name: (s) => snake(s),

  service(plan) {
    const sig = plan.args.map((a) => {
      const n = snake(a.wire);
      if (a.required) return n;
      if (a.default !== null) return `${n}="${a.default}"`;
      return `${n}=None`;
    });
    const body = [
      ...Object.entries(plan.fixed).map(([k, v]) => `        ${q(k)}: ${q(v)},`),
      ...plan.args
        .filter((a) => a.required || a.default !== null)
        .map((a) => {
          const n = snake(a.wire);
          if (a.telArray)
            return `        ${q(a.wire)}: [to_tel_address(x) for x in (${n} if isinstance(${n}, list) else [${n}])],`;
          if (a.tel) return `        ${q(a.wire)}: to_tel_address(${n}),`;
          return `        ${q(a.wire)}: ${n},`;
        }),
    ];
    const optional = plan.args.filter((a) => !a.required && a.default === null);
    return j([
      `def ${snake(plan.fn)}(${sig.length ? `*, ${sig.join(", ")}` : ""}):`,
      python.comment([
        `${plan.name} — POST ${plan.url}`,
        ``,
        plan.summary,
        ...(plan.movesMoney
          ? ["", "THIS MOVES REAL MONEY. Persist external_trx_id before calling."]
          : []),
        ...(plan.benignNote.length ? ["", ...plan.benignNote] : []),
        ``,
        `Args:`,
        ...plan.args.map((a) => `    ${snake(a.wire)}: ${argDoc(a)}`),
      ])
        .split("\n")
        .map((l) => (l ? `    ${l}` : ""))
        .join("\n"),
      ...guards.python(plan),
      `    body = {`,
      ...body,
      `    }`,
      ...optional.map((a) =>
        j([
          `    if ${snake(a.wire)} is not None:`,
          `        body[${q(a.wire)}] = ${a.tel ? `to_tel_address(${snake(a.wire)})` : snake(a.wire)}`,
        ])
      ),
      `    return _post(${q(plan.id)}, _require_endpoint(${q(plan.endpointKey)}), body${
        plan.benign.length ? `, benign=[${plan.benign.map(q).join(", ")}]` : ""
      })`,
    ]);
  },

  client(plans) {
    return j([
      python.comment(BANNER("client", "Python")),
      ``,
      `import json`,
      `import os`,
      `import re`,
      `import ssl`,
      `import urllib.request`,
      ``,
      `from ideamart_errors import BENIGN, IdeamartError  # codegen errors --lang=python`,
      ``,
      `TIMEOUT_SECONDS = 15`,
      `SSL_CONTEXT = ssl.create_default_context()`,
      ``,
      `#: One URL per provisioned service. Unset means "not provisioned".`,
      `ENDPOINTS = {`,
      ...uniqueEndpoints(plans).map(([key, envVar]) => `    ${q(key)}: os.environ.get(${q(envVar)}),`),
      `}`,
      ``,
      ``,
      `def _require_endpoint(service):`,
      `    url = ENDPOINTS.get(service)`,
      `    if not url:`,
      `        raise RuntimeError(`,
      `            f"[ideamart] {service} is not configured. Either the API is not enabled on "`,
      `            f"your application in IdeaPro, or its URL is missing from the environment."`,
      `        )`,
      `    return url`,
      ``,
      ``,
      `def _require_env(name):`,
      `    value = (os.environ.get(name) or "").strip()`,
      `    if not value:`,
      `        raise RuntimeError(f"[ideamart] Missing environment variable {name}")`,
      `    return value`,
      ``,
      ``,
      `def to_tel_address(msisdn):`,
      `    """The only place tel: is added."""`,
      `    trimmed = (msisdn or "").strip()`,
      `    if not trimmed:`,
      `        raise ValueError("[ideamart] Empty subscriber address")`,
      `    if trimmed.lower().startswith("tel:"):`,
      `        return trimmed`,
      `    digits = re.sub(r"[\\s()\\-]", "", trimmed).lstrip("+")`,
      `    if digits.startswith("00"):`,
      `        digits = digits[2:]`,
      `    if digits.startswith("0") and len(digits) == 10:`,
      `        digits = "94" + digits[1:]`,
      `    return "tel:" + digits`,
      ``,
      ``,
      `def _post(service, url, body, benign=()):`,
      `    """`,
      `    Credentials are injected here and nowhere else. The HTTP status is never`,
      `    consulted: Ideamart answers 200 for its own failures.`,
      `    """`,
      `    payload = {`,
      `        "applicationId": _require_env("IDEAMART_APP_ID"),`,
      `        "password": _require_env("IDEAMART_PASSWORD"),`,
      `        **body,`,
      `    }`,
      `    request = urllib.request.Request(`,
      `        url,`,
      `        data=json.dumps(payload).encode("utf-8"),`,
      `        method="POST",`,
      `        headers={"Content-Type": "application/json"},`,
      `    )`,
      `    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS, context=SSL_CONTEXT) as response:`,
      `        data = json.loads(response.read().decode("utf-8"))`,
      ``,
      `    status = data.get("statusCode")`,
      `    if status == "S1000" or status in set(benign):`,
      `        return data`,
      `    raise IdeamartError(status, data.get("statusDetail", ""), service)`,
      ``,
      ``,
      ...plans.map((p) => this.service(p) + "\n\n"),
    ]);
  },

  errors(data) {
    return j([
      python.comment(BANNER("errors", "Python")),
      ``,
      `#: Every published status code, with what it means.`,
      `STATUS_CODES = {`,
      ...data.codes.map(
        (c) => `    ${q(c.code)}: {"class": ${q(c.class)}, "description": ${q(c.description)}},`
      ),
      `}`,
      ``,
      ...Object.entries(data.classes).map((entry) =>
        j([
          `#: ${entry[1].meaning || entry[0]} Retry: ${entry[1].retry ? "yes, with backoff" : "never"}.`,
          `${upperSnake(entry[0])} = frozenset({`,
          `    ${(data.byClass[entry[0]] || []).map(q).join(", ")},`,
          `})`,
          ``,
        ])
      ),
      `#: Codes that mean "the outcome you wanted already holds" — treat as success.`,
      `BENIGN = {`,
      ...Object.entries(data.benign).map(
        ([op, codes]) => `    ${q(op)}: (${codes.map(q).join(", ")},),`
      ),
      `}`,
      ``,
      ``,
      `def classify(code):`,
      `    entry = STATUS_CODES.get(code)`,
      `    return entry["class"] if entry else "unknown"`,
      ``,
      ``,
      `def describe(code):`,
      `    entry = STATUS_CODES.get(code)`,
      `    return entry["description"] if entry else f"Unpublished status code {code}"`,
      ``,
      ``,
      `def is_benign(operation, code):`,
      `    return code in BENIGN.get(operation, ())`,
      ``,
      ``,
      `class IdeamartError(Exception):`,
      `    def __init__(self, status_code, status_detail, service=None):`,
      `        super().__init__(f"[{status_code}] {status_detail}" + (f" ({service})" if service else ""))`,
      `        self.status_code = status_code`,
      `        self.status_detail = status_detail`,
      `        self.service = service`,
      ``,
      `    @property`,
      `    def handling(self):`,
      `        return classify(self.status_code)`,
      ``,
      `    @property`,
      `    def retryable(self):`,
      `        return self.status_code in TRANSIENT`,
      ``,
      `    @property`,
      `    def is_configuration(self):`,
      `        return self.status_code in CONFIGURATION`,
    ]);
  },

  types(services) {
    return j([
      python.comment(BANNER("types", "Python")),
      ``,
      `from typing import List, Optional, TypedDict`,
      ``,
      ...services.flatMap((s) => [
        `class ${pascal(s.id)}Request(TypedDict, total=False):`,
        `    """Request body for ${s.name} — POST ${urlFor(s)}"""`,
        ...(s.parameters || []).map(
          (p) => `    ${p.name}: ${p.type === "string[]" ? "List[str]" : p.type === "object" ? "dict" : "str"}  # ${p.required ? "required" : "optional"} — ${p.description}`
        ),
        ``,
        ``,
        `class ${pascal(s.id)}Response(TypedDict, total=False):`,
        `    """Response body for ${s.name}."""`,
        ...(s.responseFields || []).map(
          (f) => `    ${f.name}: ${f.type === "object[]" ? "List[dict]" : "str"}  # ${f.description}`
        ),
        ``,
        ``,
      ]),
      ...catalog.callbacks.flatMap((cb) => [
        `class ${pascal(cb.id)}Callback(TypedDict, total=False):`,
        `    """Inbound ${cb.name} payload — POST ${cb.suggestedPath}"""`,
        ...(cb.fields || []).map((f) => `    ${f.name}: str  # ${f.description}`),
        ...((cb.fields || []).length ? [] : ["    pass"]),
        ``,
        ``,
      ]),
    ]);
  },

  callback(cb) {
    const required = (cb.fields || []).filter((f) => f.required).map((f) => f.name);
    return j([
      python.comment([
        `${cb.name} handler — POST ${cb.suggestedPath}`,
        ``,
        cb.summary,
        ``,
        `Acknowledge first, work second. Always HTTP 200, even for payloads you reject.`,
        `Deduplicate on: ${cb.dedupeKey}`,
      ]),
      `ACK = {"statusCode": "S1000", "statusDetail": "Success"}`,
      ``,
      ``,
      `async def ${snake(cb.id)}_handler(request, background):`,
      `    try:`,
      `        body = await request.json()`,
      `    except Exception:`,
      `        return JSONResponse(ACK)  # malformed — acknowledge and discard`,
      ``,
      required.length
        ? `    if not all(body.get(f) for f in (${required.map(q).join(", ")},)):\n        return JSONResponse(ACK)`
        : null,
      (cb.fields || []).some((f) => f.name === "applicationId")
        ? `    if body.get("applicationId") != os.environ["IDEAMART_APP_ID"]:\n        return JSONResponse(ACK)`
        : null,
      `    if is_duplicate("${cb.id}:" + ${dedupeExpr(cb, "py")}):`,
      `        return JSONResponse(ACK)`,
      ``,
      `    background.add_task(handle_${snake(cb.id)}, body)  # never do the work inline`,
      `    return JSONResponse(ACK)`,
    ]);
  },

  config(plans) {
    return j([
      python.comment(BANNER("config", "Python")),
      ``,
      `import os`,
      ``,
      `ENDPOINT_VARS = {`,
      ...uniqueEndpoints(plans).map(([key, envVar]) => `    ${q(key)}: ${q(envVar)},`),
      `}`,
      ``,
      ``,
      `def load_config():`,
      `    return {`,
      `        "application_id": _require_env("IDEAMART_APP_ID"),`,
      `        "password": _require_env("IDEAMART_PASSWORD"),`,
      `        "endpoints": {k: os.environ.get(v) for k, v in ENDPOINT_VARS.items()},`,
      `    }`,
      ``,
      ``,
      `def _require_env(name):`,
      `    value = (os.environ.get(name) or "").strip()`,
      `    if not value:`,
      `        raise RuntimeError(f"[ideamart] Missing environment variable {name}")`,
      `    return value`,
    ]);
  },
};

/* ── Java ────────────────────────────────────────────────────────────────── */

const java = {
  id: "java",
  label: "Java",
  ext: "java",
  comment: (lines) => j(["/**", ...lines.map((l) => ` * ${l}`.trimEnd()), " */"]),
  name: (s) => camel(s),

  javaType: (a) => (a.telArray ? "List<String>" : a.type === "object" ? "Map<String, Object>" : "String"),

  service(plan) {
    // Java has no optional arguments, so required fields are positional and the
    // rest go through one options map — a caller never passes a row of nulls.
    const positional = plan.args.filter((a) => a.required || a.default !== null);
    const optional = plan.args.filter((a) => !a.required && a.default === null);
    const sig = [
      ...positional.map((a) => `${java.javaType(a)} ${camel(a.wire)}`),
      ...(optional.length ? ["Map<String, Object> options"] : []),
    ].join(", ");
    const body = [
      ...Object.entries(plan.fixed).map(([k, v]) => `    body.put(${q(k)}, ${q(v)});`),
      ...positional.map((a) => {
        const v = camel(a.wire);
        if (a.telArray)
          return `    body.put(${q(a.wire)}, ${v}.stream().map(IdeamartClient::toTelAddress).toList());`;
        if (a.tel) return `    body.put(${q(a.wire)}, toTelAddress(${v}));`;
        return `    body.put(${q(a.wire)}, ${v});`;
      }),
      ...(optional.length ? [`    if (options != null) body.putAll(options);`] : []),
    ];
    return j([
      java.comment([
        `${plan.name} — POST ${plan.url}`,
        ``,
        plan.summary,
        ...(plan.movesMoney
          ? ["", "THIS MOVES REAL MONEY. Persist externalTrxId before calling."]
          : []),
        ...(plan.benignNote.length ? ["", ...plan.benignNote] : []),
        ``,
        ...positional.map((a) => `@param ${camel(a.wire)} ${argDoc(a)}`),
        ...(optional.length
          ? [
              `@param options optional fields, or null:`,
              ...optional.map((a) => `    ${a.wire} — ${a.description}`),
            ]
          : []),
      ]),
      `public JsonNode ${plan.fn}(${sig}) {`,
      ...guards.java(plan),
      `    Map<String, Object> body = new LinkedHashMap<>();`,
      ...body,
      `    return post(${q(plan.id)}, requireEndpoint(${q(plan.endpointKey)}), body${
        plan.benign.length ? `, ${plan.benign.map(q).join(", ")}` : ""
      });`,
      `}`,
    ]);
  },

  client(plans) {
    return j([
      java.comment(BANNER("client", "Java")),
      `public final class IdeamartClient {`,
      ``,
      `  private static final Duration TIMEOUT = Duration.ofSeconds(15);`,
      `  private final HttpClient http = HttpClient.newBuilder().connectTimeout(TIMEOUT).build();`,
      `  private final ObjectMapper mapper = new ObjectMapper();`,
      ``,
      `  /** One URL per provisioned service. Unset means "not provisioned". */`,
      `  private static final Map<String, String> ENDPOINT_VARS = Map.ofEntries(`,
      uniqueEndpoints(plans)
        .map(([key, envVar]) => `      Map.entry(${q(key)}, ${q(envVar)})`)
        .join(",\n"),
      `  );`,
      ``,
      `  private String requireEndpoint(String service) {`,
      `    String url = System.getenv(ENDPOINT_VARS.get(service));`,
      `    if (url == null || url.isBlank()) {`,
      `      throw new IllegalStateException(`,
      `          "[ideamart] " + service + " is not configured. Either the API is not enabled on "`,
      `              + "your application in IdeaPro, or " + ENDPOINT_VARS.get(service)`,
      `              + " is missing from the environment.");`,
      `    }`,
      `    return url;`,
      `  }`,
      ``,
      `  /** The only place tel: is added. */`,
      `  public static String toTelAddress(String msisdn) {`,
      `    String trimmed = msisdn == null ? "" : msisdn.trim();`,
      `    if (trimmed.isEmpty()) throw new IllegalArgumentException("[ideamart] Empty subscriber address");`,
      `    if (trimmed.toLowerCase(Locale.ROOT).startsWith("tel:")) return trimmed;`,
      `    String digits = trimmed.replaceAll("[\\\\s()-]", "").replaceFirst("^\\\\+", "");`,
      `    if (digits.startsWith("00")) digits = digits.substring(2);`,
      `    if (digits.startsWith("0") && digits.length() == 10) digits = "94" + digits.substring(1);`,
      `    return "tel:" + digits;`,
      `  }`,
      ``,
      `  /**`,
      `   * Credentials are injected here and nowhere else. The HTTP status is never`,
      `   * consulted: Ideamart answers 200 for its own failures.`,
      `   */`,
      `  private JsonNode post(String service, String url, Map<String, Object> body, String... benign) {`,
      `    Map<String, Object> payload = new LinkedHashMap<>();`,
      `    payload.put("applicationId", requireEnv("IDEAMART_APP_ID"));`,
      `    payload.put("password", requireEnv("IDEAMART_PASSWORD"));`,
      `    payload.putAll(body);`,
      ``,
      `    JsonNode data;`,
      `    try {`,
      `      HttpRequest request = HttpRequest.newBuilder(URI.create(url))`,
      `          .timeout(TIMEOUT)`,
      `          .header("Content-Type", "application/json")`,
      `          .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)))`,
      `          .build();`,
      `      data = mapper.readTree(http.send(request, HttpResponse.BodyHandlers.ofString()).body());`,
      `    } catch (InterruptedException e) {`,
      `      Thread.currentThread().interrupt();`,
      `      throw new IllegalStateException("[ideamart] " + service + " interrupted", e);`,
      `    } catch (Exception e) {`,
      `      throw new IllegalStateException("[ideamart] " + service + " transport failure", e);`,
      `    }`,
      ``,
      `    String statusCode = data.path("statusCode").asText("");`,
      `    if ("S1000".equals(statusCode) || List.of(benign).contains(statusCode)) return data;`,
      `    throw new IdeamartException(statusCode, data.path("statusDetail").asText(""), service);`,
      `  }`,
      ``,
      `  private static String requireEnv(String name) {`,
      `    String value = System.getenv(name);`,
      `    if (value == null || value.isBlank()) {`,
      `      throw new IllegalStateException("[ideamart] Missing environment variable " + name);`,
      `    }`,
      `    return value;`,
      `  }`,
      ``,
      ...plans.map((p) => indent(this.service(p), 2) + "\n"),
      `}`,
    ]);
  },

  errors(data) {
    return j([
      java.comment(BANNER("errors", "Java")),
      `public final class IdeamartStatus {`,
      ``,
      `  private IdeamartStatus() {}`,
      ``,
      `  public record Code(String handling, String description) {}`,
      ``,
      `  /** Every published status code, with what it means. */`,
      `  public static final Map<String, Code> STATUS_CODES = Map.ofEntries(`,
      data.codes
        .map((c) => `      Map.entry(${q(c.code)}, new Code(${q(c.class)}, ${q(c.description)}))`)
        .join(",\n"),
      `  );`,
      ``,
      ...Object.entries(data.classes).flatMap((entry) => [
        `  /** ${entry[1].meaning || entry[0]} Retry: ${entry[1].retry ? "yes, with backoff" : "never"}. */`,
        `  public static final Set<String> ${upperSnake(entry[0])} = Set.of(`,
        `      ${(data.byClass[entry[0]] || []).map(q).join(", ")});`,
        ``,
      ]),
      `  /** Codes meaning "the outcome you wanted already holds" — treat as success. */`,
      `  public static final Map<String, List<String>> BENIGN = Map.ofEntries(`,
      Object.entries(data.benign)
        .map(([op, codes]) => `      Map.entry(${q(op)}, List.of(${codes.map(q).join(", ")}))`)
        .join(",\n"),
      `  );`,
      ``,
      `  public static String classify(String code) {`,
      `    Code entry = STATUS_CODES.get(code);`,
      `    return entry == null ? "unknown" : entry.handling();`,
      `  }`,
      ``,
      `  public static String describe(String code) {`,
      `    Code entry = STATUS_CODES.get(code);`,
      `    return entry == null ? "Unpublished status code " + code : entry.description();`,
      `  }`,
      ``,
      `  public static boolean isBenign(String operation, String code) {`,
      `    return BENIGN.getOrDefault(operation, List.of()).contains(code);`,
      `  }`,
      `}`,
    ]);
  },

  types(services) {
    return j([
      java.comment(BANNER("types", "Java")),
      ...services.flatMap((s) => [
        `/** Request body for ${s.name} — POST ${urlFor(s)} */`,
        `public record ${pascal(s.id)}Request(`,
        (s.parameters || [])
          .map((p) => `    ${p.type === "string[]" ? "List<String>" : p.type === "object" ? "Map<String, Object>" : "String"} ${p.name}`)
          .join(",\n"),
        `) {}`,
        ``,
        `/** Response body for ${s.name}. */`,
        `public record ${pascal(s.id)}Response(`,
        (s.responseFields || [])
          .map((f) => `    ${f.type === "object[]" ? "List<Map<String, Object>>" : "String"} ${f.name}`)
          .join(",\n"),
        `) {}`,
        ``,
      ]),
    ]);
  },

  callback(cb) {
    const required = (cb.fields || []).filter((f) => f.required).map((f) => f.name);
    return j([
      java.comment([
        `${cb.name} handler — POST ${cb.suggestedPath}`,
        ``,
        cb.summary,
        ``,
        `Acknowledge first, work second. Always HTTP 200, even for payloads you reject.`,
        `Deduplicate on: ${cb.dedupeKey}`,
      ]),
      `@PostMapping(${q(cb.suggestedPath)})`,
      `public ResponseEntity<Map<String, String>> ${camel(cb.id)}(@RequestBody Map<String, Object> body) {`,
      required.length
        ? `  if (${required.map((f) => `body.get(${q(f)}) == null`).join(" || ")}) return ack();`
        : null,
      (cb.fields || []).some((f) => f.name === "applicationId")
        ? `  if (!Objects.equals(body.get("applicationId"), System.getenv("IDEAMART_APP_ID"))) return ack();`
        : null,
      `  if (dedupe.isDuplicate("${cb.id}:" + ${dedupeExpr(cb, "java")})) return ack();`,
      ``,
      `  handleAsync(${q(cb.id)}, body); // never do the work before responding`,
      `  return ack();`,
      `}`,
      ``,
      `private ResponseEntity<Map<String, String>> ack() {`,
      `  return ResponseEntity.ok(Map.of("statusCode", "S1000", "statusDetail", "Success"));`,
      `}`,
    ]);
  },

  config(plans) {
    return j([
      java.comment(BANNER("config", "Java")),
      `public final class IdeamartConfig {`,
      `  public static final Map<String, String> ENDPOINT_VARS = Map.ofEntries(`,
      uniqueEndpoints(plans)
        .map(([key, envVar]) => `      Map.entry(${q(key)}, ${q(envVar)})`)
        .join(",\n"),
      `  );`,
      ``,
      `  public static String requireEnv(String name) {`,
      `    String value = System.getenv(name);`,
      `    if (value == null || value.isBlank()) {`,
      `      throw new IllegalStateException("[ideamart] Missing environment variable " + name);`,
      `    }`,
      `    return value;`,
      `  }`,
      `}`,
    ]);
  },
};

/* ── Go ──────────────────────────────────────────────────────────────────── */

const go = {
  id: "go",
  label: "Go",
  ext: "go",
  comment: (lines) => lines.map((l) => `// ${l}`.trimEnd()).join("\n"),
  name: (s) => pascal(s),

  /** File banner. Go's formatter, not the generator, owns map alignment. */
  banner: (target) =>
    go.comment([
      ...BANNER(target, "Go"),
      ``,
      `Run gofmt on this file after saving — the generator does not align maps.`,
    ]),

  goType: (a) => (a.telArray ? "[]string" : a.type === "object" ? "map[string]any" : "string"),

  service(plan) {
    const sig = plan.args.map((a) => `${camel(a.wire)} ${go.goType(a)}`).join(", ");
    const body = [
      ...Object.entries(plan.fixed).map(([k, v]) => `\t\t${q(k)}: ${q(v)},`),
      ...plan.args
        .filter((a) => a.required || a.default !== null)
        .map((a) => {
          const v = camel(a.wire);
          if (a.telArray) return `\t\t${q(a.wire)}: recipients,`;
          if (a.tel) return `\t\t${q(a.wire)}: address,`;
          return `\t\t${q(a.wire)}: ${v},`;
        }),
    ];
    const telPrep = plan.args
      .filter((a) => a.tel || a.telArray)
      .map((a) =>
        a.telArray
          ? j([
              `\trecipients := make([]string, 0, len(${camel(a.wire)}))`,
              `\tfor _, raw := range ${camel(a.wire)} {`,
              `\t\taddress, err := ToTelAddress(raw)`,
              `\t\tif err != nil {`,
              `\t\t\treturn nil, err`,
              `\t\t}`,
              `\t\trecipients = append(recipients, address)`,
              `\t}`,
            ])
          : j([
              `\taddress, err := ToTelAddress(${camel(a.wire)})`,
              `\tif err != nil {`,
              `\t\treturn nil, err`,
              `\t}`,
            ])
      );
    const optional = plan.args.filter((a) => !a.required && a.default === null);
    return j([
      go.comment([
        `${pascal(plan.fn)} — POST ${plan.url}`,
        ``,
        plan.summary,
        ...(plan.movesMoney
          ? ["", "THIS MOVES REAL MONEY. Persist externalTrxID before calling."]
          : []),
        ...(plan.benignNote.length ? ["", ...plan.benignNote] : []),
        ...(optional.length
          ? ["", "Optional fields are passed through opts; omit a key to leave it unset:", ...optional.map((a) => `  ${a.wire}: ${a.description}`)]
          : []),
      ]),
      `func (c *Client) ${pascal(plan.fn)}(ctx context.Context${sig ? ", " + sig : ""}${
        optional.length ? ", opts map[string]any" : ""
      }) (map[string]any, error) {`,
      `\turl, err := c.config.RequireEndpoint(${q(plan.endpointKey)})`,
      `\tif err != nil {`,
      `\t\treturn nil, err`,
      `\t}`,
      ...telPrep,
      ...guards.go(plan),
      `\tbody := map[string]any{`,
      ...body,
      `\t}`,
      ...(optional.length
        ? [`\tfor key, value := range opts {`, `\t\tbody[key] = value`, `\t}`]
        : []),
      `\treturn c.post(ctx, ${q(plan.id)}, url, body${
        plan.benign.length ? `, ${plan.benign.map(q).join(", ")}` : ""
      })`,
      `}`,
    ]);
  },

  client(plans) {
    return j([
      go.banner("client"),
      `package ideamart`,
      ``,
      `import (`,
      `\t"bytes"`,
      `\t"context"`,
      `\t"encoding/json"`,
      `\t"fmt"`,
      `\t"io"`,
      `\t"net/http"`,
      `\t"os"`,
      `\t"regexp"`,
      `\t"strings"`,
      `\t"time"`,
      `)`,
      ``,
      `const timeout = 15 * time.Second`,
      ``,
      `// endpointVars maps a service key to its environment variable. An unset`,
      `// variable means that API is not provisioned on the application.`,
      `var endpointVars = map[string]string{`,
      ...uniqueEndpoints(plans).map(([key, envVar]) => `\t${q(key)}: ${q(envVar)},`),
      `}`,
      ``,
      `type Config struct {`,
      `\tApplicationID string`,
      `\tPassword      string`,
      `}`,
      ``,
      `// LoadConfig reads the credentials. Call it once at startup and fail the`,
      `// process on error: a misconfigured deployment must not accept traffic.`,
      `func LoadConfig() (*Config, error) {`,
      `\tapplicationID := strings.TrimSpace(os.Getenv("IDEAMART_APP_ID"))`,
      `\tpassword := strings.TrimSpace(os.Getenv("IDEAMART_PASSWORD"))`,
      `\tif applicationID == "" || password == "" {`,
      `\t\treturn nil, fmt.Errorf("[ideamart] IDEAMART_APP_ID and IDEAMART_PASSWORD are required")`,
      `\t}`,
      `\treturn &Config{ApplicationID: applicationID, Password: password}, nil`,
      `}`,
      ``,
      `func (c *Config) RequireEndpoint(service string) (string, error) {`,
      `\tvariable, known := endpointVars[service]`,
      `\tif !known {`,
      `\t\treturn "", fmt.Errorf("[ideamart] unknown service %q", service)`,
      `\t}`,
      `\turl := strings.TrimSpace(os.Getenv(variable))`,
      `\tif url == "" {`,
      `\t\treturn "", fmt.Errorf("[ideamart] %s is not configured: %s is missing from the environment", service, variable)`,
      `\t}`,
      `\treturn url, nil`,
      `}`,
      ``,
      `type Client struct {`,
      `\tconfig *Config`,
      `\thttp   *http.Client`,
      `}`,
      ``,
      `func NewClient(config *Config) *Client {`,
      `\treturn &Client{config: config, http: &http.Client{Timeout: timeout}}`,
      `}`,
      ``,
      `var separators = regexp.MustCompile(` + "`[\\s()\\-]`" + `)`,
      ``,
      `// ToTelAddress is the only place "tel:" is added.`,
      `func ToTelAddress(msisdn string) (string, error) {`,
      `\ttrimmed := strings.TrimSpace(msisdn)`,
      `\tif trimmed == "" {`,
      `\t\treturn "", fmt.Errorf("[ideamart] empty subscriber address")`,
      `\t}`,
      `\tif strings.HasPrefix(strings.ToLower(trimmed), "tel:") {`,
      `\t\treturn trimmed, nil`,
      `\t}`,
      `\tdigits := strings.TrimPrefix(separators.ReplaceAllString(trimmed, ""), "+")`,
      `\tdigits = strings.TrimPrefix(digits, "00")`,
      `\tif strings.HasPrefix(digits, "0") && len(digits) == 10 {`,
      `\t\tdigits = "94" + digits[1:]`,
      `\t}`,
      `\treturn "tel:" + digits, nil`,
      `}`,
      ``,
      `// post injects the credentials and decides success on statusCode alone:`,
      `// Ideamart answers HTTP 200 for its own failures.`,
      `func (c *Client) post(ctx context.Context, service, url string, body map[string]any, benign ...string) (map[string]any, error) {`,
      `\tpayload := map[string]any{`,
      `\t\t"applicationId": c.config.ApplicationID,`,
      `\t\t"password":      c.config.Password,`,
      `\t}`,
      `\tfor key, value := range body {`,
      `\t\tpayload[key] = value`,
      `\t}`,
      ``,
      `\tencoded, err := json.Marshal(payload)`,
      `\tif err != nil {`,
      `\t\treturn nil, fmt.Errorf("[ideamart] %s: %w", service, err)`,
      `\t}`,
      `\trequest, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(encoded))`,
      `\tif err != nil {`,
      `\t\treturn nil, fmt.Errorf("[ideamart] %s: %w", service, err)`,
      `\t}`,
      `\trequest.Header.Set("Content-Type", "application/json")`,
      ``,
      `\tresponse, err := c.http.Do(request)`,
      `\tif err != nil {`,
      `\t\treturn nil, fmt.Errorf("[ideamart] %s: transport failure: %w", service, err)`,
      `\t}`,
      `\tdefer response.Body.Close()`,
      ``,
      `\traw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))`,
      `\tif err != nil {`,
      `\t\treturn nil, fmt.Errorf("[ideamart] %s: %w", service, err)`,
      `\t}`,
      `\tvar data map[string]any`,
      `\tif err := json.Unmarshal(raw, &data); err != nil {`,
      `\t\treturn nil, fmt.Errorf("[ideamart] %s: non-JSON response", service)`,
      `\t}`,
      ``,
      `\tstatusCode, _ := data["statusCode"].(string)`,
      `\tif statusCode == "S1000" {`,
      `\t\treturn data, nil`,
      `\t}`,
      `\tfor _, code := range benign {`,
      `\t\tif statusCode == code {`,
      `\t\t\treturn data, nil`,
      `\t\t}`,
      `\t}`,
      `\tstatusDetail, _ := data["statusDetail"].(string)`,
      `\treturn nil, &Error{StatusCode: statusCode, StatusDetail: statusDetail, Service: service}`,
      `}`,
      ``,
      ...plans.map((p) => this.service(p) + "\n"),
    ]);
  },

  errors(data) {
    return j([
      go.banner("errors"),
      `package ideamart`,
      ``,
      `import "fmt"`,
      ``,
      `// StatusCode describes one published Ideamart status code.`,
      `type StatusCode struct {`,
      `\tHandling    string`,
      `\tDescription string`,
      `}`,
      ``,
      `// StatusCodes is every published status code, with what it means.`,
      `var StatusCodes = map[string]StatusCode{`,
      ...data.codes.map((c) => `\t${q(c.code)}: {${q(c.class)}, ${q(c.description)}},`),
      `}`,
      ``,
      ...Object.entries(data.classes).flatMap((entry) => [
        `// ${pascal(entry[0])} — ${entry[1].meaning || entry[0]} Retry: ${
          entry[1].retry ? "yes, with backoff" : "never"
        }.`,
        `var ${pascal(entry[0])} = map[string]bool{`,
        `\t${(data.byClass[entry[0]] || []).map((c) => `${q(c)}: true`).join(", ")},`,
        `}`,
        ``,
      ]),
      `// Benign codes mean "the outcome you wanted already holds" — treat as success.`,
      `var Benign = map[string][]string{`,
      ...Object.entries(data.benign).map(([op, codes]) => `\t${q(op)}: {${codes.map(q).join(", ")}},`),
      `}`,
      ``,
      `// Error is a non-S1000 application-level response.`,
      `type Error struct {`,
      `\tStatusCode   string`,
      `\tStatusDetail string`,
      `\tService      string`,
      `}`,
      ``,
      `func (e *Error) Error() string {`,
      `\treturn fmt.Sprintf("[%s] %s (%s)", e.StatusCode, e.StatusDetail, e.Service)`,
      `}`,
      ``,
      `// Handling returns the code's class: which of four things to do about it.`,
      `func (e *Error) Handling() string { return Classify(e.StatusCode) }`,
      ``,
      `// Retryable reports whether a backoff retry is appropriate.`,
      `func (e *Error) Retryable() bool { return Transient[e.StatusCode] }`,
      ``,
      `// IsConfiguration reports a provisioning or credential fault. Page on these.`,
      `func (e *Error) IsConfiguration() bool { return Configuration[e.StatusCode] }`,
      ``,
      `// Classify returns the handling class of a status code.`,
      `func Classify(code string) string {`,
      `\tif entry, ok := StatusCodes[code]; ok {`,
      `\t\treturn entry.Handling`,
      `\t}`,
      `\treturn "unknown"`,
      `}`,
      ``,
      `// Describe returns the published meaning of a status code.`,
      `func Describe(code string) string {`,
      `\tif entry, ok := StatusCodes[code]; ok {`,
      `\t\treturn entry.Description`,
      `\t}`,
      `\treturn "Unpublished status code " + code`,
      `}`,
      ``,
      `// IsBenign reports whether a code means the desired state already holds.`,
      `func IsBenign(operation, code string) bool {`,
      `\tfor _, benign := range Benign[operation] {`,
      `\t\tif benign == code {`,
      `\t\t\treturn true`,
      `\t\t}`,
      `\t}`,
      `\treturn false`,
      `}`,
    ]);
  },

  types(services) {
    return j([
      go.banner("types"),
      `package ideamart`,
      ``,
      ...services.flatMap((s) => [
        `// ${pascal(s.id)}Request is the request body for ${s.name} — POST ${urlFor(s)}`,
        `type ${pascal(s.id)}Request struct {`,
        ...(s.parameters || []).map(
          (p) =>
            `\t${pascal(p.name)} ${p.type === "string[]" ? "[]string" : p.type === "object" ? "map[string]any" : "string"} \`json:"${p.name}${p.required ? "" : ",omitempty"}"\` // ${p.description}`
        ),
        `}`,
        ``,
        `// ${pascal(s.id)}Response is the response body for ${s.name}.`,
        `type ${pascal(s.id)}Response struct {`,
        ...(s.responseFields || []).map(
          (f) =>
            `\t${pascal(f.name)} ${f.type === "object[]" ? "[]map[string]any" : "string"} \`json:"${f.name},omitempty"\` // ${f.description}`
        ),
        `}`,
        ``,
      ]),
    ]);
  },

  /** Shared by every handler in this file. */
  callbackPreamble: j([
    `// ack is the only response Ideamart expects.`,
    `var ack = map[string]string{"statusCode": "S1000", "statusDetail": "Success"}`,
    ``,
    `func writeAck(w http.ResponseWriter) {`,
    `\tw.Header().Set("Content-Type", "application/json")`,
    `\tw.WriteHeader(http.StatusOK)`,
    `\t_ = json.NewEncoder(w).Encode(ack)`,
    `}`,
  ]),

  callback(cb) {
    const required = (cb.fields || []).filter((f) => f.required).map((f) => f.name);
    return j([
      go.comment([
        `${pascal(cb.id)} handles POST ${cb.suggestedPath}`,
        ``,
        cb.summary,
        ``,
        `Acknowledge first, work second. Always HTTP 200, even for payloads you reject.`,
        `Deduplicate on: ${cb.dedupeKey}`,
      ]),
      `func (c *Callbacks) ${pascal(cb.id)}(w http.ResponseWriter, r *http.Request) {`,
      `\tdefer writeAck(w) // always 200 with S1000`,
      ``,
      `\tbody := readJSON(r)`,
      `\tif body == nil {`,
      `\t\treturn`,
      `\t}`,
      required.length
        ? `\tif ${required.map((f) => `str(body, ${q(f)}) == ""`).join(" || ")} {\n\t\treturn\n\t}`
        : null,
      (cb.fields || []).some((f) => f.name === "applicationId")
        ? `\tif str(body, "applicationId") != c.Config.ApplicationID {\n\t\treturn\n\t}`
        : null,
      `\tif c.dedupe.isDuplicate("${cb.id}:" + ${dedupeExpr(cb, "go")}) {`,
      `\t\treturn`,
      `\t}`,
      ``,
      `\tc.enqueue(${q(cb.id)}, body) // never do the work before responding`,
      `}`,
    ]);
  },

  config(plans) {
    return j([
      go.banner("config"),
      `package ideamart`,
      ``,
      `var endpointVars = map[string]string{`,
      ...uniqueEndpoints(plans).map(([key, envVar]) => `\t${q(key)}: ${q(envVar)},`),
      `}`,
    ]);
  },
};

/* ── PHP ─────────────────────────────────────────────────────────────────── */

const php = {
  id: "php",
  label: "PHP",
  ext: "php",
  comment: (lines) => j(["/**", ...lines.map((l) => ` * ${l}`.trimEnd()), " */"]),
  name: (s) => camel(s),

  service(plan) {
    const sig = plan.args
      .map((a) => {
        const n = "$" + camel(a.wire);
        if (a.required) return `${a.telArray ? "string|array " : "string "}${n}`;
        if (a.default !== null) return `string ${n} = ${q(a.default)}`;
        return `?string ${n} = null`;
      })
      .join(", ");
    const body = [
      ...Object.entries(plan.fixed).map(([k, v]) => `        ${q(k)} => ${q(v)},`),
      ...plan.args
        .filter((a) => a.required || a.default !== null)
        .map((a) => {
          const n = "$" + camel(a.wire);
          if (a.telArray)
            return `        ${q(a.wire)} => array_map([self::class, 'toTelAddress'], is_array(${n}) ? ${n} : [${n}]),`;
          if (a.tel) return `        ${q(a.wire)} => self::toTelAddress(${n}),`;
          return `        ${q(a.wire)} => ${n},`;
        }),
    ];
    const optional = plan.args.filter((a) => !a.required && a.default === null);
    return j([
      php.comment([
        `${plan.name} — POST ${plan.url}`,
        ``,
        plan.summary,
        ...(plan.movesMoney
          ? ["", "THIS MOVES REAL MONEY. Persist $externalTrxId before calling."]
          : []),
        ...(plan.benignNote.length ? ["", ...plan.benignNote] : []),
        ``,
        ...plan.args.map((a) => `@param ${a.required ? "" : "?"}string $${camel(a.wire)} ${argDoc(a)}`),
        `@return array<string, mixed>`,
      ]),
      `public function ${plan.fn}(${sig}): array`,
      `{`,
      ...guards.php(plan),
      `    $body = [`,
      ...body,
      `    ];`,
      ...optional.map(
        (a) =>
          `    if ($${camel(a.wire)} !== null) {\n        $body[${q(a.wire)}] = ${
            a.tel ? `self::toTelAddress($${camel(a.wire)})` : `$${camel(a.wire)}`
          };\n    }`
      ),
      `    return $this->post(${q(plan.id)}, $this->requireEndpoint(${q(plan.endpointKey)}), $body${
        plan.benign.length ? `, [${plan.benign.map(q).join(", ")}]` : ""
      });`,
      `}`,
    ]);
  },

  client(plans) {
    return j([
      `<?php`,
      ``,
      `declare(strict_types=1);`,
      ``,
      php.comment(BANNER("client", "PHP")),
      `final class IdeamartClient`,
      `{`,
      `    private const TIMEOUT_SECONDS = 15;`,
      ``,
      `    /** One environment variable per provisioned service. */`,
      `    private const ENDPOINT_VARS = [`,
      ...uniqueEndpoints(plans).map(([key, envVar]) => `        ${q(key)} => ${q(envVar)},`),
      `    ];`,
      ``,
      `    private function requireEndpoint(string $service): string`,
      `    {`,
      `        $variable = self::ENDPOINT_VARS[$service] ?? null;`,
      `        $url = $variable ? trim((string) (getenv($variable) ?: '')) : '';`,
      `        if ($url === '') {`,
      `            throw new RuntimeException(`,
      `                "[ideamart] {$service} is not configured. Either the API is not enabled on your " .`,
      `                "application in IdeaPro, or {$variable} is missing from the environment."`,
      `            );`,
      `        }`,
      ``,
      `        return $url;`,
      `    }`,
      ``,
      `    /** The only place tel: is added. */`,
      `    public static function toTelAddress(string $msisdn): string`,
      `    {`,
      `        $trimmed = trim($msisdn);`,
      `        if ($trimmed === '') {`,
      `            throw new InvalidArgumentException('[ideamart] Empty subscriber address');`,
      `        }`,
      `        if (stripos($trimmed, 'tel:') === 0) {`,
      `            return $trimmed;`,
      `        }`,
      `        $digits = ltrim((string) preg_replace('/[\\s()\\-]/', '', $trimmed), '+');`,
      `        if (str_starts_with($digits, '00')) {`,
      `            $digits = substr($digits, 2);`,
      `        }`,
      `        if (str_starts_with($digits, '0') && strlen($digits) === 10) {`,
      `            $digits = '94' . substr($digits, 1);`,
      `        }`,
      ``,
      `        return 'tel:' . $digits;`,
      `    }`,
      ``,
      `    /**`,
      `     * Credentials are injected here and nowhere else. The HTTP status is never`,
      `     * consulted: Ideamart answers 200 for its own failures.`,
      `     *`,
      `     * @param array<string, mixed> $body`,
      `     * @param list<string>         $benign`,
      `     *`,
      `     * @return array<string, mixed>`,
      `     */`,
      `    private function post(string $service, string $url, array $body, array $benign = []): array`,
      `    {`,
      `        $payload = json_encode(array_merge([`,
      `            'applicationId' => self::requireEnv('IDEAMART_APP_ID'),`,
      `            'password' => self::requireEnv('IDEAMART_PASSWORD'),`,
      `        ], $body), JSON_THROW_ON_ERROR);`,
      ``,
      `        $handle = curl_init($url);`,
      `        curl_setopt_array($handle, [`,
      `            CURLOPT_POST => true,`,
      `            CURLOPT_POSTFIELDS => $payload,`,
      `            CURLOPT_RETURNTRANSFER => true,`,
      `            CURLOPT_TIMEOUT => self::TIMEOUT_SECONDS,`,
      `            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],`,
      `            CURLOPT_SSL_VERIFYPEER => true,`,
      `            CURLOPT_SSL_VERIFYHOST => 2,`,
      `        ]);`,
      `        $raw = curl_exec($handle);`,
      `        $error = curl_error($handle);`,
      `        curl_close($handle);`,
      ``,
      `        if ($raw === false) {`,
      `            throw new RuntimeException("[ideamart] {$service}: transport failure: {$error}");`,
      `        }`,
      `        $data = json_decode((string) $raw, true);`,
      `        if (!is_array($data)) {`,
      `            throw new RuntimeException("[ideamart] {$service}: non-JSON response");`,
      `        }`,
      ``,
      `        $statusCode = (string) ($data['statusCode'] ?? '');`,
      `        if ($statusCode === 'S1000' || in_array($statusCode, $benign, true)) {`,
      `            return $data;`,
      `        }`,
      ``,
      `        throw new IdeamartException($statusCode, (string) ($data['statusDetail'] ?? ''), $service);`,
      `    }`,
      ``,
      `    private static function requireEnv(string $name): string`,
      `    {`,
      `        $value = trim((string) (getenv($name) ?: ''));`,
      `        if ($value === '') {`,
      `            throw new RuntimeException("[ideamart] Missing environment variable {$name}");`,
      `        }`,
      ``,
      `        return $value;`,
      `    }`,
      ``,
      ...plans.map((p) => indent(this.service(p), 4) + "\n"),
      `}`,
    ]);
  },

  errors(data) {
    return j([
      `<?php`,
      ``,
      `declare(strict_types=1);`,
      ``,
      php.comment(BANNER("errors", "PHP")),
      `final class IdeamartStatus`,
      `{`,
      `    /** Every published status code, with what it means. */`,
      `    public const STATUS_CODES = [`,
      ...data.codes.map(
        (c) => `        ${q(c.code)} => ['class' => ${q(c.class)}, 'description' => ${q(c.description)}],`
      ),
      `    ];`,
      ``,
      ...Object.entries(data.classes).flatMap((entry) => [
        `    /** ${entry[1].meaning || entry[0]} Retry: ${entry[1].retry ? "yes, with backoff" : "never"}. */`,
        `    public const ${upperSnake(entry[0])} = [${(data.byClass[entry[0]] || []).map(q).join(", ")}];`,
        ``,
      ]),
      `    /** Codes meaning "the outcome you wanted already holds" — treat as success. */`,
      `    public const BENIGN = [`,
      ...Object.entries(data.benign).map(
        ([op, codes]) => `        ${q(op)} => [${codes.map(q).join(", ")}],`
      ),
      `    ];`,
      ``,
      `    public static function classify(string $code): string`,
      `    {`,
      `        return self::STATUS_CODES[$code]['class'] ?? 'unknown';`,
      `    }`,
      ``,
      `    public static function describe(string $code): string`,
      `    {`,
      `        return self::STATUS_CODES[$code]['description'] ?? "Unpublished status code {$code}";`,
      `    }`,
      ``,
      `    public static function isBenign(string $operation, string $code): bool`,
      `    {`,
      `        return in_array($code, self::BENIGN[$operation] ?? [], true);`,
      `    }`,
      `}`,
      ``,
      `final class IdeamartException extends RuntimeException`,
      `{`,
      `    public function __construct(`,
      `        public readonly string $statusCode,`,
      `        public readonly string $statusDetail,`,
      `        public readonly string $service = '',`,
      `    ) {`,
      `        parent::__construct("[{$statusCode}] {$statusDetail} ({$service})");`,
      `    }`,
      ``,
      `    public function handling(): string`,
      `    {`,
      `        return IdeamartStatus::classify($this->statusCode);`,
      `    }`,
      ``,
      `    public function isRetryable(): bool`,
      `    {`,
      `        return in_array($this->statusCode, IdeamartStatus::TRANSIENT, true);`,
      `    }`,
      ``,
      `    public function isConfiguration(): bool`,
      `    {`,
      `        return in_array($this->statusCode, IdeamartStatus::CONFIGURATION, true);`,
      `    }`,
      `}`,
    ]);
  },

  /** These handlers are class members; the acknowledgement constant is shared. */
  callbackPreamble: j([
    `// Paste these into your controller class.`,
    `/** The only response Ideamart expects. */`,
    `public const ACK = ['statusCode' => 'S1000', 'statusDetail' => 'Success'];`,
  ]),

  types(services) {
    return j([
      `<?php`,
      ``,
      `declare(strict_types=1);`,
      ``,
      php.comment([
        ...BANNER("types", "PHP"),
        ``,
        `PHP has no structural types, so each shape is a documented array shape.`,
      ]),
      ...services.flatMap((s) => [
        `/**`,
        ` * Request body for ${s.name} — POST ${urlFor(s)}`,
        ` *`,
        ` * @phpstan-type ${pascal(s.id)}Request array{`,
        ...(s.parameters || []).map(
          (p) =>
            ` *   ${p.name}${p.required ? "" : "?"}: ${p.type === "string[]" ? "list<string>" : p.type === "object" ? "array<string, mixed>" : "string"},`
        ),
        ` * }`,
        ` *`,
        ` * @phpstan-type ${pascal(s.id)}Response array{`,
        ...(s.responseFields || []).map(
          (f) => ` *   ${f.name}?: ${f.type === "object[]" ? "list<array<string, mixed>>" : "string"},`
        ),
        ` * }`,
        ` */`,
        ``,
      ]),
    ]);
  },

  callback(cb) {
    const required = (cb.fields || []).filter((f) => f.required).map((f) => f.name);
    return j([
      php.comment([
        `${cb.name} handler — POST ${cb.suggestedPath}`,
        ``,
        cb.summary,
        ``,
        `Acknowledge first, work second. Always HTTP 200, even for payloads you reject.`,
        `Deduplicate on: ${cb.dedupeKey}`,
        ``,
        `@param array<string, mixed>|null $body`,
        `@return array<string, string>`,
      ]),
      `public function ${camel(cb.id)}(?array $body): array`,
      `{`,
      `    if ($body === null) {`,
      `        return self::ACK; // malformed — acknowledge and discard`,
      `    }`,
      required.length
        ? `    if (${required.map((f) => `empty($body[${q(f)}])`).join(" || ")}) {\n        return self::ACK;\n    }`
        : null,
      (cb.fields || []).some((f) => f.name === "applicationId")
        ? `    if (($body['applicationId'] ?? null) !== $this->config->applicationId) {\n        return self::ACK;\n    }`
        : null,
      `    if ($this->dedupe->isDuplicate('${cb.id}:' . ${dedupeExpr(cb, "php")})) {`,
      `        return self::ACK;`,
      `    }`,
      ``,
      `    $this->queue->push(${q(cb.id)}, $body); // never do the work before responding`,
      ``,
      `    return self::ACK;`,
      `}`,
    ]);
  },

  config(plans) {
    return j([
      `<?php`,
      ``,
      `declare(strict_types=1);`,
      ``,
      php.comment(BANNER("config", "PHP")),
      `final class IdeamartConfig`,
      `{`,
      `    public const ENDPOINT_VARS = [`,
      ...uniqueEndpoints(plans).map(([key, envVar]) => `        ${q(key)} => ${q(envVar)},`),
      `    ];`,
      `}`,
    ]);
  },
};

/* ── C# ──────────────────────────────────────────────────────────────────── */

const csharp = {
  id: "csharp",
  label: "C#",
  ext: "cs",
  comment: (lines) => lines.map((l) => `// ${l}`.trimEnd()).join("\n"),
  name: (s) => pascal(s),

  csType: (a) => (a.telArray ? "IEnumerable<string>" : a.type === "object" ? "IDictionary<string, object?>" : "string"),

  service(plan) {
    const sig = plan.args
      .map((a) => {
        const n = camel(a.wire);
        if (a.required) return `${csharp.csType(a)} ${n}`;
        if (a.default !== null) return `string ${n} = ${q(a.default)}`;
        return `string? ${n} = null`;
      })
      .join(", ");
    const body = [
      ...Object.entries(plan.fixed).map(([k, v]) => `        [${q(k)}] = ${q(v)},`),
      ...plan.args
        .filter((a) => a.required || a.default !== null)
        .map((a) => {
          const n = camel(a.wire);
          if (a.telArray) return `        [${q(a.wire)}] = ${n}.Select(ToTelAddress).ToList(),`;
          if (a.tel) return `        [${q(a.wire)}] = ToTelAddress(${n}),`;
          return `        [${q(a.wire)}] = ${n},`;
        }),
    ];
    const optional = plan.args.filter((a) => !a.required && a.default === null);
    return j([
      csharp.comment([
        `${plan.name} — POST ${plan.url}`,
        ``,
        plan.summary,
        ...(plan.movesMoney
          ? ["", "THIS MOVES REAL MONEY. Persist externalTrxId before calling."]
          : []),
        ...(plan.benignNote.length ? ["", ...plan.benignNote] : []),
      ]),
      `public Task<JsonElement> ${pascal(plan.fn)}Async(${sig}${sig ? ", " : ""}CancellationToken cancellationToken = default)`,
      `{`,
      ...guards.csharp(plan),
      `    var body = new Dictionary<string, object?>`,
      `    {`,
      ...body,
      `    };`,
      ...optional.map(
        (a) =>
          `    if (!string.IsNullOrEmpty(${camel(a.wire)})) body[${q(a.wire)}] = ${
            a.tel ? `ToTelAddress(${camel(a.wire)})` : camel(a.wire)
          };`
      ),
      `    return PostAsync(${q(plan.id)}, RequireEndpoint(${q(plan.endpointKey)}), body, cancellationToken${
        plan.benign.length ? `, ${plan.benign.map(q).join(", ")}` : ""
      });`,
      `}`,
    ]);
  },

  client(plans) {
    return j([
      csharp.comment(BANNER("client", "C#")),
      `public sealed partial class IdeamartClient`,
      `{`,
      `    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(15);`,
      ``,
      `    /// <summary>One environment variable per provisioned service.</summary>`,
      `    public static readonly IReadOnlyDictionary<string, string> EndpointVariables =`,
      `        new Dictionary<string, string>`,
      `        {`,
      ...uniqueEndpoints(plans).map(([key, envVar]) => `            [${q(key)}] = ${q(envVar)},`),
      `        };`,
      ``,
      `    private readonly HttpClient _http;`,
      ``,
      `    public IdeamartClient(HttpClient http)`,
      `    {`,
      `        _http = http;`,
      `        _http.Timeout = Timeout;`,
      `    }`,
      ``,
      `    private static string RequireEndpoint(string service)`,
      `    {`,
      `        var variable = EndpointVariables[service];`,
      `        var url = Environment.GetEnvironmentVariable(variable);`,
      `        if (string.IsNullOrWhiteSpace(url))`,
      `        {`,
      `            throw new InvalidOperationException(`,
      `                $"[ideamart] {service} is not configured. Either the API is not enabled on your " +`,
      `                $"application in IdeaPro, or {variable} is missing from the environment.");`,
      `        }`,
      ``,
      `        return url;`,
      `    }`,
      ``,
      `    /// <summary>The only place tel: is added.</summary>`,
      `    public static string ToTelAddress(string msisdn)`,
      `    {`,
      `        var trimmed = (msisdn ?? string.Empty).Trim();`,
      `        if (trimmed.Length == 0) throw new ArgumentException("[ideamart] Empty subscriber address");`,
      `        if (trimmed.StartsWith("tel:", StringComparison.OrdinalIgnoreCase)) return trimmed;`,
      ``,
      `        var digits = Regex.Replace(trimmed, @"[\\s()-]", string.Empty).TrimStart('+');`,
      `        if (digits.StartsWith("00", StringComparison.Ordinal)) digits = digits[2..];`,
      `        if (digits.StartsWith("0", StringComparison.Ordinal) && digits.Length == 10) digits = "94" + digits[1..];`,
      ``,
      `        return "tel:" + digits;`,
      `    }`,
      ``,
      `    /// <summary>`,
      `    /// Credentials are injected here and nowhere else. The HTTP status is never`,
      `    /// consulted: Ideamart answers 200 for its own failures.`,
      `    /// </summary>`,
      `    private async Task<JsonElement> PostAsync(`,
      `        string service,`,
      `        string url,`,
      `        IDictionary<string, object?> body,`,
      `        CancellationToken cancellationToken,`,
      `        params string[] benign)`,
      `    {`,
      `        var payload = new Dictionary<string, object?>(body)`,
      `        {`,
      `            ["applicationId"] = RequireEnv("IDEAMART_APP_ID"),`,
      `            ["password"] = RequireEnv("IDEAMART_PASSWORD"),`,
      `        };`,
      ``,
      `        using var response = await _http.PostAsJsonAsync(url, payload, cancellationToken)`,
      `            .ConfigureAwait(false);`,
      `        var data = await response.Content`,
      `            .ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken)`,
      `            .ConfigureAwait(false);`,
      ``,
      `        var statusCode = data.TryGetProperty("statusCode", out var code) ? code.GetString() ?? "" : "";`,
      `        if (statusCode == "S1000" || benign.Contains(statusCode)) return data;`,
      ``,
      `        var detail = data.TryGetProperty("statusDetail", out var value) ? value.GetString() ?? "" : "";`,
      `        throw new IdeamartException(statusCode, detail, service);`,
      `    }`,
      ``,
      `    private static string RequireEnv(string name) =>`,
      `        Environment.GetEnvironmentVariable(name)`,
      `        ?? throw new InvalidOperationException($"[ideamart] Missing environment variable {name}");`,
      ``,
      ...plans.map((p) => indent(this.service(p), 4) + "\n"),
      `}`,
    ]);
  },

  errors(data) {
    return j([
      csharp.comment(BANNER("errors", "C#")),
      `public static class IdeamartStatus`,
      `{`,
      `    public sealed record Code(string Handling, string Description);`,
      ``,
      `    /// <summary>Every published status code, with what it means.</summary>`,
      `    public static readonly IReadOnlyDictionary<string, Code> StatusCodes =`,
      `        new Dictionary<string, Code>`,
      `        {`,
      ...data.codes.map((c) => `            [${q(c.code)}] = new(${q(c.class)}, ${q(c.description)}),`),
      `        };`,
      ``,
      ...Object.entries(data.classes).flatMap((entry) => [
        `    /// <summary>${entry[1].meaning || entry[0]} Retry: ${
          entry[1].retry ? "yes, with backoff" : "never"
        }.</summary>`,
        `    public static readonly IReadOnlySet<string> ${pascal(entry[0])} = new HashSet<string>`,
        `    {`,
        `        ${(data.byClass[entry[0]] || []).map(q).join(", ")},`,
        `    };`,
        ``,
      ]),
      `    /// <summary>Codes meaning "the outcome you wanted already holds" — treat as success.</summary>`,
      `    public static readonly IReadOnlyDictionary<string, string[]> Benign =`,
      `        new Dictionary<string, string[]>`,
      `        {`,
      ...Object.entries(data.benign).map(
        ([op, codes]) => `            [${q(op)}] = new[] { ${codes.map(q).join(", ")} },`
      ),
      `        };`,
      ``,
      `    public static string Classify(string code) =>`,
      `        StatusCodes.TryGetValue(code, out var entry) ? entry.Handling : "unknown";`,
      ``,
      `    public static string Describe(string code) =>`,
      `        StatusCodes.TryGetValue(code, out var entry)`,
      `            ? entry.Description`,
      `            : $"Unpublished status code {code}";`,
      ``,
      `    public static bool IsBenign(string operation, string code) =>`,
      `        Benign.TryGetValue(operation, out var codes) && codes.Contains(code);`,
      `}`,
      ``,
      `public sealed class IdeamartException : Exception`,
      `{`,
      `    public IdeamartException(string statusCode, string statusDetail, string service)`,
      `        : base($"[{statusCode}] {statusDetail} ({service})")`,
      `    {`,
      `        StatusCode = statusCode;`,
      `        StatusDetail = statusDetail;`,
      `        Service = service;`,
      `    }`,
      ``,
      `    public string StatusCode { get; }`,
      ``,
      `    public string StatusDetail { get; }`,
      ``,
      `    public string Service { get; }`,
      ``,
      `    public string Handling => IdeamartStatus.Classify(StatusCode);`,
      ``,
      `    public bool IsRetryable => IdeamartStatus.Transient.Contains(StatusCode);`,
      ``,
      `    public bool IsConfiguration => IdeamartStatus.Configuration.Contains(StatusCode);`,
      `}`,
    ]);
  },

  types(services) {
    return j([
      csharp.comment(BANNER("types", "C#")),
      ...services.flatMap((s) => [
        `/// <summary>Request body for ${s.name} — POST ${urlFor(s)}</summary>`,
        `public sealed record ${pascal(s.id)}Request(`,
        (s.parameters || [])
          .map(
            (p) =>
              `    ${p.type === "string[]" ? "IReadOnlyList<string>" : p.type === "object" ? "IDictionary<string, object?>" : "string"}${p.required ? "" : "?"} ${pascal(p.name)}`
          )
          .join(",\n"),
        `);`,
        ``,
        `/// <summary>Response body for ${s.name}.</summary>`,
        `public sealed record ${pascal(s.id)}Response(`,
        (s.responseFields || [])
          .map(
            (f) =>
              `    ${f.type === "object[]" ? "IReadOnlyList<IDictionary<string, object?>>" : "string"}? ${pascal(f.name)}`
          )
          .join(",\n"),
        `);`,
        ``,
      ]),
    ]);
  },

  /** Shared by every endpoint in this file. */
  callbackPreamble: j([
    `// The only response Ideamart expects.`,
    `var Ack = new Dictionary<string, string>`,
    `{`,
    `    ["statusCode"] = "S1000",`,
    `    ["statusDetail"] = "Success",`,
    `};`,
  ]),

  callback(cb) {
    const required = (cb.fields || []).filter((f) => f.required).map((f) => f.name);
    return j([
      csharp.comment([
        `${cb.name} handler — POST ${cb.suggestedPath}`,
        ``,
        cb.summary,
        ``,
        `Acknowledge first, work second. Always HTTP 200, even for payloads you reject.`,
        `Deduplicate on: ${cb.dedupeKey}`,
      ]),
      `app.MapPost(${q(cb.suggestedPath)}, async (HttpContext context, IdeamartWorkQueue queue, IdeamartDedupe dedupe) =>`,
      `{`,
      `    var body = await ReadJsonAsync(context.Request);`,
      `    if (body is null) return Results.Json(Ack); // malformed — acknowledge and discard`,
      ``,
      required.length
        ? `    if (${required.map((f) => `Field(body.Value, ${q(f)}).Length == 0`).join(" || ")}) return Results.Json(Ack);`
        : null,
      (cb.fields || []).some((f) => f.name === "applicationId")
        ? `    if (Field(body.Value, "applicationId") != Environment.GetEnvironmentVariable("IDEAMART_APP_ID")) return Results.Json(Ack);`
        : null,
      `    if (dedupe.IsDuplicate($"${cb.id}:" + ${dedupeExpr(cb, "cs")})) return Results.Json(Ack);`,
      ``,
      `    await queue.EnqueueAsync(new IdeamartJob(${q(cb.id)}, body.Value.Clone()));`,
      `    return Results.Json(Ack);`,
      `});`,
    ]);
  },

  config(plans) {
    return j([
      csharp.comment(BANNER("config", "C#")),
      `public static class IdeamartConfig`,
      `{`,
      `    public static readonly IReadOnlyDictionary<string, string> EndpointVariables =`,
      `        new Dictionary<string, string>`,
      `        {`,
      ...uniqueEndpoints(plans).map(([key, envVar]) => `            [${q(key)}] = ${q(envVar)},`),
      `        };`,
      `}`,
    ]);
  },
};

/* ── Guards ──────────────────────────────────────────────────────────────── */

/**
 * Per-service local guards: the checks that stop a call before it reaches the
 * platform, expressed in each language.
 */
const guards = {
  typescript(plan) {
    const out = [];
    if (plan.id === "sms-send") {
      out.push(
        `  if (JSON.stringify(input.destinationAddresses).includes("tel:all")) {`,
        `    throw new Error("[ideamart] Broadcasts must go through a separate, authorised path.");`,
        `  }`
      );
    }
    if (plan.movesMoney) {
      out.push(
        `  if (!input.externalTrxId) throw new Error("[ideamart] externalTrxId is required and must be persisted first");`,
        `  if (input.externalTrxId.length > 32) throw new Error("[ideamart] externalTrxId must be 32 characters or fewer");`
      );
    }
    return out;
  },
  python(plan) {
    const out = [];
    if (plan.id === "sms-send") {
      out.push(
        `    if "tel:all" in (destination_addresses if isinstance(destination_addresses, list) else [destination_addresses]):`,
        `        raise ValueError("[ideamart] Broadcasts must go through a separate, authorised path.")`
      );
    }
    if (plan.movesMoney) {
      out.push(
        `    if not external_trx_id:`,
        `        raise ValueError("[ideamart] external_trx_id is required and must be persisted first")`,
        `    if len(external_trx_id) > 32:`,
        `        raise ValueError("[ideamart] external_trx_id must be 32 characters or fewer")`
      );
    }
    return out;
  },
  java(plan) {
    const out = [];
    if (plan.id === "sms-send") {
      out.push(
        `    if (destinationAddresses.contains("tel:all")) {`,
        `        throw new IllegalArgumentException("[ideamart] Broadcasts must go through a separate, authorised path.");`,
        `    }`
      );
    }
    if (plan.movesMoney) {
      out.push(
        `    if (externalTrxId == null || externalTrxId.isBlank()) {`,
        `        throw new IllegalArgumentException("[ideamart] externalTrxId is required and must be persisted first");`,
        `    }`,
        `    if (externalTrxId.length() > 32) {`,
        `        throw new IllegalArgumentException("[ideamart] externalTrxId must be 32 characters or fewer");`,
        `    }`
      );
    }
    return out;
  },
  go(plan) {
    const out = [];
    if (plan.id === "sms-send") {
      out.push(
        `\tfor _, address := range recipients {`,
        `\t\tif address == "tel:all" {`,
        `\t\t\treturn nil, fmt.Errorf("[ideamart] broadcasts must go through a separate, authorised path")`,
        `\t\t}`,
        `\t}`
      );
    }
    if (plan.movesMoney) {
      out.push(
        `\tif externalTrxId == "" {`,
        `\t\treturn nil, fmt.Errorf("[ideamart] externalTrxId is required and must be persisted first")`,
        `\t}`,
        `\tif len(externalTrxId) > 32 {`,
        `\t\treturn nil, fmt.Errorf("[ideamart] externalTrxId must be 32 characters or fewer")`,
        `\t}`
      );
    }
    return out;
  },
  php(plan) {
    const out = [];
    if (plan.id === "sms-send") {
      out.push(
        `    if (in_array('tel:all', is_array($destinationAddresses) ? $destinationAddresses : [$destinationAddresses], true)) {`,
        `        throw new InvalidArgumentException('[ideamart] Broadcasts must go through a separate, authorised path.');`,
        `    }`
      );
    }
    if (plan.movesMoney) {
      out.push(
        `    if ($externalTrxId === '') {`,
        `        throw new InvalidArgumentException('[ideamart] externalTrxId is required and must be persisted first');`,
        `    }`,
        `    if (strlen($externalTrxId) > 32) {`,
        `        throw new InvalidArgumentException('[ideamart] externalTrxId must be 32 characters or fewer');`,
        `    }`
      );
    }
    return out;
  },
  csharp(plan) {
    const out = [];
    if (plan.id === "sms-send") {
      out.push(
        `    if (destinationAddresses.Contains("tel:all"))`,
        `    {`,
        `        throw new ArgumentException("[ideamart] Broadcasts must go through a separate, authorised path.");`,
        `    }`
      );
    }
    if (plan.movesMoney) {
      out.push(
        `    if (string.IsNullOrWhiteSpace(externalTrxId))`,
        `    {`,
        `        throw new ArgumentException("[ideamart] externalTrxId is required and must be persisted first");`,
        `    }`,
        `    if (externalTrxId.Length > 32)`,
        `    {`,
        `        throw new ArgumentException("[ideamart] externalTrxId must be 32 characters or fewer");`,
        `    }`
      );
    }
    return out;
  },
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function uniqueEndpoints(plans) {
  const seen = new Map();
  for (const p of plans) if (!seen.has(p.endpointKey)) seen.set(p.endpointKey, p.envVar);
  return [...seen.entries()];
}

function indent(text, spaces) {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

/** Build the deduplication key expression from the catalog's documented key. */
function dedupeExpr(cb, dialect) {
  const parts = String(cb.dedupeKey)
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
  const access = {
    js: (f) => `body.${f}`,
    py: (f) => `str(body.get(${q(f)}))`,
    java: (f) => `body.get(${q(f)})`,
    go: (f) => `str(body, ${q(f)})`,
    php: (f) => `($body[${q(f)}] ?? '')`,
    cs: (f) => `Field(body.Value, ${q(f)})`,
  }[dialect];
  const join = { js: " + ", py: " + ", java: " + ", go: " + ", php: " . ", cs: " + " }[dialect];
  const sep = { js: '":"', py: '":"', java: '":"', go: '":"', php: "':'", cs: '":"' }[dialect];
  return parts.map(access).join(`${join}${sep}${join}`);
}

/* ── Public API ──────────────────────────────────────────────────────────── */

export const LANGUAGES = { typescript, python, java, go, php, csharp };

export const LANGUAGE_ALIASES = {
  ts: "typescript",
  js: "typescript",
  javascript: "typescript",
  node: "typescript",
  py: "python",
  golang: "go",
  cs: "csharp",
  "c#": "csharp",
  dotnet: "csharp",
  net: "csharp",
};

export const TARGETS = ["client", "errors", "types", "config", "callbacks", "<service-id>"];

export function resolveLanguage(name) {
  const key = String(name || "").toLowerCase().trim();
  return LANGUAGES[LANGUAGE_ALIASES[key] || key] || null;
}

/**
 * Generate code.
 *
 * @param {string} target  a service id, a callback id, or one of TARGETS
 * @param {string} langId  language name or alias
 * @returns {{language: string, target: string, filename: string, code: string}}
 */
export function generate(target, langId) {
  const lang = resolveLanguage(langId);
  if (!lang) {
    throw new Error(
      `Unknown language "${langId}". Available: ${Object.keys(LANGUAGES).join(", ")}.`
    );
  }

  const plans = catalog.services.map(planService);
  const name = String(target || "client").toLowerCase();

  if (name === "client") {
    return out(lang, "client", `ideamart-client.${lang.ext}`, lang.client(plans));
  }
  if (name === "errors" || name === "codes") {
    return out(lang, "errors", `ideamart-errors.${lang.ext}`, lang.errors(planErrors()));
  }
  if (name === "types") {
    return out(lang, "types", `ideamart-types.${lang.ext}`, lang.types(catalog.services));
  }
  if (name === "config") {
    return out(lang, "config", `ideamart-config.${lang.ext}`, lang.config(plans));
  }
  if (name === "callbacks") {
    return out(
      lang,
      "callbacks",
      `ideamart-callbacks.${lang.ext}`,
      j([
        lang.comment(BANNER("callbacks", lang.label)),
        ``,
        lang.callbackPreamble || null,
        lang.callbackPreamble ? `` : null,
        ...catalog.callbacks.map((cb) => lang.callback(cb) + "\n"),
      ])
    );
  }

  const entry = findEntry(name);
  if (!entry) {
    throw new Error(
      `Unknown target "${target}". Use a service id, a callback id, or one of: ${TARGETS.join(", ")}.`
    );
  }
  if (entry.kind === "callback") {
    return out(
      lang,
      entry.id,
      `${entry.id}-handler.${lang.ext}`,
      j([lang.callbackPreamble || null, lang.callbackPreamble ? `` : null, lang.callback(entry)])
    );
  }
  return out(
    lang,
    entry.id,
    `${entry.id}.${lang.ext}`,
    j([lang.comment(BANNER(entry.id, lang.label)), ``, lang.service(planService(entry))])
  );
}

function out(lang, target, filename, code) {
  return { language: lang.id, target, filename, code: code.replace(/\n{3,}/g, "\n\n") + "\n" };
}

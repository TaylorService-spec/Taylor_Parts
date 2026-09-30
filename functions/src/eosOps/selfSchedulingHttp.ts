// THE CUSTOMER SELF-SCHEDULING TRANSPORT -- POST /public/self-scheduling (Controller SERVICE EXPERIENCE COMPLETION,
// 2026-09-30, increment C).
//
// THE ONE UNAUTHENTICATED EOS ROUTE, and deliberately the smallest: a customer has no EOS login, so the bearer is the
// scheduling TOKEN inside the body, and it authorizes exactly two operations on exactly one Work Order
// (selfScheduling.ts). There is no identity header, no tenant header, no Work Order id, and the operation table is
// closed:
//
//     readSchedulingOffer   { token }              -> the job context and the current choices, or the confirmation
//     selectSchedulingSlot  { token, slotStart }   -> revalidate and book through the governed scheduleWorkOrder
//
// Every refusal is a stable code; a stale selection additionally returns `refreshed` choices. An unknown, malformed or
// forged token is indistinguishable from any other (404 SESSION_NOT_FOUND). An expired, withdrawn or superseded link is
// 410. The route answers 503 NOT_ACTIVATED while the PostgreSQL Work Order authority is not ACTIVE.
import type { Pool } from "pg";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import { containsNulCharacter, NUL_CHARACTER_REFUSAL } from "../adminPolicy/requestText";
import { WORK_ORDER_WRITER_AUTHORITY, type PostgresWorkOrderWriterState } from "./workOrderWriterState";
import { SELF_SCHEDULING_ROUTE, readSchedulingOffer, selectSchedulingSlot } from "./selfScheduling";

export interface SelfSchedulingHttpOptions {
  readonly pool: Pool;
  readonly reader: PolicyReader;
  readonly allowedOrigins?: readonly string[];
  readonly now?: () => Date;
  /** TEST INJECTION ONLY; the deployed server reads the committed authority. */
  readonly workOrderPostgresState?: PostgresWorkOrderWriterState;
}

interface HttpRequestLike { readonly method?: string; readonly url?: string; readonly headers?: Record<string, string | string[] | undefined>; readonly body?: string }
interface HttpResponseShape { readonly status: number; readonly headers: Record<string, string>; readonly body: string }

const STATUS_BY_CATEGORY: Readonly<Record<string, number>> = Object.freeze({
  INVALID_INPUT: 400, NOT_FOUND: 404, PRECONDITION_FAILED: 412, CONFLICT: 409, FORBIDDEN: 403, UNAVAILABLE: 503,
});
/** A link that WAS valid and no longer is: 410, so a page can say "ask for a new link" rather than "try again". */
const GONE_CODES: ReadonlySet<string> = new Set(["SESSION_EXPIRED", "SESSION_REVOKED", "SESSION_AUTHORITY_WITHDRAWN"]);

function headers(origin: string | null): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
  };
}
const json = (status: number, body: unknown, origin: string | null): HttpResponseShape => ({ status, headers: headers(origin), body: JSON.stringify(body) });

function originOf(allowed: readonly string[] | undefined, value: string | string[] | undefined): string | null {
  const origin = Array.isArray(value) ? value[0] : value;
  if (!origin || !allowed || allowed.length === 0) return null;
  return allowed.includes(origin) ? origin : null;
}

export async function handleSelfSchedulingRequest(options: SelfSchedulingHttpOptions, request: HttpRequestLike): Promise<HttpResponseShape> {
  const method = (request.method ?? "GET").toUpperCase();
  const path = (request.url ?? "/").split("?")[0].replace(/\/$/, "");
  const origin = originOf(options.allowedOrigins, request.headers?.origin);
  if (method === "OPTIONS") {
    return { status: 204, headers: { ...headers(origin), "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type", "access-control-max-age": "600" }, body: "" };
  }
  if (path !== SELF_SCHEDULING_ROUTE) return json(404, { ok: false, code: "UNKNOWN_OPERATION", message: "no such route" }, origin);
  if (method !== "POST") return json(405, { ok: false, code: "UNKNOWN_OPERATION", message: "use POST" }, origin);
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = request.body && request.body.trim() ? JSON.parse(request.body) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    payload = parsed as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, code: "INVALID_INPUT", message: "body must be a JSON object" }, origin);
  }
  if (containsNulCharacter(payload)) return json(400, { ok: false, code: "INVALID_INPUT", message: NUL_CHARACTER_REFUSAL }, origin);
  const operation = payload.operation;
  if (operation !== "readSchedulingOffer" && operation !== "selectSchedulingSlot") {
    return json(404, { ok: false, operation: String(operation ?? ""), code: "UNKNOWN_OPERATION", message: "no such operation" }, origin);
  }
  const state = options.workOrderPostgresState ?? WORK_ORDER_WRITER_AUTHORITY.postgres;
  if (state !== "ACTIVE") return json(503, { ok: false, operation, code: "NOT_ACTIVATED", message: "online scheduling is not available yet" }, origin);
  const input = payload.input === undefined ? {} : payload.input;
  try {
    const result = operation === "readSchedulingOffer"
      ? await readSchedulingOffer({ pool: options.pool, now: options.now }, input)
      : await selectSchedulingSlot({ pool: options.pool, reader: options.reader, now: options.now }, input);
    return json(200, { ok: true, operation, result }, origin);
  } catch (err) {
    const e = err as { name?: string; code?: string; category?: string; message?: string; refreshed?: unknown };
    if (e?.name === "WorkOrderLifecycleError" || e?.name === "WorkOrderAssignmentError") {
      const status = GONE_CODES.has(e.code ?? "") ? 410 : STATUS_BY_CATEGORY[e.category ?? ""] ?? 500;
      return json(status, { ok: false, operation, code: e.code, message: e.message, ...(e.refreshed ? { refreshed: e.refreshed } : {}) }, origin);
    }
    // eslint-disable-next-line no-console -- never the token; the error class only
    console.error("[selfScheduling] unhandled", e?.name ?? "error");
    return json(500, { ok: false, operation, code: "INTERNAL", message: "the request could not be completed" }, origin);
  }
}

const MAX_BODY_BYTES = 16_384;
export function createSelfSchedulingHttpHandler(options: SelfSchedulingHttpOptions) {
  return async function nodeHandler(
    req: { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; on: Function },
    res: { writeHead: Function; end: Function },
  ): Promise<void> {
    let response: HttpResponseShape;
    try {
      const body = await new Promise<string>((resolve, reject) => {
        let total = 0;
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_BODY_BYTES) { reject(new Error("request body too large")); return; }
          chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
      });
      response = await handleSelfSchedulingRequest(options, { method: req.method, url: req.url, headers: req.headers, body });
    } catch {
      response = json(400, { ok: false, code: "INVALID_INPUT", message: "the request could not be read" }, null);
    }
    res.writeHead(response.status, response.headers);
    res.end(response.body);
  };
}

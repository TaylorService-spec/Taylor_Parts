// Records EVERY request a page makes to the EOS API origin: method, path, the JSON body's `operation`, the response status
// (and the server's refusal code for a 4xx/5xx), and the step (the page the persona was on) that was current when it fired.
//
// It restricts nothing to known operation names: a request to an operation nobody listed is still recorded and still judged.
// Pure observation -- it never alters, blocks or mocks a request.

/** The only 4xx the test tolerates: the pre-login cookie refresh that answers 401 when nobody is signed in yet. */
export function isExpectedRefusal(entry, phase) {
  return entry.method === "POST" && entry.path === "/auth/refresh" && entry.status === 401 && phase === "pre-login";
}

export function attachRecorder(page, { apiOrigin, appOrigin, state }) {
  const entries = [];
  const otherOrigins = new Map();
  const pending = [];
  const byRequest = new Map();
  let seq = 0;
  const t0 = Date.now();

  page.on("request", (req) => {
    let url;
    try { url = new URL(req.url()); } catch { return; }
    if (url.origin !== apiOrigin) {
      if (url.origin !== appOrigin && /^https?:$/.test(url.protocol)) otherOrigins.set(url.origin, (otherOrigins.get(url.origin) ?? 0) + 1);
      return;
    }
    let operation = null;
    if (req.method() === "POST") {
      try {
        const body = JSON.parse(req.postData() ?? "null");
        if (body && typeof body.operation === "string") operation = body.operation;
      } catch { /* not JSON: leave null */ }
    }
    let frame = null;
    try { frame = new URL(req.frame().url()).pathname; } catch { /* detached frame */ }
    const entry = {
      seq: (seq += 1), tMs: Date.now() - t0, method: req.method(), path: url.pathname, operation,
      step: state.step, phase: state.phase, framePath: frame, status: null, code: null, failure: null,
    };
    entries.push(entry);
    byRequest.set(req, entry);
  });

  page.on("response", (res) => {
    const entry = byRequest.get(res.request());
    if (!entry) return;
    entry.status = res.status();
    // Keep the server's own explanation of a refusal (never a token): the code/reason fields only.
    if (res.status() >= 400) {
      pending.push(res.text().then((text) => {
        try {
          const j = JSON.parse(text);
          entry.code = j.code ?? j.error?.code ?? null;
          entry.reason = j.reason ?? j.error?.reason ?? null;
        } catch { entry.code = null; }
      }).catch(() => {}));
    }
    if (entry.operation === "resolveMyCapabilities" && res.status() === 200) {
      pending.push(res.json().then((j) => {
        const r = j?.result ?? j;
        state.capabilities = Array.isArray(r?.capabilities) ? [...r.capabilities].sort() : state.capabilities;
        state.heldRoleKeys = Array.isArray(r?.heldRoleKeys) ? [...r.heldRoleKeys].sort() : state.heldRoleKeys;
      }).catch(() => {}));
    }
  });

  page.on("requestfailed", (req) => {
    const entry = byRequest.get(req);
    if (entry) entry.failure = req.failure()?.errorText ?? "failed";
  });

  return {
    entries,
    otherOrigins,
    /** Await the response-body reads started above. Call after the last settle. */
    async flush() { await Promise.allSettled(pending); },
  };
}

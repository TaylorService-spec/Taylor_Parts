// ONE BOUNDED READ -- shared by the session identity reads (auth/eosEmployeeSession.js) and the capability feed
// (access/useEosCapabilityFeed.js). Firebase exit F1 (DECISIONS #244).
//
// A read that does not answer within the bound is a FAILED read: the abort cancels a real fetch, and the race settles the read
// even if a client ignores the signal. So a slow service is a settled deny / a retryable error, never an infinite "Loading...".
// Pure: no React, no Firebase, no network of its own.
export const READ_TIMEOUT_MS = 10000;

/**
 * @param {(signal: AbortSignal|undefined) => Promise<object>} run  the read, given the abort signal to pass to its client
 * @param {number} timeoutMs
 * @param {object} failure  the value a timeout or a thrown read resolves to
 */
export async function boundedRead(run, timeoutMs, failure) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer = null;
  const expired = new Promise((resolve) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      resolve(failure);
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller ? controller.signal : undefined), expired]);
  } catch {
    return failure;
  } finally {
    clearTimeout(timer);
  }
}

// BOUNDED RUN — do independent async work a few at a time, keeping results in input order.
//
// Extracted from BIN-P3's racking apply so the BIN-P6 movement session uses the same runner rather than
// a second one. Both send N independent governed commands, one per row or line, and both need the same
// three properties: never more than `concurrency` in flight, one row's failure never abandons the rest,
// and results come back in the order the rows went in, whatever order they finish.
//
// The worker owns its own error handling and returns a result for every row; this module never decides
// what a failure means.

/** Run `worker(item, index)` over every item, at most `concurrency` at once. Results keep input order. */
export async function runBounded(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}

// Trusted EOS transport seam. The provider receives the API key only inside Secret Broker's callback.
// The spend ledger reserves an invocation's conservative estimate before credential resolution/provider use;
// invocation ids are at-most-once and reservations survive retries for the lifetime of the job/session ledger.

import { SecretBrokerError, SECRET_FAILURE } from "./secretProvider.mjs";

export function createInMemorySpendLedger() {
  const totals = new Map();
  const invocationIds = new Set();
  return Object.freeze({
    reserve({ authorizationSha256, invocationId, amountUsd, ceilingUsd }) {
      if (!authorizationSha256 || !invocationId || !Number.isFinite(amountUsd) || amountUsd < 0) throw new SecretBrokerError(SECRET_FAILURE.BUDGET_UNAUTHORIZED);
      const key = `${authorizationSha256}:${invocationId}`;
      if (invocationIds.has(key)) throw new SecretBrokerError(SECRET_FAILURE.WORK_UNAUTHORIZED);
      const spent = totals.get(authorizationSha256) || 0;
      if (spent + amountUsd > ceilingUsd + Number.EPSILON) throw new SecretBrokerError(SECRET_FAILURE.BUDGET_UNAUTHORIZED);
      invocationIds.add(key); totals.set(authorizationSha256, spent + amountUsd);
      return Object.freeze({ spentBeforeUsd: spent, reservedUsd: amountUsd, spentAfterUsd: spent + amountUsd, remainingUsd: ceilingUsd - spent - amountUsd });
    },
    snapshot(authorizationSha256) { return Object.freeze({ cumulativeReservedUsd: totals.get(authorizationSha256) || 0 }); },
  });
}

export function createFileSpendLedger({ path, fs }) {
  if (!path || !fs?.readFileSync || !fs?.writeFileSync || !fs?.renameSync) throw new Error("durable spend ledger is not configured");
  const read = () => { try { return JSON.parse(fs.readFileSync(path, "utf8")); } catch (error) { if (error?.code === "ENOENT") return { totals: {}, invocationIds: [] }; throw new Error("spend ledger unreadable"); } };
  const write = (state) => { const temp = `${path}.${process.pid}.tmp`; fs.mkdirSync?.(path.replace(/[/\\][^/\\]+$/, ""), { recursive: true }); fs.writeFileSync(temp, JSON.stringify(state), { encoding: "utf8", flag: "wx" }); fs.renameSync(temp, path); };
  return Object.freeze({
    reserve({ authorizationSha256, invocationId, amountUsd, ceilingUsd }) {
      if (!authorizationSha256 || !invocationId || !Number.isFinite(amountUsd) || amountUsd < 0) throw new SecretBrokerError(SECRET_FAILURE.BUDGET_UNAUTHORIZED);
      const state = read(); const key = `${authorizationSha256}:${invocationId}`;
      if (state.invocationIds.includes(key)) throw new SecretBrokerError(SECRET_FAILURE.WORK_UNAUTHORIZED);
      const spent = state.totals[authorizationSha256] || 0;
      if (spent + amountUsd > ceilingUsd + Number.EPSILON) throw new SecretBrokerError(SECRET_FAILURE.BUDGET_UNAUTHORIZED);
      state.invocationIds.push(key); state.totals[authorizationSha256] = spent + amountUsd; write(state);
      return Object.freeze({ spentBeforeUsd: spent, reservedUsd: amountUsd, spentAfterUsd: spent + amountUsd, remainingUsd: ceilingUsd - spent - amountUsd });
    },
    snapshot(authorizationSha256) { return Object.freeze({ cumulativeReservedUsd: read().totals[authorizationSha256] || 0 }); },
  });
}

export function createOpenAICredentialTransport({ broker, authorizedInvocation, estimateSpendUsd, invokeOpenAI, spendLedger }) {
  if (!broker?.withCredential || typeof estimateSpendUsd !== "function" || typeof invokeOpenAI !== "function" || !spendLedger?.reserve) throw new Error("OPENAI_REVIEW transport is not configured");
  return async function openAIReviewTransport(invocation) {
    if (invocation?.workId !== authorizedInvocation.workId || invocation?.reviewId !== authorizedInvocation.reviewId || invocation?.sourceCommit !== authorizedInvocation.sourceCommit || invocation?.workArtifactSha256 !== authorizedInvocation.workArtifactSha256 || !invocation?.invocationId) throw new SecretBrokerError(SECRET_FAILURE.WORK_UNAUTHORIZED);
    const estimatedSpendUsd = estimateSpendUsd(invocation);
    if (!Number.isFinite(estimatedSpendUsd) || estimatedSpendUsd < 0 || estimatedSpendUsd > authorizedInvocation.maxSpendUsd) throw new SecretBrokerError(SECRET_FAILURE.BUDGET_UNAUTHORIZED);
    const budget = spendLedger.reserve({ authorizationSha256: authorizedInvocation.sha256, invocationId: invocation.invocationId, amountUsd: estimatedSpendUsd, ceilingUsd: authorizedInvocation.maxSpendUsd });
    const result = await broker.withCredential("OPENAI_REVIEW", authorizedInvocation, async (apiKey) => invokeOpenAI({ apiKey, invocation }));
    return Object.freeze({ ...result, budget: { ...budget, authorizationSha256: authorizedInvocation.sha256 } });
  };
}

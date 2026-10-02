// THE DETERMINISTIC TEST ADAPTER (DECISIONS #198). The ONLY accounting delivery adapter that exists: no network, no
// provider, no credential. It answers from a script, and its acknowledgement reference is derived from the payload
// fingerprint, so the same run always produces the same answers. It lives under test/support and is never registered by
// any runtime module (the production registry is empty).
import { createHash } from "node:crypto";

export const TEST_ADAPTER_KEY = "eos-deterministic-test";

/**
 * @param {Array<"ACK"|"REJECT"|"RETRYABLE"|"FINAL"|"THROW"|"GARBAGE"|"ACK_WRONG_FINGERPRINT"|"ACK_WITH_AMOUNT"|"MUTATE">} script
 *   one answer per delivery, in order; an exhausted script throws (a delivery nobody planned for is a test failure).
 */
export function deterministicAccountingAdapter(script = ["ACK"]) {
  const plan = [...script];
  const deliveries = [];
  const fp = (payload) => createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return {
    key: TEST_ADAPTER_KEY,
    deliveries,
    prepare(payload, destination, deliveryIdempotencyKey) {
      return { deliveryIdempotencyKey, request: { payload, destinationRef: destination.externalCompanyRef } };
    },
    async deliver(prepared) {
      const step = plan.shift();
      if (step === undefined) throw new Error("deterministic adapter: no scripted answer left");
      deliveries.push({ key: prepared.deliveryIdempotencyKey, step, payload: prepared.request.payload });
      const ref = `TEST-${fp(prepared.request.payload).slice(0, 12).toUpperCase()}`;
      switch (step) {
        case "ACK": return { status: "accepted", documentReference: ref };
        case "ACK_WITH_AMOUNT": return { status: "accepted", documentReference: ref, amountMinor: "1", totalMinor: "999999" };
        case "ACK_WRONG_FINGERPRINT": return { status: "accepted", documentReference: ref, echoedFingerprint: "0".repeat(64) };
        case "REJECT": return { status: "rejected", code: "CUSTOMER_NOT_MAPPED", message: "the customer has no provider account" };
        case "RETRYABLE": return { status: "unavailable", code: "DESTINATION_UNAVAILABLE" };
        case "FINAL": return { status: "failed", code: "DESTINATION_REFUSED_PERMANENTLY" };
        case "GARBAGE": return { weird: true };
        case "MUTATE": {
          // An adapter that tries to rewrite EOS truth: the payload it was handed is frozen.
          prepared.request.payload.receivable.amountMinor = "1";
          return { status: "accepted", documentReference: ref };
        }
        case "THROW": throw new Error("simulated transport failure");
        default: throw new Error(`deterministic adapter: unknown step ${step}`);
      }
    },
    interpretAcknowledgement(response) {
      if (response?.status !== "accepted") return null;
      return { providerDocumentReference: response.documentReference, ...(response.echoedFingerprint ? { echoedPayloadFingerprint: response.echoedFingerprint } : {}),
        // Anything else an adapter returns is ignored by the control plane -- it never reaches an amount.
        amountMinor: response.amountMinor };
    },
    interpretRejection(response) {
      if (response?.status === "rejected") return { disposition: "REJECTED", code: response.code, detail: response.message };
      if (response?.status === "unavailable") return { disposition: "FAILED_RETRYABLE", code: response.code };
      if (response?.status === "failed") return { disposition: "FAILED_FINAL", code: response.code };
      return null;
    },
  };
}

import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  REPOSITORY_INTELLIGENCE_CAPABILITY,
  repositoryProviderFromEnvironment,
} from "./provider";
import { AIError, type AIRequestContext } from "./types";

const SOURCE_ID = "eos-repository-main";
const MAX_QUESTION_CHARS = 2000;
const DEFAULT_CONTEXT_BUDGET = 4000;
const MAX_CONTEXT_BUDGET = 8000;

function projectAllowsAskEOS(): boolean {
  if (process.env.FUNCTIONS_EMULATOR === "true") return true;
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
  return projectId === "eos-platform-sandbox";
}

function safeQuestion(data: unknown): { question: string; contextBudget: number } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  const input = data as Record<string, unknown>;
  const extra = Object.keys(input).filter((key) => !["question", "contextBudget"].includes(key));
  if (extra.length) {
    throw new HttpsError("invalid-argument", "Only question and contextBudget are accepted.");
  }
  if (typeof input.question !== "string") {
    throw new HttpsError("invalid-argument", "question is required.");
  }
  const question = input.question.trim();
  if (!question || question.length > MAX_QUESTION_CHARS) {
    throw new HttpsError("invalid-argument", `question must be 1-${MAX_QUESTION_CHARS} characters.`);
  }
  const contextBudget = input.contextBudget === undefined ? DEFAULT_CONTEXT_BUDGET : input.contextBudget;
  if (!Number.isInteger(contextBudget) || Number(contextBudget) < 1000 || Number(contextBudget) > MAX_CONTEXT_BUDGET) {
    throw new HttpsError("invalid-argument", `contextBudget must be an integer from 1000-${MAX_CONTEXT_BUDGET}.`);
  }
  return { question, contextBudget: Number(contextBudget) };
}

function mapAIError(error: unknown): never {
  if (!(error instanceof AIError)) {
    throw new HttpsError("unavailable", "Ask EOS is unavailable right now.");
  }
  switch (error.code) {
    case "AI_NOT_CONFIGURED":
      throw new HttpsError("failed-precondition", "Ask EOS is not configured in this environment.");
    case "AI_PROVIDER_UNAVAILABLE":
    case "AI_PROVIDER_ERROR":
      throw new HttpsError("unavailable", "Ask EOS could not reach the repository intelligence service.");
    case "AI_CAPABILITY_DENIED":
      throw new HttpsError("permission-denied", "Ask EOS is not available to this user.");
    default:
      throw new HttpsError("failed-precondition", "Ask EOS refused this request.");
  }
}

/**
 * Ask EOS V1: repository intelligence only.
 *
 * This callable is intentionally narrower than the future contextual assistant. It reads no customer,
 * inventory, work-order, financial, or other operational records. The only Firestore read is the caller's
 * own users/{uid} document to enforce the V1 admin-only gate. Production is hard-disabled in code.
 */
export const askEOSRepository = onCall({ region: "us-central1", timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  if (!projectAllowsAskEOS()) {
    throw new HttpsError("failed-precondition", "Ask EOS V1 is enabled only in development and sandbox.");
  }

  const { question, contextBudget } = safeQuestion(request.data);
  const user = await getFirestore().collection("users").doc(request.auth.uid).get();
  if (user.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Ask EOS V1 is currently available to administrators only.");
  }

  const provider = repositoryProviderFromEnvironment();
  if (!provider) {
    throw new HttpsError("failed-precondition", "Ask EOS is not configured in this environment.");
  }

  const context: AIRequestContext = {
    userId: request.auth.uid,
    capabilities: [REPOSITORY_INTELLIGENCE_CAPABILITY],
    purpose: "REPOSITORY_INTELLIGENCE",
    classification: "REPOSITORY",
    traceId: randomUUID(),
  };

  try {
    return await provider.repositoryAnswer(context, {
      source: SOURCE_ID,
      question,
      contextBudget,
    });
  } catch (error) {
    return mapAIError(error);
  }
});

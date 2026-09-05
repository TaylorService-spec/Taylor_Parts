// Email Connections -- WHERE THE DEPLOYMENT'S OWN OAUTH CLIENT COMES FROM.
//
// Four values, bound through Firebase Secret Manager under these exact names and read from the
// environment the platform populates. This follows the convention the repository already set for
// server-only configuration (ai/workOrderReadinessContext.ts): the secrets are named as STRINGS on the
// functions that need them rather than declared as `defineSecret` params, because a param is a
// codebase-wide claim that makes every unrelated deploy prompt for a value it does not use.
//
// THE CLIENT ID IS NOT A CREDENTIAL and the client secret is. Both are bound the same way anyway: a split
// mechanism -- half here, half somewhere else -- is the arrangement where one half quietly stops being
// server-only and nobody notices.
//
// NOTHING IS FABRICATED. An environment with no client configured has no Microsoft or Google connection,
// and says so; there is no default, no placeholder tenant, and no fallback that silently half-works.
import { createGmailTransport } from "./gmailTransport";
import { createMicrosoftGraphTransport } from "./microsoftGraphTransport";
import { ProviderTransportError, type EmailTransportAdapter } from "./providerTransport";
import type { EmailProviderId } from "./emailProvider";

export const EMAIL_PROVIDER_SECRETS = [
  "EMAIL_MICROSOFT_CLIENT_ID",
  "EMAIL_MICROSOFT_CLIENT_SECRET",
  "EMAIL_GOOGLE_CLIENT_ID",
  "EMAIL_GOOGLE_CLIENT_SECRET",
];

/** True when this runtime can authorize the provider at all. Used to say so honestly in Administration. */
export function providerClientConfigured(provider: EmailProviderId, env: NodeJS.ProcessEnv = process.env): boolean {
  return provider === "MICROSOFT_365"
    ? Boolean(env.EMAIL_MICROSOFT_CLIENT_ID && env.EMAIL_MICROSOFT_CLIENT_SECRET)
    : Boolean(env.EMAIL_GOOGLE_CLIENT_ID && env.EMAIL_GOOGLE_CLIENT_SECRET);
}

/**
 * The one place a provider id becomes a transport. A third provider is a third case here and a third
 * adapter file -- there is no registry, no plugin loader and no dynamic import by name, because three
 * cases in a switch is smaller than any mechanism that would replace it.
 */
export function transportFor(provider: EmailProviderId, env: NodeJS.ProcessEnv = process.env): EmailTransportAdapter {
  if (provider === "MICROSOFT_365") {
    return createMicrosoftGraphTransport({
      clientId: String(env.EMAIL_MICROSOFT_CLIENT_ID ?? ""),
      clientSecret: String(env.EMAIL_MICROSOFT_CLIENT_SECRET ?? ""),
    });
  }
  if (provider === "GOOGLE_WORKSPACE") {
    return createGmailTransport({
      clientId: String(env.EMAIL_GOOGLE_CLIENT_ID ?? ""),
      clientSecret: String(env.EMAIL_GOOGLE_CLIENT_SECRET ?? ""),
    });
  }
  throw new ProviderTransportError("CONFIGURATION_INVALID", `Unsupported provider "${String(provider)}".`);
}

// Email Connections -- OAUTH STATE. Pure: no Firestore, no network, no clock of its own (time and
// randomness are arguments), so every rule below is testable directly.
//
// WHAT THE STATE PARAMETER IS FOR. The provider sends the administrator's browser back to EOS with an
// authorization code. Nothing in that redirect proves who started it, which connection it was for, or that
// it happened at all -- the browser is simply carrying whatever the redirect said. The state parameter is
// the only thing tying the returning code to a request EOS actually made, so it is generated server-side,
// stored server-side, and checked against every fact it was issued for before a single token is exchanged.
//
// THE FIVE FAILURES THIS CLOSES, and each is a rule below rather than a hope:
//   CSRF                  -- an attacker who can make the administrator's browser hit our callback cannot
//                            produce a state value we issued.
//   REPLAY                -- a state is single-use; the second presentation is refused even if the first
//                            succeeded seconds earlier.
//   CONNECTION SWAPPING   -- a code obtained for connection A cannot be redeemed against connection B: the
//                            connection id is bound INTO the stored state, not read from the callback.
//   PROVIDER MISMATCH     -- a Google code cannot be exchanged against a Microsoft connection.
//   REDIRECT INJECTION    -- the redirect URI is fixed at issue time and re-asserted at exchange; a
//                            callback naming a different one is refused rather than followed.
//
// PKCE IS INCLUDED even though this is a confidential client. The verifier never leaves the server, so an
// authorization code intercepted in the browser is worthless without it -- which is the one attack the
// client secret alone does not cover.
import { createHash } from "node:crypto";

/** How long an authorization may sit unfinished. Long enough to sign in and consent, no longer. */
export const AUTHORIZATION_STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthStateRefusal =
  | "STATE_UNKNOWN"
  | "STATE_ALREADY_USED"
  | "STATE_EXPIRED"
  | "STATE_CONNECTION_MISMATCH"
  | "STATE_PROVIDER_MISMATCH"
  | "STATE_REDIRECT_MISMATCH"
  | "STATE_ACTOR_MISMATCH"
  | "STATE_MALFORMED";

export class OAuthStateError extends Error {
  readonly code: OAuthStateRefusal;
  constructor(code: OAuthStateRefusal, message: string) {
    super(message);
    this.name = "OAuthStateError";
    this.code = code;
  }
}

export interface AuthorizationStateRecord {
  connectionId: string;
  provider: string;
  redirectUri: string;
  initiatedByUid: string;
  codeVerifier: string;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface IssuedAuthorizationState {
  /** The opaque value the provider echoes back. Never stored in the clear -- only its key is. */
  state: string;
  /** The stored lookup key: sha256 of the state. A leaked database does not yield usable states. */
  stateKey: string;
  codeChallenge: string;
  record: AuthorizationStateRecord;
}

const BASE64URL = (buffer: Buffer): string => buffer.toString("base64url");

export function hashAuthorizationState(state: string): string {
  return createHash("sha256").update(String(state ?? "")).digest("hex");
}

/**
 * Issue one state. `randomBytes` is an argument so a test can make the value deterministic without the
 * module ever choosing a weaker source: production passes node's crypto.randomBytes.
 */
export function issueAuthorizationState(
  input: { connectionId: string; provider: string; redirectUri: string; initiatedByUid: string },
  deps: { now: number; randomBytes: (size: number) => Buffer },
): IssuedAuthorizationState {
  const connectionId = String(input?.connectionId ?? "").trim();
  const provider = String(input?.provider ?? "").trim();
  const redirectUri = String(input?.redirectUri ?? "").trim();
  const initiatedByUid = String(input?.initiatedByUid ?? "").trim();
  if (!connectionId || !provider || !initiatedByUid) {
    throw new OAuthStateError("STATE_MALFORMED", "connectionId, provider and initiatedByUid are all required.");
  }
  // HTTPS ONLY, with one exception: a local development redirect. Anything else is refused here rather
  // than sent to the provider, because the redirect is where the code lands.
  if (!/^https:\/\//.test(redirectUri) && !/^http:\/\/localhost(:\d+)?\//.test(redirectUri)) {
    throw new OAuthStateError("STATE_MALFORMED", "redirectUri must be https (or a localhost development URL).");
  }

  // 32 bytes each: the state is an unguessable identifier, and the verifier is the PKCE secret.
  const state = BASE64URL(deps.randomBytes(32));
  const codeVerifier = BASE64URL(deps.randomBytes(32));
  return {
    state,
    stateKey: hashAuthorizationState(state),
    codeChallenge: BASE64URL(createHash("sha256").update(codeVerifier).digest()),
    record: {
      connectionId,
      provider,
      redirectUri,
      initiatedByUid,
      codeVerifier,
      createdAt: deps.now,
      expiresAt: deps.now + AUTHORIZATION_STATE_TTL_MS,
      consumedAt: null,
    },
  };
}

/**
 * Everything that must be true before an authorization code is exchanged. Throws the specific refusal --
 * a caller that cannot say WHY it refused cannot be tested for refusing the right thing.
 *
 * The actor check is deliberate: the administrator who finishes an authorization must be the one who
 * started it. Two administrators mid-flight at once is not an error state anybody needs, and allowing it
 * would mean one person's browser could complete a connection another person initiated.
 */
export function assertAuthorizationStateUsable(
  record: AuthorizationStateRecord | null,
  presented: { connectionId: string; provider: string; redirectUri: string; actorUid: string; now: number },
): AuthorizationStateRecord {
  if (!record) throw new OAuthStateError("STATE_UNKNOWN", "That authorization request is not recognised.");
  if (record.consumedAt !== null) throw new OAuthStateError("STATE_ALREADY_USED", "That authorization request was already completed.");
  if (presented.now > record.expiresAt) throw new OAuthStateError("STATE_EXPIRED", "That authorization request has expired. Start again.");
  if (record.connectionId !== presented.connectionId) {
    throw new OAuthStateError("STATE_CONNECTION_MISMATCH", "That authorization was started for a different connection.");
  }
  if (record.provider !== presented.provider) {
    throw new OAuthStateError("STATE_PROVIDER_MISMATCH", "That authorization was started for a different provider.");
  }
  if (record.redirectUri !== presented.redirectUri) {
    throw new OAuthStateError("STATE_REDIRECT_MISMATCH", "That authorization used a different redirect address.");
  }
  if (record.initiatedByUid !== presented.actorUid) {
    throw new OAuthStateError("STATE_ACTOR_MISMATCH", "That authorization was started by a different administrator.");
  }
  return record;
}

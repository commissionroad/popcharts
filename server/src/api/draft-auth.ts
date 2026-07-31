import { importSPKI, jwtVerify, type CryptoKey } from "jose";

import { config } from "src/config";

/**
 * How draft routes establish the calling user (ADR 0022 decision 8).
 *
 * `privy` is the production design: the app sends the Privy-issued access
 * token as a bearer credential and the server verifies it offline — ES256
 * signature against the app's verification key, `privy.io` issuer, our app id
 * as the audience, and expiry. The verified token's subject (the Privy DID)
 * is the draft owner. Configured via PRIVY_APP_ID + PRIVY_VERIFICATION_KEY
 * (the public verification key from the Privy dashboard); when both are set,
 * this mode wins everywhere, including local.
 *
 * `dev-header` trusts an `x-popcharts-draft-owner` header. It exists so a
 * wallet-only local stack works with zero Privy configuration, and it is
 * reachable ONLY on the local network — there is deliberately no env override
 * that can enable it elsewhere.
 *
 * Anything else fails closed: a deployed network without Privy configured
 * answers 501 rather than trusting any request-supplied identity.
 */
export type DraftAuthMode = "dev-header" | "disabled" | "privy";

export const DRAFT_OWNER_HEADER = "x-popcharts-draft-owner";

/** Privy access tokens are issued with this fixed issuer. */
const PRIVY_ISSUER = "privy.io";

/** Privy signs access tokens with ES256. */
const PRIVY_ALGORITHM = "ES256";

type PrivyAuthConfig = {
  appId: string;
  verificationKey: string;
};

function readPrivyConfig(
  env: Record<string, string | undefined>,
): PrivyAuthConfig | null {
  const appId = env.PRIVY_APP_ID?.trim();
  const verificationKey = env.PRIVY_VERIFICATION_KEY?.trim();

  if (!appId || !verificationKey) {
    return null;
  }

  return {
    appId,
    // Environment stores flatten PEMs to single lines with literal "\n".
    verificationKey: verificationKey.replace(/\\n/g, "\n"),
  };
}

export function draftAuthMode(
  env: Record<string, string | undefined> = process.env,
): DraftAuthMode {
  if (readPrivyConfig(env)) {
    return "privy";
  }

  return config.name === "local" ? "dev-header" : "disabled";
}

export type DraftOwnerResolution =
  | { kind: "resolved"; owner: string }
  | { kind: "unauthorized"; message: string }
  | { kind: "unsupported"; message: string };

// The imported key is cached per PEM value, so rotation via env restart picks
// up the new key while steady-state requests never re-parse the PEM.
let cachedKey: { key: CryptoKey; pem: string } | null = null;

async function verificationKeyFor(pem: string): Promise<CryptoKey> {
  if (cachedKey?.pem !== pem) {
    cachedKey = { key: await importSPKI(pem, PRIVY_ALGORITHM), pem };
  }

  return cachedKey.key;
}

/** Resolves the draft owner for a request, per the configured auth mode. */
export async function resolveDraftOwner(
  headers: Record<string, string | undefined>,
  env: Record<string, string | undefined> = process.env,
): Promise<DraftOwnerResolution> {
  const privy = readPrivyConfig(env);

  if (privy) {
    return verifyPrivyBearer(headers.authorization, privy);
  }

  if (config.name === "local") {
    const owner = headers[DRAFT_OWNER_HEADER]?.trim().toLowerCase();

    if (!owner) {
      return {
        kind: "unauthorized",
        message: "Connect a wallet to work with drafts.",
      };
    }

    return { kind: "resolved", owner };
  }

  return {
    kind: "unsupported",
    message:
      "Draft authentication is not configured — the server needs PRIVY_APP_ID and PRIVY_VERIFICATION_KEY.",
  };
}

async function verifyPrivyBearer(
  authorization: string | undefined,
  privy: PrivyAuthConfig,
): Promise<DraftOwnerResolution> {
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;

  if (!token) {
    return {
      kind: "unauthorized",
      message: "Sign in to work with drafts.",
    };
  }

  try {
    const key = await verificationKeyFor(privy.verificationKey);
    const { payload } = await jwtVerify(token, key, {
      algorithms: [PRIVY_ALGORITHM],
      audience: privy.appId,
      clockTolerance: "10s",
      issuer: PRIVY_ISSUER,
    });

    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return {
        kind: "unauthorized",
        message: "Your session could not be verified — sign in again.",
      };
    }

    return { kind: "resolved", owner: payload.sub };
  } catch {
    // Signature, audience, issuer, and expiry failures all land here. The
    // distinction is diagnostic, not actionable for the caller, and echoing
    // verifier internals to an unauthenticated client would only help forgers.
    return {
      kind: "unauthorized",
      message: "Your session could not be verified — sign in again.",
    };
  }
}

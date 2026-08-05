import { describe, expect, it } from "bun:test";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";

import {
  DRAFT_OWNER_HEADER,
  draftAuthMode,
  resolveDraftOwner,
} from "./draft-auth";

const APP_ID = "test-privy-app";
const SUBJECT = "did:privy:clkg0000000000000000000000";

// Test-setup pins NETWORK=arcTestnet, so these tests exercise the deployed
// posture: privy when configured, hard 501 otherwise, dev-header unreachable.

describe("draftAuthMode", () => {
  it("selects privy when both credentials are configured", () => {
    expect(
      draftAuthMode({
        PRIVY_APP_ID: APP_ID,
        PRIVY_VERIFICATION_KEY: "-----BEGIN PUBLIC KEY-----",
      }),
    ).toBe("privy");
  });

  it("fails closed on deployed networks without privy config", () => {
    expect(draftAuthMode({})).toBe("disabled");
    expect(draftAuthMode({ PRIVY_APP_ID: APP_ID })).toBe("disabled");
    expect(
      draftAuthMode({ PRIVY_VERIFICATION_KEY: "-----BEGIN PUBLIC KEY-----" }),
    ).toBe("disabled");
  });
});

describe("resolveDraftOwner (privy mode)", () => {
  it("resolves the token subject as the owner", async () => {
    const { env, mint } = await privyTestSetup();
    const token = await mint();

    const resolution = await resolveDraftOwner(
      { authorization: `Bearer ${token}` },
      env,
    );

    expect(resolution).toEqual({ kind: "resolved", owner: SUBJECT });
  });

  it("rejects a missing bearer token", async () => {
    const { env } = await privyTestSetup();

    const resolution = await resolveDraftOwner({}, env);

    expect(resolution).toEqual({
      kind: "unauthorized",
      message: "Sign in to work with drafts.",
    });
  });

  it("ignores the dev owner header entirely in privy mode", async () => {
    const { env } = await privyTestSetup();

    const resolution = await resolveDraftOwner(
      { [DRAFT_OWNER_HEADER]: "0xattacker" },
      env,
    );

    expect(resolution.kind).toBe("unauthorized");
  });

  it("rejects an expired token", async () => {
    const { env, mint } = await privyTestSetup();
    const token = await mint({ expiresAt: "-5m" });

    const resolution = await resolveDraftOwner(
      { authorization: `Bearer ${token}` },
      env,
    );

    expect(resolution).toEqual({
      kind: "unauthorized",
      message: "Your session could not be verified — sign in again.",
    });
  });

  it("rejects a token minted for a different app (audience)", async () => {
    const { env, mint } = await privyTestSetup();
    const token = await mint({ audience: "some-other-app" });

    const resolution = await resolveDraftOwner(
      { authorization: `Bearer ${token}` },
      env,
    );

    expect(resolution.kind).toBe("unauthorized");
  });

  it("rejects a token from a different issuer", async () => {
    const { env, mint } = await privyTestSetup();
    const token = await mint({ issuer: "not-privy.example" });

    const resolution = await resolveDraftOwner(
      { authorization: `Bearer ${token}` },
      env,
    );

    expect(resolution.kind).toBe("unauthorized");
  });

  it("rejects a token signed by a different key", async () => {
    const { env } = await privyTestSetup();
    const attacker = await generateKeyPair("ES256");
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("privy.io")
      .setAudience(APP_ID)
      .setSubject(SUBJECT)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(attacker.privateKey);

    const resolution = await resolveDraftOwner(
      { authorization: `Bearer ${forged}` },
      env,
    );

    expect(resolution.kind).toBe("unauthorized");
  });

  it("rejects a token without a subject", async () => {
    const { env, mint } = await privyTestSetup();
    const token = await mint({ subject: null });

    const resolution = await resolveDraftOwner(
      { authorization: `Bearer ${token}` },
      env,
    );

    expect(resolution).toEqual({
      kind: "unauthorized",
      message: "Your session could not be verified — sign in again.",
    });
  });

  it("rejects garbage bearer values", async () => {
    const { env } = await privyTestSetup();

    const resolution = await resolveDraftOwner(
      { authorization: "Bearer not-a-jwt" },
      env,
    );

    expect(resolution.kind).toBe("unauthorized");
  });

  it("accepts a PEM stored with escaped newlines", async () => {
    const { env, mint } = await privyTestSetup();
    const flattened = {
      ...env,
      PRIVY_VERIFICATION_KEY: env.PRIVY_VERIFICATION_KEY!.replace(/\n/g, "\\n"),
    };
    const token = await mint();

    const resolution = await resolveDraftOwner(
      { authorization: `Bearer ${token}` },
      flattened,
    );

    expect(resolution).toEqual({ kind: "resolved", owner: SUBJECT });
  });
});

describe("resolveDraftOwner (deployed network, no privy)", () => {
  it("answers unsupported and never trusts the dev header", async () => {
    const resolution = await resolveDraftOwner(
      { [DRAFT_OWNER_HEADER]: "0xattacker" },
      {},
    );

    expect(resolution).toEqual({
      kind: "unsupported",
      message:
        "Draft authentication is not configured — the server needs PRIVY_APP_ID and PRIVY_VERIFICATION_KEY.",
    });
  });
});

type MintOptions = {
  audience?: string;
  expiresAt?: string;
  issuer?: string;
  subject?: string | null;
};

async function privyTestSetup() {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const pem = await exportSPKI(publicKey);
  const env = {
    PRIVY_APP_ID: APP_ID,
    PRIVY_VERIFICATION_KEY: pem,
  };

  const mint = async ({
    audience = APP_ID,
    expiresAt = "1h",
    issuer = "privy.io",
    subject = SUBJECT,
  }: MintOptions = {}) => {
    const jwt = new SignJWT({})
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiresAt);

    if (subject !== null) {
      jwt.setSubject(subject);
    }

    return jwt.sign(privateKey);
  };

  return { env, mint };
}

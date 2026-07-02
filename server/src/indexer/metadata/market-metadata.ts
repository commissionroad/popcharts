import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { keccak256, stringToBytes } from "viem";

import { db, schema } from "src/db/client";

const MAX_METADATA_BYTES = 64 * 1024;
const METADATA_FETCH_TIMEOUT_MS = 5_000;

type MarketMetadataPayload = {
  category: string;
  createdAt: string;
  description: string;
  question: string;
  resolutionCriteria: string;
  resolutionUrl?: string;
  version: 1;
};

export async function persistMarketMetadataFromUri({
  chainId,
  metadataHash,
  metadataUri,
}: {
  chainId: number;
  metadataHash: string;
  metadataUri: string;
}) {
  const metadata = await resolveMarketMetadataFromUri({
    metadataHash,
    metadataUri,
  });
  const values = {
    category: metadata.category,
    chainId,
    description: metadata.description,
    metadataCreatedAt: metadata.createdAt,
    metadataHash,
    question: metadata.question,
    resolutionCriteria: metadata.resolutionCriteria,
    resolutionUrl: metadata.resolutionUrl ?? null,
    updatedAt: new Date(),
  };

  await db
    .insert(schema.marketMetadata)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.marketMetadata.chainId,
        schema.marketMetadata.metadataHash,
      ],
      set: values,
    });
}

export async function resolveMarketMetadataFromUri({
  metadataHash,
  metadataUri,
}: {
  metadataHash: string;
  metadataUri: string;
}): Promise<MarketMetadataPayload> {
  const text = await fetchMetadataText(metadataUri);
  const metadata = parseMarketMetadataPayload(JSON.parse(text));
  const resolvedHash = hashMarketMetadata(metadata);

  if (resolvedHash.toLowerCase() !== metadataHash.toLowerCase()) {
    throw new Error(
      `Metadata hash mismatch: event=${metadataHash} uri=${resolvedHash}`,
    );
  }

  return metadata;
}

async function fetchMetadataText(metadataUri: string): Promise<string> {
  const url = new URL(metadataUri);

  if (url.protocol === "data:") {
    return readDataUriText(metadataUri);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported metadata URI protocol: ${url.protocol}`);
  }

  await assertSafeHttpUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    METADATA_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error(
        "Metadata URI redirects are not followed by the indexer.",
      );
    }
    if (!response.ok) {
      throw new Error(`Metadata URI returned HTTP ${response.status}.`);
    }

    return readBoundedResponseText(response);
  } finally {
    clearTimeout(timeout);
  }
}

async function assertSafeHttpUrl(url: URL) {
  if (url.username || url.password) {
    throw new Error("Metadata URI credentials are not allowed.");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Metadata URI cannot target localhost.");
  }

  const ipVersion = isIP(hostname);
  if (ipVersion !== 0) {
    if (isPrivateIp(hostname)) {
      throw new Error("Metadata URI cannot target private IP ranges.");
    }
    return;
  }

  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0) {
    throw new Error("Metadata URI host did not resolve.");
  }

  if (addresses.some((address) => isPrivateIp(address.address))) {
    throw new Error("Metadata URI host resolves to a private IP range.");
  }
}

function readDataUriText(metadataUri: string) {
  const commaIndex = metadataUri.indexOf(",");

  if (commaIndex === -1) {
    throw new Error("Metadata data URI is missing a payload.");
  }

  const metadata = metadataUri.slice(0, commaIndex);
  const payload = metadataUri.slice(commaIndex + 1);
  const isBase64 = metadata
    .split(";")
    .some((part) => part.toLowerCase() === "base64");
  const text = isBase64
    ? Buffer.from(payload, "base64").toString("utf8")
    : decodeURIComponent(payload);

  if (Buffer.byteLength(text, "utf8") > MAX_METADATA_BYTES) {
    throw new Error("Metadata payload exceeds the indexer byte limit.");
  }

  return text;
}

async function readBoundedResponseText(response: Response) {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_METADATA_BYTES) {
    throw new Error("Metadata response exceeds the indexer byte limit.");
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > MAX_METADATA_BYTES) {
      throw new Error("Metadata response exceeds the indexer byte limit.");
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function parseMarketMetadataPayload(value: unknown): MarketMetadataPayload {
  if (!isRecord(value)) {
    throw new Error("Metadata URI must resolve to a JSON object.");
  }
  if (value.version !== 1) {
    throw new Error("Metadata version must be 1.");
  }

  const metadata: MarketMetadataPayload = {
    category: readNonEmptyString(value, "category"),
    createdAt: readNonEmptyString(value, "createdAt"),
    description: readString(value, "description"),
    question: readNonEmptyString(value, "question"),
    resolutionCriteria: readNonEmptyString(value, "resolutionCriteria"),
    version: 1,
  };

  if (value.resolutionUrl !== undefined) {
    metadata.resolutionUrl = readString(value, "resolutionUrl");
  }

  return metadata;
}

function hashMarketMetadata(metadata: MarketMetadataPayload) {
  return keccak256(stringToBytes(serializeMarketMetadata(metadata)));
}

function serializeMarketMetadata(metadata: MarketMetadataPayload) {
  const ordered: Record<string, string | number> = {
    version: metadata.version,
    question: metadata.question,
    description: metadata.description,
    category: metadata.category,
    resolutionCriteria: metadata.resolutionCriteria,
  };

  if (metadata.resolutionUrl) {
    ordered.resolutionUrl = metadata.resolutionUrl;
  }

  ordered.createdAt = metadata.createdAt;

  return JSON.stringify(ordered);
}

function readNonEmptyString(
  value: Record<string, unknown>,
  field: string,
): string {
  const fieldValue = readString(value, field);

  if (!fieldValue.trim()) {
    throw new Error(`Metadata ${field} is required.`);
  }

  return fieldValue;
}

function readString(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];

  if (typeof fieldValue !== "string") {
    throw new Error(`Metadata ${field} must be a string.`);
  }

  return fieldValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPrivateIp(address: string) {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length));
  }

  if (normalized.includes(":")) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return isPrivateIpv4(normalized);
}

function isPrivateIpv4(address: string) {
  const octets = address.split(".").map((part) => Number(part));

  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }

  const [first, second] = octets;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

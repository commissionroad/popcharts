import { parseExplorerJson, type ExplorerApiResponse } from "../json/parseExplorerJson.js";

/**
 * Fetches and parses JSON from a block explorer endpoint.
 */
export async function getExplorerJson({
  explorerName,
  url,
}: {
  explorerName: string;
  url: string | URL;
}): Promise<ExplorerApiResponse> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${explorerName} returned HTTP ${response.status}: ${text}`);
  }

  return parseExplorerJson({ label: explorerName, text });
}

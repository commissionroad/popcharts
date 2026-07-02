import { parseExplorerJson, type ExplorerApiResponse } from "../json/parseExplorerJson.js";

/**
 * Posts form data to an explorer endpoint and parses the JSON response.
 */
export async function postExplorerForm({
  explorerName,
  form,
  url,
}: {
  explorerName: string;
  form: FormData;
  url: string;
}): Promise<ExplorerApiResponse> {
  const response = await fetch(url, {
    method: "POST",
    body: form,
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${explorerName} returned HTTP ${response.status}: ${text}`);
  }

  return parseExplorerJson({ label: explorerName, text });
}

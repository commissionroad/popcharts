/** True when a GET of the URL returns a 2xx response; throws on network error. */
export async function urlOk(url: string): Promise<boolean> {
  const response = await fetch(url);
  return response.ok;
}

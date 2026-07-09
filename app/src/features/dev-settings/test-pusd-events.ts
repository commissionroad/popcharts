export const TEST_PUSD_MINTED_EVENT = "popcharts:test-pusd-minted";

export function dispatchTestPusdMinted() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(TEST_PUSD_MINTED_EVENT));
}

export function subscribeToTestPusdMinted(onMinted: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener(TEST_PUSD_MINTED_EVENT, onMinted);

  return () => window.removeEventListener(TEST_PUSD_MINTED_EVENT, onMinted);
}

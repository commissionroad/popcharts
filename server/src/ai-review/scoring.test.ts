import { describe, expect, it } from "bun:test";

import { sourceTierForDomain } from "./scoring";

describe("sourceTierForDomain", () => {
  it("classifies user-generated and satirical domains as low-trust sources", () => {
    expect(sourceTierForDomain("facebook.com")).toBe("ugc");
    expect(sourceTierForDomain("www.facebook.com")).toBe("ugc");
    expect(sourceTierForDomain("theonion.com")).toBe("suspicious");
    expect(sourceTierForDomain("www.theonion.com")).toBe("suspicious");
  });
});

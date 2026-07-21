import { describe, expect, it } from "vitest";
import { normalizeServerUrl } from "../src/options/server";

describe("normalizeServerUrl", () => {
  it("adds https and strips paths", () => {
    expect(normalizeServerUrl("example.com/path")).toBe("https://example.com");
  });

  it("preserves an explicit local http origin", () => {
    expect(normalizeServerUrl("http://127.0.0.1:8090/admin")).toBe("http://127.0.0.1:8090");
  });
});

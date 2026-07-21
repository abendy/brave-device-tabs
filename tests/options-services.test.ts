import { describe, expect, it, vi } from "vitest";
import { optionsServices } from "../src/options/options-services";

describe("optionsServices", () => {
  it("requests host permission synchronously before login", async () => {
    const permission = deferred<boolean>();
    const request = vi.fn(() => permission.promise);
    const set = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ token: "pocketbase-token" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("chrome", {
      permissions: { request },
      storage: { local: { set } },
    });

    const connection = optionsServices.connect(
      "https://links.example.com",
      "person@example.com",
      "secret",
    );

    expect(request).toHaveBeenCalledWith({ origins: ["https://links.example.com/*"] });
    expect(fetchMock).not.toHaveBeenCalled();
    permission.resolve(true);
    await connection;

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({
      pocketbaseServerUrl: "https://links.example.com",
      pocketbaseToken: "pocketbase-token",
    });
  });
});

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolver: ((value: Value) => void) | null = null;
  const promise = new Promise<Value>((resolve) => {
    resolver = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (!resolver) {
        throw new Error("Deferred resolver is unavailable.");
      }
      resolver(value);
    },
  };
}

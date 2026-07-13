import { describe, expect, test } from "vitest";
import { isLoopbackUrl } from "./tauriLocalFetch";

describe("tauri local fetch helpers", () => {
  test("allows loopback HTTP URLs", () => {
    expect(isLoopbackUrl("http://localhost:1234/v1/models")).toBe(true);
    expect(isLoopbackUrl("http://127.0.0.1:1234/v1/models")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:1234/v1/models")).toBe(true);
  });

  test("rejects non-loopback and non-HTTP URLs", () => {
    expect(isLoopbackUrl("https://localhost:1234/v1/models")).toBe(false);
    expect(isLoopbackUrl("http://192.168.1.10:1234/v1/models")).toBe(false);
    expect(isLoopbackUrl("https://api.openai.com/v1/models")).toBe(false);
  });
});

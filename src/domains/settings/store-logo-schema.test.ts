import { describe, expect, it } from "vitest";
import { parseStoreLogo, STORE_LOGO_MAX_LENGTH } from "./store-logo-schema";

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("parseStoreLogo", () => {
  it("accepts a PNG data URL", () => {
    expect(parseStoreLogo(ONE_PIXEL_PNG)).toEqual({ ok: true, value: ONE_PIXEL_PNG });
  });

  it("treats empty string and null as 'no logo'", () => {
    expect(parseStoreLogo("")).toEqual({ ok: true, value: "" });
    expect(parseStoreLogo(null)).toEqual({ ok: true, value: "" });
  });

  it("rejects non-PNG data URLs and remote URLs", () => {
    expect(parseStoreLogo("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==").ok).toBe(false);
    expect(parseStoreLogo("https://example.com/logo.png").ok).toBe(false);
    expect(parseStoreLogo("data:image/svg+xml;base64,PHN2Zz4=").ok).toBe(false);
  });

  it("rejects a PNG prefix whose payload is not base64", () => {
    expect(parseStoreLogo(`${ONE_PIXEL_PNG}<script>`).ok).toBe(false);
  });

  it("rejects a declared PNG without the PNG file signature", () => {
    expect(parseStoreLogo("data:image/png;base64,AAAAAAAAAAAA").ok).toBe(false);
  });

  it("rejects logos over the size limit", () => {
    const oversized = ONE_PIXEL_PNG.slice(0, -2) + "A".repeat(STORE_LOGO_MAX_LENGTH);
    const result = parseStoreLogo(oversized);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/muito grande/);
  });

  it("rejects non-string values", () => {
    expect(parseStoreLogo(123).ok).toBe(false);
    expect(parseStoreLogo({}).ok).toBe(false);
  });
});

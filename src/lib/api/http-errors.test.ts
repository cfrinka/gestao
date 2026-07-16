import { describe, expect, it } from "vitest";
import { HttpError, toHttpError } from "./http-errors";

describe("HttpError", () => {
  it("stores statusCode, message and defaults exposeMessage to true", () => {
    const error = new HttpError(400, "Bad request");
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe("Bad request");
    expect(error.exposeMessage).toBe(true);
    expect(error.name).toBe("HttpError");
  });

  it("allows exposeMessage to be set to false", () => {
    const error = new HttpError(500, "Internal detail", false);
    expect(error.exposeMessage).toBe(false);
  });
});

describe("toHttpError", () => {
  it("returns the same instance when already an HttpError", () => {
    const original = new HttpError(404, "Not found");
    expect(toHttpError(original)).toBe(original);
  });

  it("wraps a plain Error into a 500 HttpError using its message", () => {
    const wrapped = toHttpError(new Error("boom"));
    expect(wrapped).toBeInstanceOf(HttpError);
    expect(wrapped.statusCode).toBe(500);
    expect(wrapped.message).toBe("boom");
    expect(wrapped.exposeMessage).toBe(true);
  });

  it("wraps a non-Error value into a generic 500 HttpError", () => {
    const wrapped = toHttpError("some string thrown");
    expect(wrapped.statusCode).toBe(500);
    expect(wrapped.message).toBe("Internal server error");
  });
});

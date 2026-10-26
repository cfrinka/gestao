import { describe, expect, it } from "vitest";
import { formatPhone, isValidPhone, nationalPhone, whatsappNumber } from "./phone";

describe("phone", () => {
  it("reads the ways a number is typed at the counter", () => {
    expect(nationalPhone("(11) 98765-4321")).toBe("11987654321");
    expect(nationalPhone("+55 21 99999-0000")).toBe("21999990000");
    expect(nationalPhone("011 3333-4444")).toBe("1133334444");
    expect(nationalPhone("55 99999-0000")).toBe("55999990000"); // area code 55, not the country code
  });

  it("refuses what cannot be dialled", () => {
    expect(isValidPhone("")).toBe(false);
    expect(isValidPhone("123")).toBe(false);
    expect(isValidPhone("98765-4321")).toBe(false); // no area code
    expect(isValidPhone("(10) 98765-4321")).toBe(false); // no area code has a zero
    expect(isValidPhone("(11) 88765-4321")).toBe(false); // 11 digits must be a mobile
  });

  it("formats valid numbers and leaves the rest as typed", () => {
    expect(formatPhone("11987654321")).toBe("(11) 98765-4321");
    expect(formatPhone("+55 11 3333-4444")).toBe("(11) 3333-4444");
    expect(formatPhone("  ramal 12 ")).toBe("ramal 12");
  });

  it("builds the WhatsApp number", () => {
    expect(whatsappNumber("11 3333-4444")).toBe("551133334444");
    expect(whatsappNumber("+55 (21) 99999-0000")).toBe("5521999990000");
    expect(whatsappNumber("123")).toBeNull();
    expect(whatsappNumber(undefined)).toBeNull();
  });
});

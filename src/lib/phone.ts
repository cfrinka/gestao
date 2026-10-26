/**
 * Brazilian phone numbers as typed at the counter: "(11) 98765-4321", "11987654321",
 * "+55 11 98765-4321", "011 3333-4444"… all mean the same number.
 */

/** Area code + number (10 digits for a landline, 11 for a mobile), or null when it is not a usable number. */
export function nationalPhone(value: unknown): string | null {
  let digits = String(value ?? "").replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  } else {
    digits = digits.replace(/^0+/, "");
  }
  if (digits.length !== 10 && digits.length !== 11) return null;
  // Area codes run from 11 to 99 and have no zero; a mobile number starts with 9.
  if (digits[0] === "0" || digits[1] === "0") return null;
  if (digits.length === 11 && digits[2] !== "9") return null;
  return digits;
}

export function isValidPhone(value: unknown): boolean {
  return nationalPhone(value) !== null;
}

/** "(11) 98765-4321" / "(11) 3333-4444"; anything that is not a valid number comes back trimmed. */
export function formatPhone(value: unknown): string {
  const digits = nationalPhone(value);
  if (!digits) return String(value ?? "").trim();
  const area = digits.slice(0, 2);
  const number = digits.slice(2);
  const split = number.length - 4;
  return `(${area}) ${number.slice(0, split)}-${number.slice(split)}`;
}

/** wa.me number (country code + area code + number), when the phone is a valid Brazilian number. */
export function whatsappNumber(value: unknown): string | null {
  const digits = nationalPhone(value);
  return digits ? `55${digits}` : null;
}

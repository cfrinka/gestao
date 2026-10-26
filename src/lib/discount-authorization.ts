import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

const GRANT_TTL_MS = 5 * 60 * 1000;
const COLLECTION = "discountAuthorizations";

/**
 * What an administrator's password was typed for: a cashier discount above the cap, or a fiado
 * sale the store's fiado rules would refuse. Each has its own grant, so one never uses up the other.
 */
export type AuthorizationPurpose = "discount" | "fiado";

function grantRef(userId: string, purpose: AuthorizationPurpose) {
  // Discount grants keep the document id they always had.
  return adminDb.collection(COLLECTION).doc(purpose === "discount" ? userId : `${userId}:${purpose}`);
}

/**
 * Grants a one-time, short-lived authorization for `userId` (exceed the cashier discount cap, or
 * sell fiado past the store's rules), issued after a successful admin-password verification. It
 * is consumed exactly once by the next checkout that actually needs it.
 */
export async function grantDiscountAuthorization(userId: string, purpose: AuthorizationPurpose = "discount"): Promise<void> {
  await grantRef(userId, purpose).set({ expiresAt: Timestamp.fromDate(new Date(Date.now() + GRANT_TTL_MS)) });
}

/**
 * Atomically checks for and consumes a valid, unexpired grant for `userId`. Returns true only
 * if a live grant existed — the grant is deleted either way so it can never be reused, and an
 * expired grant is cleaned up without authorizing anything.
 */
export async function consumeDiscountAuthorization(userId: string, purpose: AuthorizationPurpose = "discount"): Promise<boolean> {
  const ref = grantRef(userId, purpose);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;

    tx.delete(ref);

    const expiresAt = snap.data()?.expiresAt as Timestamp | undefined;
    if (!expiresAt || expiresAt.toDate().getTime() < Date.now()) {
      return false;
    }
    return true;
  });
}

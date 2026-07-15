import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

const GRANT_TTL_MS = 5 * 60 * 1000;
const COLLECTION = "discountAuthorizations";

/**
 * Grants a one-time, short-lived authorization for `userId` to exceed the cashier discount
 * cap, issued after a successful admin-password verification. This is consumed exactly once
 * by the next checkout that actually needs it (see consumeDiscountAuthorization).
 */
export async function grantDiscountAuthorization(userId: string): Promise<void> {
  await adminDb
    .collection(COLLECTION)
    .doc(userId)
    .set({ expiresAt: Timestamp.fromDate(new Date(Date.now() + GRANT_TTL_MS)) });
}

/**
 * Atomically checks for and consumes a valid, unexpired grant for `userId`. Returns true only
 * if a live grant existed — the grant is deleted either way so it can never be reused, and an
 * expired grant is cleaned up without authorizing anything.
 */
export async function consumeDiscountAuthorization(userId: string): Promise<boolean> {
  const ref = adminDb.collection(COLLECTION).doc(userId);

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

import bcrypt from "bcryptjs";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

const SALT_ROUNDS = 10;
const MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPTS_COLLECTION = "adminPasswordAttempts";

function looksHashed(value: string): boolean {
  return /^\$2[aby]\$/.test(value);
}

export async function setAdminPassword(password: string): Promise<void> {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  await adminDb.collection("settings").doc("general").set(
    { adminPassword: hash, updatedAt: new Date() },
    { merge: true }
  );
}

/**
 * Verifies a candidate admin password against the stored value. Existing deployments may still
 * have a legacy plaintext password stored — if so, compare directly and transparently upgrade it
 * to a bcrypt hash on the next successful verification, so no manual password reset is required.
 */
export async function verifyAdminPassword(candidate: string): Promise<boolean> {
  const settingsRef = adminDb.collection("settings").doc("general");
  const settingsDoc = await settingsRef.get();
  const stored = settingsDoc.data()?.adminPassword as string | undefined;
  if (!stored) return false;

  if (looksHashed(stored)) {
    return bcrypt.compare(candidate, stored);
  }

  const matches = stored === candidate;
  if (matches) {
    const hash = await bcrypt.hash(candidate, SALT_ROUNDS);
    await settingsRef.set({ adminPassword: hash }, { merge: true });
  }
  return matches;
}

export async function isAdminPasswordRateLimited(actorId: string): Promise<boolean> {
  const snap = await adminDb.collection(ATTEMPTS_COLLECTION).doc(actorId).get();
  const data = snap.data();
  if (!data?.windowStart) return false;

  const windowStart = (data.windowStart as Timestamp).toDate();
  const withinWindow = Date.now() - windowStart.getTime() < LOCKOUT_WINDOW_MS;
  return withinWindow && Number(data.count || 0) >= MAX_ATTEMPTS;
}

export async function recordAdminPasswordAttempt(actorId: string, success: boolean): Promise<void> {
  const ref = adminDb.collection(ATTEMPTS_COLLECTION).doc(actorId);

  if (success) {
    await ref.delete().catch(() => {});
    return;
  }

  const snap = await ref.get();
  const data = snap.data();
  const windowStart = data?.windowStart as Timestamp | undefined;
  const withinWindow = windowStart && Date.now() - windowStart.toDate().getTime() < LOCKOUT_WINDOW_MS;

  if (withinWindow) {
    await ref.set({ count: FieldValue.increment(1) }, { merge: true });
  } else {
    await ref.set({ count: 1, windowStart: Timestamp.fromDate(new Date()) });
  }
}

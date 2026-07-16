import { Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import type { UserRecord } from "@/lib/db-types";
import { convertTimestamp } from "@/domains/shared/firestore-serializers";
import { HttpError } from "@/lib/api/http-errors";

function toUserRecord(id: string, data: FirebaseFirestore.DocumentData): UserRecord {
  return { id, ...convertTimestamp<Omit<UserRecord, "id">>(data) };
}

export async function getUsers(): Promise<UserRecord[]> {
  const snapshot = await adminDb.collection("users").orderBy("name").get();
  return snapshot.docs.map((doc) => toUserRecord(doc.id, doc.data()));
}

export async function getUser(id: string): Promise<UserRecord | null> {
  const doc = await adminDb.collection("users").doc(id).get();
  if (!doc.exists) return null;
  return toUserRecord(doc.id, doc.data()!);
}

export async function createAuthUser(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ uid: string }> {
  const firebaseUser = await adminAuth.createUser({
    email: input.email,
    password: input.password,
    displayName: input.name,
  });
  return { uid: firebaseUser.uid };
}

export async function deleteAuthUser(uid: string): Promise<void> {
  await adminAuth.deleteUser(uid);
}

export async function disableAuthUser(uid: string): Promise<void> {
  await adminAuth.updateUser(uid, { disabled: true });
}

export async function enableAuthUser(uid: string): Promise<void> {
  await adminAuth.updateUser(uid, { disabled: false });
}

export async function createUserRecord(input: {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "CASHIER";
}): Promise<UserRecord> {
  const now = new Date();
  const nowTs = Timestamp.fromDate(now);
  const data = {
    email: input.email,
    name: input.name,
    role: input.role,
    isActive: true,
    deactivatedAt: null,
    deactivatedBy: null,
    createdAt: nowTs,
    updatedAt: nowTs,
  };
  await adminDb.collection("users").doc(input.id).set(data);
  return { id: input.id, ...data, createdAt: now, updatedAt: now };
}

export async function updateUserRole(id: string, role: "ADMIN" | "CASHIER"): Promise<UserRecord> {
  const userRef = adminDb.collection("users").doc(id);
  const now = new Date();
  await userRef.update({ role, updatedAt: Timestamp.fromDate(now) });
  const doc = await userRef.get();
  if (!doc.exists) {
    throw new HttpError(404, "User not found");
  }
  return toUserRecord(doc.id, doc.data()!);
}

export async function deactivateUserRecord(id: string, actorId: string): Promise<void> {
  const now = new Date();
  await adminDb.collection("users").doc(id).update({
    isActive: false,
    deactivatedAt: Timestamp.fromDate(now),
    deactivatedBy: actorId,
    updatedAt: Timestamp.fromDate(now),
  });
}

export async function reactivateUserRecord(id: string): Promise<void> {
  const now = new Date();
  await adminDb.collection("users").doc(id).update({
    isActive: true,
    deactivatedAt: null,
    deactivatedBy: null,
    updatedAt: Timestamp.fromDate(now),
  });
}

export async function recordSyncError(input: {
  kind: string;
  userId: string;
  details: Record<string, unknown>;
}): Promise<void> {
  await adminDb.collection("syncErrors").add({
    kind: input.kind,
    userId: input.userId,
    details: input.details,
    resolved: false,
    createdAt: Timestamp.fromDate(new Date()),
  });
}

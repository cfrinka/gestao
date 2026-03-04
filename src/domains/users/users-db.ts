import { adminDb } from "@/lib/firebase-admin";
import type { UserRecord } from "@/lib/db-types";
import { convertTimestamp } from "@/domains/shared/firestore-serializers";

export async function getUsers(): Promise<UserRecord[]> {
  const snapshot = await adminDb.collection("users").orderBy("name").get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamp<Omit<UserRecord, "id">>(doc.data()),
  }));
}

export async function getUser(id: string): Promise<UserRecord | null> {
  const doc = await adminDb.collection("users").doc(id).get();
  if (!doc.exists) return null;
  return {
    id: doc.id,
    ...convertTimestamp<Omit<UserRecord, "id">>(doc.data()!),
  };
}

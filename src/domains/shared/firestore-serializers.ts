import { Timestamp } from "firebase-admin/firestore";

export function convertTimestamp<T>(data: FirebaseFirestore.DocumentData): T {
  const result = { ...data };
  for (const key in result) {
    if (result[key] instanceof Timestamp) {
      result[key] = result[key].toDate();
    }
  }
  return result as T;
}

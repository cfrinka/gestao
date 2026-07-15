import { adminDb } from "@/lib/firebase-admin";

export type IdempotencyReservation =
  | { type: "new" }
  | { type: "completed"; response: unknown }
  | { type: "in_progress" }
  | { type: "conflict" };

type IdempotencyDoc = {
  requestHash?: string;
  status?: "PROCESSING" | "COMPLETED" | "FAILED";
  response?: unknown;
  retries?: number;
};

function idempotencyRef(scope: string, ownerId: string, key: string) {
  return adminDb.collection("idempotencyKeys").doc(`${scope}:${ownerId}:${key}`);
}

/**
 * Generic Firestore-backed idempotency reservation, shared by every domain that needs
 * retry-safe writes (checkout, exchanges, and others as they're split out). This only owns
 * the reserve/complete/fail state machine against the `idempotencyKeys` collection — each
 * caller still writes its own "reserve -> do the work -> complete/fail" orchestration, since
 * "the work" itself (a Firestore transaction, a Firebase Auth call, etc.) is domain-specific.
 */
export async function reserveIdempotency(
  scope: string,
  ownerId: string,
  key: string,
  requestHash: string
): Promise<IdempotencyReservation> {
  const ref = idempotencyRef(scope, ownerId, key);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      tx.create(ref, {
        scope,
        ownerId,
        key,
        requestHash,
        status: "PROCESSING",
        retries: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { type: "new" };
    }

    const data = snap.data() as IdempotencyDoc;
    if (String(data.requestHash || "") !== requestHash) {
      return { type: "conflict" };
    }

    if (data.status === "COMPLETED") {
      return { type: "completed", response: data.response };
    }

    if (data.status === "PROCESSING") {
      return { type: "in_progress" };
    }

    tx.update(ref, {
      status: "PROCESSING",
      errorMessage: null,
      retries: Number(data.retries || 0) + 1,
      updatedAt: new Date(),
    });
    return { type: "new" };
  });
}

export async function markIdempotencyCompleted(
  scope: string,
  ownerId: string,
  key: string,
  response: unknown
): Promise<void> {
  const ref = idempotencyRef(scope, ownerId, key);
  await ref.set(
    {
      status: "COMPLETED",
      completedAt: new Date(),
      updatedAt: new Date(),
      response: JSON.parse(JSON.stringify(response)),
    },
    { merge: true }
  );
}

export async function markIdempotencyFailed(
  scope: string,
  ownerId: string,
  key: string,
  errorMessage: string
): Promise<void> {
  const ref = idempotencyRef(scope, ownerId, key);
  await ref.set(
    {
      status: "FAILED",
      errorMessage,
      failedAt: new Date(),
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

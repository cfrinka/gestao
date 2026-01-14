import { initializeApp, getApps, cert, App } from "firebase-admin/app";
import { getAuth, Auth } from "firebase-admin/auth";
import { getFirestore, Firestore } from "firebase-admin/firestore";

let app: App | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

function getApp(): App {
  if (app) return app;
  
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin SDK environment variables are not configured");
  }

  if (getApps().length === 0) {
    app = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  } else {
    app = getApps()[0];
  }
  
  return app;
}

export const adminAuth = new Proxy({} as Auth, {
  get(_, prop) {
    if (!auth) auth = getAuth(getApp());
    return (auth as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export const adminDb = new Proxy({} as Firestore, {
  get(_, prop) {
    if (!db) db = getFirestore(getApp());
    return (db as unknown as Record<string | symbol, unknown>)[prop];
  },
});

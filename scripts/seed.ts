import "dotenv/config";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
};

const app = initializeApp({
  credential: cert(serviceAccount),
});

const auth = getAuth(app);
const db = getFirestore(app);

async function main() {
  console.log("Seeding Firebase...");

  const now = new Date();

  // Create owners
  const owner1Ref = db.collection("owners").doc("owner-1");
  await owner1Ref.set({
    name: "Proprietário 1",
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  });

  const owner2Ref = db.collection("owners").doc("owner-2");
  await owner2Ref.set({
    name: "Proprietário 2",
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  });

  console.log("Created owners: Proprietário 1, Proprietário 2");

  // Create users in Firebase Auth and Firestore
  const users = [
    { email: "admin@loja.com", password: "admin123", name: "Administrador", role: "ADMIN", ownerId: null },
    { email: "proprietario1@loja.com", password: "owner123", name: "Usuário Proprietário 1", role: "OWNER", ownerId: "owner-1" },
    { email: "proprietario2@loja.com", password: "owner123", name: "Usuário Proprietário 2", role: "OWNER", ownerId: "owner-2" },
    { email: "caixa@loja.com", password: "caixa123", name: "Operador de Caixa", role: "CASHIER", ownerId: null },
  ];

  for (const user of users) {
    try {
      // Check if user already exists
      let firebaseUser;
      try {
        firebaseUser = await auth.getUserByEmail(user.email);
        console.log(`User ${user.email} already exists, updating...`);
      } catch {
        // User doesn't exist, create it
        firebaseUser = await auth.createUser({
          email: user.email,
          password: user.password,
          displayName: user.name,
        });
        console.log(`Created user: ${user.email}`);
      }

      // Create/update user document in Firestore
      await db.collection("users").doc(firebaseUser.uid).set({
        email: user.email,
        name: user.name,
        role: user.role,
        ownerId: user.ownerId,
        createdAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      });
    } catch (error) {
      console.error(`Error creating user ${user.email}:`, error);
    }
  }

  // Create products with sizes
  const defaultSizes = [
    { size: "PP", stock: 5 },
    { size: "P", stock: 10 },
    { size: "M", stock: 15 },
    { size: "G", stock: 10 },
    { size: "GG", stock: 7 },
    { size: "XG", stock: 3 },
  ];

  const products = [
    { name: "Camiseta Básica", sku: "CAM-001", ownerId: "owner-1", costPrice: 25.0, salePrice: 49.90, stock: 50, sizes: defaultSizes },
    { name: "Calça Jeans", sku: "CAL-001", ownerId: "owner-1", costPrice: 60.0, salePrice: 129.90, stock: 30, sizes: [
      { size: "PP", stock: 3 }, { size: "P", stock: 5 }, { size: "M", stock: 8 }, { size: "G", stock: 7 }, { size: "GG", stock: 5 }, { size: "XG", stock: 2 }
    ]},
    { name: "Vestido Floral", sku: "VES-001", ownerId: "owner-1", costPrice: 45.0, salePrice: 89.90, stock: 25, sizes: [
      { size: "PP", stock: 3 }, { size: "P", stock: 5 }, { size: "M", stock: 7 }, { size: "G", stock: 5 }, { size: "GG", stock: 3 }, { size: "XG", stock: 2 }
    ]},
    { name: "Shorts Esportivo", sku: "SHO-001", ownerId: "owner-1", costPrice: 20.0, salePrice: 39.90, stock: 40, sizes: defaultSizes },
    { name: "Jaqueta de Couro", sku: "JAQ-001", ownerId: "owner-2", costPrice: 150.0, salePrice: 299.90, stock: 15, sizes: [
      { size: "PP", stock: 1 }, { size: "P", stock: 2 }, { size: "M", stock: 4 }, { size: "G", stock: 4 }, { size: "GG", stock: 3 }, { size: "XG", stock: 1 }
    ]},
    { name: "Blazer Social", sku: "BLA-001", ownerId: "owner-2", costPrice: 100.0, salePrice: 199.90, stock: 20, sizes: [
      { size: "PP", stock: 2 }, { size: "P", stock: 4 }, { size: "M", stock: 5 }, { size: "G", stock: 5 }, { size: "GG", stock: 3 }, { size: "XG", stock: 1 }
    ]},
    { name: "Saia Midi", sku: "SAI-001", ownerId: "owner-2", costPrice: 35.0, salePrice: 69.90, stock: 35, sizes: [
      { size: "PP", stock: 5 }, { size: "P", stock: 7 }, { size: "M", stock: 10 }, { size: "G", stock: 7 }, { size: "GG", stock: 4 }, { size: "XG", stock: 2 }
    ]},
    { name: "Blusa de Seda", sku: "BLU-001", ownerId: "owner-2", costPrice: 55.0, salePrice: 109.90, stock: 28, sizes: [
      { size: "PP", stock: 3 }, { size: "P", stock: 5 }, { size: "M", stock: 8 }, { size: "G", stock: 6 }, { size: "GG", stock: 4 }, { size: "XG", stock: 2 }
    ]},
  ];

  for (const product of products) {
    const existingProducts = await db.collection("products").where("sku", "==", product.sku).get();
    
    if (existingProducts.empty) {
      await db.collection("products").add({
        ...product,
        createdAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      });
      console.log(`Created product: ${product.name}`);
    } else {
      // Update existing product with sizes
      const docId = existingProducts.docs[0].id;
      await db.collection("products").doc(docId).update({
        sizes: product.sizes,
        updatedAt: Timestamp.fromDate(now),
      });
      console.log(`Updated product ${product.sku} with sizes`);
    }
  }

  console.log("Seeding completed!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { Order, OrderItem } from "@/lib/db-types";
import { convertTimestamp } from "@/domains/shared/firestore-serializers";

export async function getOrders(startDate?: Date, endDate?: Date): Promise<Order[]> {
  let query: FirebaseFirestore.Query = adminDb.collection("orders").orderBy("createdAt", "desc");

  if (startDate && endDate) {
    query = adminDb
      .collection("orders")
      .where("createdAt", ">=", Timestamp.fromDate(startDate))
      .where("createdAt", "<=", Timestamp.fromDate(endDate))
      .orderBy("createdAt", "desc");
  }

  const ordersSnapshot = await query.get();
  const orders: Order[] = [];

  for (const orderDoc of ordersSnapshot.docs) {
    const orderData = convertTimestamp<Omit<Order, "id">>(orderDoc.data());

    const itemsSnapshot = await adminDb.collection("orderItems").where("orderId", "==", orderDoc.id).get();

    const items = itemsSnapshot.docs.map((itemDoc) => ({
      id: itemDoc.id,
      ...itemDoc.data(),
    })) as OrderItem[];

    orders.push({
      id: orderDoc.id,
      ...orderData,
      items,
    });
  }

  return orders;
}

import { NextRequest, NextResponse } from "next/server";
import { 
  getOpenCashRegister, 
  openCashRegister, 
  closeCashRegister, 
  getCashRegisterOrders,
  getUser 
} from "@/lib/db";
import { verifyAuth, unauthorizedResponse } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const register = await getOpenCashRegister(user.uid);
    return NextResponse.json({ register });
  } catch (error) {
    console.error("Error fetching cash register:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const body = await request.json();
    const { action, openingBalance, closingBalance } = body;

    if (action === "open") {
      const existingRegister = await getOpenCashRegister(user.uid);
      if (existingRegister) {
        return NextResponse.json({ error: "Já existe um caixa aberto" }, { status: 400 });
      }

      const userData = await getUser(user.uid);
      const userName = userData?.name || user.email;
      const register = await openCashRegister(user.uid, userName, openingBalance || 0);
      return NextResponse.json({ register }, { status: 201 });
    }

    if (action === "close") {
      const register = await getOpenCashRegister(user.uid);
      if (!register) {
        return NextResponse.json({ error: "Nenhum caixa aberto" }, { status: 400 });
      }

      const orders = await getCashRegisterOrders(register.id);
      const closedRegister = await closeCashRegister(register.id, closingBalance || 0);
      
      return NextResponse.json({ 
        register: closedRegister,
        orders,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Error with cash register:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

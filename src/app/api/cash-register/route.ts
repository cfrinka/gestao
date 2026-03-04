import { NextRequest, NextResponse } from "next/server";
import { 
  getOpenCashRegister, 
  openCashRegister, 
  closeCashRegister, 
  getCashRegisterOrders,
  getUser 
} from "@/lib/db";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ user }) => {
      const register = await getOpenCashRegister(user.uid);
      return NextResponse.json({ register });
    },
    { operationName: "CashRegister GET" }
  );
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const body = await authorizedRequest.json();
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
    },
    { operationName: "CashRegister POST" }
  );
}

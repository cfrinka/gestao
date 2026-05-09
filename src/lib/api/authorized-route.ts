import { NextRequest, NextResponse } from "next/server";
import { unauthorizedResponse, verifyAuth } from "@/lib/auth-api";
import { toHttpError } from "@/lib/api/http-errors";

type Role = "ADMIN" | "CASHIER" | "SYSTEM";

type AuthorizedUser = {
  uid: string;
  email: string;
  role: string;
  authTime?: number;
  isDemo?: boolean;
};

type HandlerContext = {
  request: NextRequest;
  user: AuthorizedUser;
};

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function withAuthorizedRoute(
  request: NextRequest,
  handler: (ctx: HandlerContext) => Promise<Response>,
  options?: {
    roles?: Role[];
    operationName?: string;
    authorize?: (request: NextRequest) => Promise<AuthorizedUser | null>;
    allowDemoWrite?: boolean;
  }
): Promise<Response> {
  try {
    const user = options?.authorize ? await options.authorize(request) : await verifyAuth(request);
    if (!user) return unauthorizedResponse();

    if (options?.roles && !options.roles.includes(user.role as Role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Block all write operations for demo users (silent no-op that returns a simulated success)
    if (user.isDemo && WRITE_METHODS.has(request.method) && !options?.allowDemoWrite) {
      return NextResponse.json(
        {
          ok: true,
          demo: true,
          message: "Conta demonstrativa: alterações não são salvas.",
        },
        { status: 200 }
      );
    }

    return await handler({ request, user });
  } catch (error) {
    const httpError = toHttpError(error);
    if (httpError.statusCode >= 500) {
      console.error(`${options?.operationName || "API route"} failed:`, error);
    }

    return NextResponse.json(
      { error: httpError.exposeMessage ? httpError.message : "Internal server error" },
      { status: httpError.statusCode }
    );
  }
}

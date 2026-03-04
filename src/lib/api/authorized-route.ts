import { NextRequest, NextResponse } from "next/server";
import { unauthorizedResponse, verifyAuth } from "@/lib/auth-api";
import { toHttpError } from "@/lib/api/http-errors";

type Role = "ADMIN" | "CASHIER" | "SYSTEM";

type AuthorizedUser = {
  uid: string;
  email: string;
  role: string;
};

type HandlerContext = {
  request: NextRequest;
  user: AuthorizedUser;
};

export async function withAuthorizedRoute(
  request: NextRequest,
  handler: (ctx: HandlerContext) => Promise<Response>,
  options?: {
    roles?: Role[];
    operationName?: string;
    authorize?: (request: NextRequest) => Promise<AuthorizedUser | null>;
  }
): Promise<Response> {
  try {
    const user = options?.authorize ? await options.authorize(request) : await verifyAuth(request);
    if (!user) return unauthorizedResponse();

    if (options?.roles && !options.roles.includes(user.role as Role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

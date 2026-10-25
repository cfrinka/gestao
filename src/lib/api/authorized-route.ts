import { NextRequest, NextResponse } from "next/server";
import { unauthorizedResponse, verifyAuth } from "@/lib/auth-api";
import { INTERNAL_ERROR_MESSAGE, toHttpError } from "@/lib/api/http-errors";
import { bumpDataVersion, cached } from "@/lib/server-cache";

type Role = "ADMIN" | "CASHIER" | "SYSTEM";

type AuthorizedUser = {
  uid: string;
  email: string;
  name: string;
  role: string;
  authTime?: number;
  isDemo?: boolean;
};

type HandlerContext = {
  request: NextRequest;
  user: AuthorizedUser;
};

/**
 * Serve this GET from the in-process cache (see server-cache.ts). The key is the URL plus,
 * per scope, nothing (same answer for everyone), the user, or the role.
 */
type CacheOption = { scope: "shared" | "user" | "role"; ttlMs?: number };

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

class UncacheableResponse {
  constructor(readonly response: Response) {}
}

async function runCachedGet(
  request: NextRequest,
  user: AuthorizedUser,
  option: CacheOption,
  run: () => Promise<Response>
): Promise<Response> {
  const who = option.scope === "user" ? `u:${user.uid}` : option.scope === "role" ? `r:${user.role}` : "all";
  const key = `get:${who}:${request.nextUrl.pathname}${request.nextUrl.search}`;

  try {
    const { status, body } = await cached(
      key,
      async () => {
        const response = await run();
        // Only a plain success is worth keeping; errors and anything else go straight through.
        if (response.status !== 200) throw new UncacheableResponse(response);
        return { status: response.status, body: await response.text() };
      },
      option.ttlMs
    );
    return new Response(body, { status, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    if (error instanceof UncacheableResponse) return error.response;
    throw error;
  }
}

export async function withAuthorizedRoute(
  request: NextRequest,
  handler: (ctx: HandlerContext) => Promise<Response>,
  options?: {
    roles?: Role[];
    operationName?: string;
    authorize?: (request: NextRequest) => Promise<AuthorizedUser | null>;
    allowDemoWrite?: boolean;
    cache?: CacheOption;
  }
): Promise<Response> {
  const isWrite = WRITE_METHODS.has(request.method);

  try {
    const user = options?.authorize ? await options.authorize(request) : await verifyAuth(request);
    if (!user) return unauthorizedResponse();

    if (options?.roles && !options.roles.includes(user.role as Role)) {
      return NextResponse.json({ error: "Seu perfil não tem permissão para esta ação." }, { status: 403 });
    }

    // Block all write operations for demo users (silent no-op that returns a simulated success)
    if (user.isDemo && isWrite && !options?.allowDemoWrite) {
      return NextResponse.json(
        {
          ok: true,
          demo: true,
          message: "Conta demonstrativa: alterações não são salvas.",
        },
        { status: 200 }
      );
    }

    // "forceRefresh" (the Atualizar button on Relatórios) always means a fresh answer.
    if (options?.cache && request.method === "GET" && !request.nextUrl.searchParams.has("forceRefresh")) {
      return await runCachedGet(request, user, options.cache, () => handler({ request, user }));
    }

    try {
      return await handler({ request, user });
    } finally {
      // Whatever a write did (or partly did before failing), cached reads from before it are
      // no longer trusted.
      if (isWrite) bumpDataVersion();
    }
  } catch (error) {
    const httpError = toHttpError(error);
    if (httpError.statusCode >= 500) {
      console.error(`${options?.operationName || "API route"} failed:`, error);
    }

    return NextResponse.json(
      { error: httpError.exposeMessage ? httpError.message : INTERNAL_ERROR_MESSAGE },
      { status: httpError.statusCode }
    );
  }
}

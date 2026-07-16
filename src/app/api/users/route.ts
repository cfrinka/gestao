import { NextRequest, NextResponse } from "next/server";
import { withAuthorizedRoute } from "@/lib/api/authorized-route";
import { UsersService } from "@/domains/users/users-service";
import { FirestoreUsersRepository } from "@/domains/users/firestore-users-repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async () => {
      const service = new UsersService(new FirestoreUsersRepository());
      const users = await service.list();
      return NextResponse.json(users);
    },
    { roles: ["ADMIN"], operationName: "Users GET" }
  );
}

export async function POST(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const body = await authorizedRequest.json();
      const service = new UsersService(new FirestoreUsersRepository());
      const user = await service.create(body);
      return NextResponse.json(user, { status: 201 });
    },
    { roles: ["ADMIN"], operationName: "Users POST" }
  );
}

export async function PUT(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest }) => {
      const body = await authorizedRequest.json();
      const service = new UsersService(new FirestoreUsersRepository());
      const user = await service.updateRole(body);
      return NextResponse.json(user);
    },
    { roles: ["ADMIN"], operationName: "Users PUT" }
  );
}

export async function DELETE(request: NextRequest) {
  return withAuthorizedRoute(
    request,
    async ({ request: authorizedRequest, user }) => {
      const { searchParams } = new URL(authorizedRequest.url);
      const id = searchParams.get("id");

      const service = new UsersService(new FirestoreUsersRepository());
      await service.deactivate({ id, actorId: user.uid });

      return NextResponse.json({ ok: true });
    },
    { roles: ["ADMIN"], operationName: "Users DELETE" }
  );
}

import { auth } from "./firebase";
import { toast } from "@/components/ui/use-toast";

let lastDemoToastAt = 0;

function maybeNotifyDemo(payload: unknown) {
  if (!payload || typeof payload !== "object") return;
  const data = payload as { demo?: boolean; message?: string };
  if (data.demo !== true) return;

  const now = Date.now();
  if (now - lastDemoToastAt < 1500) return;
  lastDemoToastAt = now;

  toast({
    title: "Modo demonstrativo",
    description: data.message || "Suas alterações não foram salvas no banco de dados.",
  });
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) {
    return { "Content-Type": "application/json" };
  }

  const token = await user.getIdToken();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function request(url: string, init: RequestInit = {}, notifyDemo = true) {
  const headers = await getAuthHeaders();

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch {
    throw new Error("Sem conexão com o servidor. Verifique a internet e tente de novo.");
  }

  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(
      (error && typeof error.error === "string" && error.error) || "Falha ao falar com o servidor. Tente de novo."
    );
  }

  const json = await res.json();
  if (notifyDemo) maybeNotifyDemo(json);
  return json;
}

export async function apiGet(url: string) {
  return request(url, {}, false);
}

export async function apiPost(url: string, data: unknown) {
  return request(url, { method: "POST", body: JSON.stringify(data) });
}

export async function apiPut(url: string, data: unknown) {
  return request(url, { method: "PUT", body: JSON.stringify(data) });
}

export async function apiDelete(url: string) {
  return request(url, { method: "DELETE" });
}

export async function apiPatch(url: string, data: unknown) {
  return request(url, { method: "PATCH", body: JSON.stringify(data) });
}

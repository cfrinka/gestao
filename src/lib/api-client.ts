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

export async function apiGet(url: string) {
  const headers = await getAuthHeaders();
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  return res.json();
}

export async function apiPost(url: string, data: unknown) {
  const headers = await getAuthHeaders();
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  const json = await res.json();
  maybeNotifyDemo(json);
  return json;
}

export async function apiPut(url: string, data: unknown) {
  const headers = await getAuthHeaders();
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  const json = await res.json();
  maybeNotifyDemo(json);
  return json;
}

export async function apiDelete(url: string) {
  const headers = await getAuthHeaders();
  const res = await fetch(url, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  const json = await res.json();
  maybeNotifyDemo(json);
  return json;
}

export async function apiPatch(url: string, data: unknown) {
  const headers = await getAuthHeaders();
  const res = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  const json = await res.json();
  maybeNotifyDemo(json);
  return json;
}

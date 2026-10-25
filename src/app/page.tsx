"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Logo } from "@/components/brand/logo";

export default function Home() {
  const { user, userData, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user || userData) {
        router.push("/dashboard");
      } else {
        router.push("/login");
      }
    }
  }, [user, userData, loading, router]);

  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-ground">
      <Logo variant="color" className="w-24" />
      <p className="text-sm text-ink-3">Carregando…</p>
    </div>
  );
}

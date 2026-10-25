"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Logo } from "@/components/brand/logo";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.push("/dashboard");
      } else {
        router.push("/login");
      }
    }
  }, [user, loading, router]);

  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-ground">
      <Logo variant="color" className="w-24" />
      <p className="text-sm text-ink-3">Carregando…</p>
    </div>
  );
}

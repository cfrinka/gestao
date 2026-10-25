"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Logo } from "@/components/brand/logo";
import { rolesForPath } from "@/components/layout/nav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, userData, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileMenuOpen]);

  if (loading) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-ground">
        <Logo variant="color" className="w-24" />
        <p className="text-sm text-ink-3">Carregando…</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // The menu hides screens a profile can't use; typing the address must not open them either
  // (they'd only show failing requests). The server enforces the same rule on every request.
  const allowedRoles = rolesForPath(pathname);
  const canOpen = !allowedRoles || !userData || allowedRoles.includes(userData.role);

  return (
    <div className="flex h-[100dvh] bg-ground">
      <Sidebar />
      {mobileMenuOpen ? (
        <>
          <button
            type="button"
            aria-label="Fechar menu"
            className="fixed inset-0 z-40 bg-ink/50 animate-in fade-in-0 duration-150 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 shadow-[12px_0_32px_-12px_rgba(40,40,40,0.4)] animate-in slide-in-from-left duration-200 md:hidden">
            <Sidebar mobile onNavigate={() => setMobileMenuOpen(false)} />
          </div>
        </>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
          {canOpen ? (
            children
          ) : (
            <div className="flex h-96 flex-col items-center justify-center gap-1 text-center">
              <p className="font-semibold text-ink">Sem permissão para esta tela</p>
              <p className="text-sm text-ink-3">Ela é de uso do administrador. Use o menu para ir a outra área.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { canAccessPath, type AppRole } from "@/lib/navigation";

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

  // Gate direct URL navigation by role: a cashier typing /users or /reports gets bounced
  // back to the dashboard. (The API routes behind these pages enforce roles server-side —
  // this just avoids showing a broken, permission-denied screen.)
  const role: AppRole | null = userData ? (userData.role === "ADMIN" ? "ADMIN" : "CASHIER") : null;
  const allowed = role ? canAccessPath(pathname, role) : true;

  useEffect(() => {
    if (!loading && user && role && !allowed) {
      router.replace("/dashboard");
    }
  }, [loading, user, role, allowed, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p>Carregando...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (role && !allowed) {
    return null;
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      {mobileMenuOpen ? (
        <>
          <button
            type="button"
            aria-label="Fechar menu"
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden">
            <Sidebar mobile onNavigate={() => setMobileMenuOpen(false)} />
          </div>
        </>
      ) : null}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

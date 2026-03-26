"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { LogOut, Menu, User } from "lucide-react";

interface HeaderProps {
  onOpenMobileMenu?: () => void;
}

export function Header({ onOpenMobileMenu }: HeaderProps) {
  const { userData, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <header className="bg-white shadow-sm border-b border-[#2A5473]/10">
      <div className="flex items-center justify-between px-4 py-4 md:px-6">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onOpenMobileMenu}
            className="md:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div>
          <h2 className="text-lg font-semibold text-[#2A5473]">
            Bem-vindo, {userData?.name || "Usuário"}
          </h2>
          <p className="text-sm text-[#355444]">
            {userData?.role === "ADMIN"
              ? "Administrador"
              : "Caixa"}
          </p>
        </div>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden sm:flex items-center gap-2 text-sm text-[#2A5473]/70">
            <User className="h-4 w-4" />
            <span>{userData?.email}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            className="border-[#BE1622] text-[#BE1622] hover:bg-[#BE1622] hover:text-white"
          >
            <LogOut className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Sair</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

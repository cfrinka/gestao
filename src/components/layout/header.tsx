"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { LogOut, User } from "lucide-react";

export function Header() {
  const { userData, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <header className="bg-white shadow-sm border-b border-[#2A5473]/10">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-[#2A5473]">
            Bem-vindo, {userData?.name || "Usuário"}
          </h2>
          <p className="text-sm text-[#355444]">
            {userData?.role === "ADMIN"
              ? "Administrador"
              : userData?.role === "OWNER"
              ? "Proprietário"
              : "Caixa"}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-[#2A5473]/70">
            <User className="h-4 w-4" />
            <span>{userData?.email}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            className="border-[#BE1622] text-[#BE1622] hover:bg-[#BE1622] hover:text-white"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sair
          </Button>
        </div>
      </div>
    </header>
  );
}

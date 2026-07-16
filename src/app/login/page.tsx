"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { ShieldCheck, Store, UserRound } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

function DemoLoginCard() {
  const [loadingRole, setLoadingRole] = useState<"ADMIN" | "CASHIER" | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  const { enterDemo } = useAuth();

  const handleEnter = async (role: "ADMIN" | "CASHIER") => {
    setLoadingRole(role);
    try {
      await enterDemo?.(role);
      router.push("/dashboard");
    } catch {
      toast({
        title: "Erro ao entrar no modo demonstração",
        description: "Tente novamente em alguns instantes.",
        variant: "destructive",
      });
    } finally {
      setLoadingRole(null);
    }
  };

  return (
    <Card className="w-full max-w-md mx-4 shadow-2xl">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-[#2A5473] rounded-full">
            <Store className="h-8 w-8 text-white" />
          </div>
        </div>
        <CardTitle className="text-2xl text-[#2A5473]">Gestão Loja — Demonstração</CardTitle>
        <CardDescription>
          Ambiente de demonstração com dados fictícios. Escolha um papel para explorar o sistema —
          nenhuma alteração afeta dados reais.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          type="button"
          className="w-full justify-start gap-2"
          disabled={loadingRole !== null}
          onClick={() => handleEnter("ADMIN")}
        >
          <ShieldCheck className="h-4 w-4" />
          {loadingRole === "ADMIN" ? "Entrando..." : "Entrar como Admin (demo)"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2"
          disabled={loadingRole !== null}
          onClick={() => handleEnter("CASHIER")}
        >
          <UserRound className="h-4 w-4" />
          {loadingRole === "CASHIER" ? "Entrando..." : "Entrar como Caixa (demo)"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const { signIn } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await signIn(email, password);
      router.push("/dashboard");
    } catch {
      toast({
        title: "Erro ao fazer login",
        description: "Email ou senha inválidos",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (DEMO_MODE) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#2A5473] to-[#355444]">
        <DemoLoginCard />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#2A5473] to-[#355444]">
      <Card className="w-full max-w-md mx-4 shadow-2xl">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-[#2A5473] rounded-full">
              <Store className="h-8 w-8 text-white" />
            </div>
          </div>
          <CardTitle className="text-2xl text-[#2A5473]">Gestão Loja</CardTitle>
          <CardDescription>
            Entre com suas credenciais para acessar o sistema
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

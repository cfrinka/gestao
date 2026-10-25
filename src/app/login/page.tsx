"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Logo } from "@/components/brand/logo";
import { useAuth } from "@/contexts/auth-context";

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
        title: "Não foi possível entrar",
        description: "E-mail ou senha incorretos. Confira e tente de novo.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-ground px-4 py-10">
      {/* The hang tag: pointed top, eyelet punched through, card stock below. */}
      <div className="relative w-full max-w-[380px] drop-shadow-[0_18px_28px_rgba(40,40,40,0.16)]">
        <div className="bg-paper [clip-path:polygon(0_44px,50%_0,100%_44px,100%_100%,0_100%)]">
          <div className="flex flex-col items-center px-8 pb-8 pt-16 sm:px-10">
            <Logo variant="color" className="w-[176px]" />
            <h1 className="mt-6 font-tag text-sm font-bold uppercase tracking-[0.18em] text-ink-2">
              Gestão da loja
            </h1>

            <form onSubmit={handleSubmit} className="mt-7 w-full space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11"
                  required
                />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? "Entrando…" : "Entrar"}
              </Button>
            </form>
          </div>
          <div className="border-t-[1.5px] border-dashed border-rule-strong px-8 py-3 text-center text-xs text-ink-3">
            Uso interno da equipe Benê Brasil
          </div>
        </div>
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-[22px] h-4 w-4 -translate-x-1/2 rounded-full border-[1.5px] border-rule-strong bg-ground"
        />
      </div>
    </div>
  );
}

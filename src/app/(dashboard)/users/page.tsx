"use client";

import { useState, useEffect, useCallback } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { Eye, EyeOff, Plus, UserCog } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive?: boolean;
  deactivatedAt?: string | null;
  createdAt: string;
}

export default function UsersPage() {
  const { userData } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    name: "",
    role: "CASHIER",
  });
  const [roleEdits, setRoleEdits] = useState<Record<string, string>>({});
  const [provisioningDemo, setProvisioningDemo] = useState(false);

  const handleProvisionDemo = async () => {
    try {
      setProvisioningDemo(true);
      const result = await apiPost("/api/users/demo", {});
      toast({
        title: "Usuário demonstrativo pronto",
        description: result?.message || "teste@teste.com / Teste@123",
      });
      fetchUsers();
    } catch (error) {
      toast({
        title: "Erro ao provisionar usuário demonstrativo",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setProvisioningDemo(false);
    }
  };

  const fetchUsers = useCallback(async () => {
    try {
      const data = await apiGet("/api/users");
      const normalizedUsers = Array.isArray(data) ? data : [];
      setUsers(normalizedUsers);
      setRoleEdits(
        normalizedUsers.reduce<Record<string, string>>((acc, user) => {
          acc[user.id] = user.role;
          return acc;
        }, {})
      );
    } catch {
      toast({ title: "Erro ao carregar usuários", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const handleDeactivateUser = async (user: User) => {
    if (user.isActive === false) return;

    try {
      setDeletingUserId(user.id);
      await apiDelete(`/api/users?id=${encodeURIComponent(user.id)}`);
      const now = new Date().toISOString();
      setUsers((current) =>
        current.map((row) =>
          row.id === user.id
            ? {
                ...row,
                isActive: false,
                deactivatedAt: now,
              }
            : row
        )
      );
      toast({ title: "Usuário desativado com sucesso" });
    } catch (error) {
      toast({
        title: "Erro ao desativar usuário",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setDeletingUserId(null);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await apiPost("/api/users", { ...formData, idempotencyKey: crypto.randomUUID() });

      toast({ title: "Usuário criado!" });
      setDialogOpen(false);
      setShowPassword(false);
      setFormData({
        email: "",
        password: "",
        name: "",
        role: "CASHIER",
      });
      fetchUsers();
    } catch (error) {
      toast({
        title: "Erro ao criar usuário",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case "ADMIN":
        return "Administrador";
      case "CASHIER":
        return "Caixa";
      default:
        return role;
    }
  };

  const handleUpdateRole = async (user: User) => {
    if (user.isActive === false) return;
    const newRole = roleEdits[user.id];
    if (!newRole || newRole === user.role) return;

    try {
      setUpdatingUserId(user.id);
      await apiPut("/api/users", { id: user.id, role: newRole });
      setUsers((current) => current.map((row) => (row.id === user.id ? { ...row, role: newRole } : row)));
      toast({ title: "Função atualizada com sucesso" });
    } catch (error) {
      toast({
        title: "Erro ao atualizar função",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
      setRoleEdits((current) => ({ ...current, [user.id]: user.role }));
    } finally {
      setUpdatingUserId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Usuários"
        meta={!loading ? <span><b className="font-semibold text-ink">{users.length}</b> com acesso ao sistema</span> : null}
        actions={
        <>
        <Button
          variant="outline"
          size="sm"
          onClick={handleProvisionDemo}
          disabled={provisioningDemo}
          title="Cria ou redefine a conta teste@teste.com (Teste@123) como usuário demonstrativo"
        >
          <UserCog className="h-4 w-4" aria-hidden="true" />
          {provisioningDemo ? "Preparando…" : "Preparar conta demo"}
        </Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Novo usuário
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo usuário</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 px-3 text-ink-2 hover:text-ink"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Função</Label>
                <Select
                  value={formData.role}
                  onValueChange={(value) =>
                    setFormData({ ...formData, role: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADMIN">Administrador</SelectItem>
                    <SelectItem value="CASHIER">Caixa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 border-t border-rule pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDialogOpen(false);
                    setShowPassword(false);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit">Criar usuário</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        </>
        }
      />

      <div className="border border-rule bg-paper">
          {loading ? (
            <div className="space-y-2 p-4" aria-hidden="true">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 animate-pulse bg-sub" />)}</div>
          ) : users.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-ink-3">
              Nenhum usuário cadastrado
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Função</TableHead>
                  <TableHead>Cadastrado em</TableHead>
                  <TableHead className="pr-4 text-right"><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="pl-4 font-semibold">{user.name}</TableCell>
                    <TableCell className="text-ink-2">{user.email}</TableCell>
                    <TableCell>
                      {user.isActive === false ? (
                        <Badge variant="destructive">Inativo</Badge>
                      ) : (
                        <Badge variant="positive">Ativo</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={roleEdits[user.id] || user.role}
                        disabled={user.isActive === false}
                        onValueChange={(value) =>
                          setRoleEdits((current) => ({ ...current, [user.id]: value }))
                        }
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue>{getRoleLabel(roleEdits[user.id] || user.role)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ADMIN">Administrador</SelectItem>
                          <SelectItem value="CASHIER">Caixa</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {new Date(user.createdAt).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell className="whitespace-nowrap pr-4 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          updatingUserId === user.id ||
                          deletingUserId === user.id ||
                          user.isActive === false ||
                          !roleEdits[user.id] ||
                          roleEdits[user.id] === user.role
                        }
                        onClick={() => handleUpdateRole(user)}
                      >
                        {updatingUserId === user.id ? "Salvando…" : "Salvar função"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-2 border-vermelho text-vermelho hover:bg-vermelho-tint"
                        disabled={
                          deletingUserId === user.id ||
                          updatingUserId === user.id ||
                          user.isActive === false ||
                          userData?.id === user.id
                        }
                        onClick={() => handleDeactivateUser(user)}
                      >
                        {deletingUserId === user.id ? "Desativando…" : "Desativar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </div>
    </div>
  );
}

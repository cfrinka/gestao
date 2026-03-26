"use client";

import { useState, useEffect } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Eye, EyeOff, Plus, Settings } from "lucide-react";

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

  const fetchUsers = async () => {
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
  };

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
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await apiPost("/api/users", formData);

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Usuários</h1>
          <p className="text-gray-500">Gerencie os usuários do sistema</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Novo Usuário
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo Usuário</DialogTitle>
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
                <Label htmlFor="email">Email</Label>
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
                    className="absolute inset-y-0 right-0 px-3 text-gray-500 hover:text-gray-700"
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
              <div className="flex justify-end gap-2">
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
                <Button type="submit">Criar</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Lista de Usuários
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-4">Carregando...</p>
          ) : users.length === 0 ? (
            <p className="text-center py-4 text-gray-500">
              Nenhum usuário cadastrado
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Função</TableHead>
                  <TableHead>Cadastrado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      {user.isActive === false ? (
                        <span className="text-xs font-medium text-red-600">Inativo</span>
                      ) : (
                        <span className="text-xs font-medium text-green-600">Ativo</span>
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
                    <TableCell className="text-right">
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
                        {updatingUserId === user.id ? "Salvando..." : "Salvar função"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-2 border-red-300 text-red-700 hover:bg-red-50"
                        disabled={
                          deletingUserId === user.id ||
                          updatingUserId === user.id ||
                          user.isActive === false ||
                          userData?.id === user.id
                        }
                        onClick={() => handleDeactivateUser(user)}
                      >
                        {deletingUserId === user.id ? "Desativando..." : "Desativar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useToast } from "@/components/ui/use-toast";
import { Plus, Pencil, Trash2, Truck } from "lucide-react";

type PaymentMethod = "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX" | "FIADO";

type Supplier = {
  id: string;
  name: string;
  instagram?: string;
  whatsapp?: string;
  website?: string;
  observations?: string;
  acceptedPaymentMethods: PaymentMethod[];
};

const ALL_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "DEBITO", label: "Débito" },
  { value: "CREDITO", label: "Crédito" },
  { value: "PIX", label: "PIX" },
  { value: "FIADO", label: "Fiado" },
];

export default function SuppliersPage() {
  const { userData } = useAuth();
  const { toast } = useToast();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    instagram: "",
    whatsapp: "",
    website: "",
    observations: "",
    acceptedPaymentMethods: [] as PaymentMethod[],
  });

  const fetchSuppliers = async () => {
    try {
      const data = await apiGet("/api/suppliers");
      setSuppliers(Array.isArray(data) ? data : []);
    } catch (error) {
      toast({ title: "Erro ao carregar fornecedores", variant: "destructive" });
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const resetForm = () => {
    setEditingSupplier(null);
    setFormData({
      name: "",
      instagram: "",
      whatsapp: "",
      website: "",
      observations: "",
      acceptedPaymentMethods: [],
    });
  };

  const openNewDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const handleEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name || "",
      instagram: supplier.instagram || "",
      whatsapp: supplier.whatsapp || "",
      website: supplier.website || "",
      observations: supplier.observations || "",
      acceptedPaymentMethods: supplier.acceptedPaymentMethods || [],
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este fornecedor?")) return;

    try {
      await apiDelete(`/api/suppliers/${id}`);
      toast({ title: "Fornecedor excluído!" });
      fetchSuppliers();
    } catch (error) {
      toast({ title: "Erro ao excluir fornecedor", variant: "destructive" });
    }
  };

  const toggleMethod = (m: PaymentMethod) => {
    setFormData((prev) => {
      const has = prev.acceptedPaymentMethods.includes(m);
      return {
        ...prev,
        acceptedPaymentMethods: has
          ? prev.acceptedPaymentMethods.filter((x) => x !== m)
          : [...prev.acceptedPaymentMethods, m],
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast({ title: "Informe o nome", variant: "destructive" });
      return;
    }

    try {
      const payload = {
        name: formData.name.trim(),
        instagram: formData.instagram.trim(),
        whatsapp: formData.whatsapp.trim(),
        website: formData.website.trim(),
        observations: formData.observations.trim(),
        acceptedPaymentMethods: formData.acceptedPaymentMethods,
      };

      if (editingSupplier) {
        await apiPut(`/api/suppliers/${editingSupplier.id}`, payload);
        toast({ title: "Fornecedor atualizado!" });
      } else {
        await apiPost("/api/suppliers", payload);
        toast({ title: "Fornecedor criado!" });
      }

      setDialogOpen(false);
      resetForm();
      fetchSuppliers();
    } catch (error) {
      toast({
        title: "Erro",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  if (userData?.role !== "ADMIN") {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-500">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Fornecedores</h1>
          <p className="text-gray-500">Cadastre e gerencie seus fornecedores</p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNewDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Fornecedor
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingSupplier ? "Editar Fornecedor" : "Novo Fornecedor"}</DialogTitle>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Instagram</Label>
                  <Input value={formData.instagram} onChange={(e) => setFormData({ ...formData, instagram: e.target.value })} placeholder="@fornecedor" />
                </div>
                <div className="space-y-2">
                  <Label>WhatsApp</Label>
                  <Input value={formData.whatsapp} onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })} placeholder="(11) 99999-9999" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Website</Label>
                <Input value={formData.website} onChange={(e) => setFormData({ ...formData, website: e.target.value })} placeholder="https://..." />
              </div>

              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea
                  value={formData.observations}
                  onChange={(e) => setFormData({ ...formData, observations: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Formas de pagamento aceitas</Label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_METHODS.map((m) => (
                    <label key={m.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={formData.acceptedPaymentMethods.includes(m.value)}
                        onChange={() => toggleMethod(m.value)}
                      />
                      {m.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit">{editingSupplier ? "Salvar" : "Criar"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Lista de Fornecedores
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-4">Carregando...</p>
          ) : suppliers.length === 0 ? (
            <p className="text-center py-4 text-gray-500">Nenhum fornecedor cadastrado</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Instagram</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>Observações</TableHead>
                  <TableHead>Pagamentos</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.instagram || "-"}</TableCell>
                    <TableCell>{s.whatsapp || "-"}</TableCell>
                    <TableCell>{s.website || "-"}</TableCell>
                    <TableCell>{s.observations || "-"}</TableCell>
                    <TableCell>{(s.acceptedPaymentMethods || []).join(", ") || "-"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(s)} title="Editar">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(s.id)} title="Excluir">
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
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

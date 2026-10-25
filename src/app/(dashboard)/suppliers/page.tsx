"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";

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

  const fetchSuppliers = useCallback(async () => {
    try {
      const data = await apiGet("/api/suppliers");
      setSuppliers(Array.isArray(data) ? data : []);
    } catch {
      toast({ title: "Erro ao carregar fornecedores", variant: "destructive" });
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

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
    } catch {
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
        <p className="text-ink-3">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Fornecedores"
        meta={!loading ? <span><b className="font-semibold text-ink">{suppliers.length}</b> cadastrados</span> : null}
        actions={
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openNewDialog}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Novo fornecedor
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingSupplier ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sup-name">Nome</Label>
                <Input id="sup-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="sup-ig">Instagram</Label>
                  <Input id="sup-ig" value={formData.instagram} onChange={(e) => setFormData({ ...formData, instagram: e.target.value })} placeholder="@fornecedor" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sup-wa">WhatsApp</Label>
                  <Input id="sup-wa" type="tel" inputMode="tel" value={formData.whatsapp} onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })} placeholder="(11) 99999-9999" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sup-site">Site</Label>
                <Input id="sup-site" value={formData.website} onChange={(e) => setFormData({ ...formData, website: e.target.value })} placeholder="https://..." />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sup-notes">Observações</Label>
                <Textarea
                  id="sup-notes"
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
                        className="h-[18px] w-[18px] accent-[hsl(var(--denim))]"
                        checked={formData.acceptedPaymentMethods.includes(m.value)}
                        onChange={() => toggleMethod(m.value)}
                      />
                      {m.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-rule pt-4">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit">{editingSupplier ? "Salvar alterações" : "Cadastrar fornecedor"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        }
      />

      <div className="border border-rule bg-paper">
          {loading ? (
            <div className="space-y-2 p-4" aria-hidden="true">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse bg-sub" />)}</div>
          ) : suppliers.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-ink-3">Nenhum fornecedor cadastrado. Use Novo fornecedor para começar.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Nome</TableHead>
                  <TableHead>Instagram</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>Observações</TableHead>
                  <TableHead>Pagamentos</TableHead>
                  <TableHead className="pr-4 text-right"><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="pl-4 font-semibold">{s.name}</TableCell>
                    <TableCell className="text-ink-2">{s.instagram || "—"}</TableCell>
                    <TableCell className="text-ink-2">{s.whatsapp || "—"}</TableCell>
                    <TableCell className="text-ink-2">{s.website || "—"}</TableCell>
                    <TableCell className="max-w-[260px] truncate text-ink-2" title={s.observations || undefined}>{s.observations || "—"}</TableCell>
                    <TableCell className="text-ink-2">{(s.acceptedPaymentMethods || []).join(", ") || "—"}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(s)} title="Editar" aria-label={`Editar ${s.name}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="hover:bg-vermelho-tint hover:text-vermelho" onClick={() => handleDelete(s.id)} title="Excluir" aria-label={`Excluir ${s.name}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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

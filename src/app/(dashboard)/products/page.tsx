"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api-client";
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
import { formatCurrency, generateSku } from "@/lib/utils";
import { Plus, Pencil, Trash2, Package } from "lucide-react";

interface ProductSize {
  size: string;
  stock: number;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  plusSized?: boolean;
  costPrice: number;
  salePrice: number;
  stock: number;
  sizes: ProductSize[];
}

const DEFAULT_SIZES = ["PP", "P", "M", "G", "GG", "XG"];
const PLUS_SIZES = ["GG", "XG", "G1", "G2", "G3"];
const MARKUP_MULTIPLIER = 2.8;

export default function ProductsPage() {
  const { userData } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    sku: "",
    plusSized: false,
    costPrice: "",
    salePrice: "",
    stock: "0",
    sizes: DEFAULT_SIZES.map(size => ({ size, stock: 0 })),
  });

  useEffect(() => {
    if (editingProduct) return;
    const expected = formData.plusSized ? PLUS_SIZES : DEFAULT_SIZES;
    const sameShape =
      Array.isArray(formData.sizes) &&
      formData.sizes.length === expected.length &&
      formData.sizes.every((s, i) => s.size === expected[i]);
    if (sameShape) return;

    setFormData((prev) => ({
      ...prev,
      sizes: expected.map((size) => ({ size, stock: 0 })),
      stock: "0",
    }));
  }, [formData.plusSized, editingProduct]);

  const fetchProducts = async () => {
    try {
      const data = await apiGet("/api/products");
      if (Array.isArray(data)) {
        setProducts(data);
      } else {
        console.error("Error fetching products:", data);
        setProducts([]);
      }
    } catch (error) {
      toast({ title: "Erro ao carregar produtos", variant: "destructive" });
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const migratePlusSizeSizes = async () => {
    if (!confirm('Isso vai ajustar os tamanhos para produtos Plus Size (P→G1, M→G2, G→G3). Continuar?')) return;

    try {
      const result = await apiPost("/api/admin/migrate-plus-size-sizes", { apply: true, limit: 500 });
      toast({
        title: "Ajuste concluído",
        description: `Atualizados: ${result?.updated ?? 0} | Escaneados: ${result?.scanned ?? 0}`,
      });
      fetchProducts();
    } catch (error) {
      toast({
        title: "Erro ao ajustar tamanhos Plus Size",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (editingProduct) {
        await apiPut(`/api/products/${editingProduct.id}`, formData);
      } else {
        await apiPost("/api/products", formData);
      }

      toast({
        title: editingProduct ? "Produto atualizado!" : "Produto criado!",
      });
      setDialogOpen(false);
      resetForm();
      fetchProducts();
    } catch (error) {
      toast({
        title: "Erro",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este produto?")) return;

    try {
      await apiDelete(`/api/products/${id}`);
      toast({ title: "Produto excluído!" });
      fetchProducts();
    } catch (error) {
      toast({ title: "Erro ao excluir produto", variant: "destructive" });
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      sku: product.sku,
      plusSized: product.plusSized === true,
      costPrice: product.costPrice.toString(),
      salePrice: product.salePrice.toString(),
      stock: product.stock.toString(),
      sizes: product.sizes?.length > 0 
        ? product.sizes 
        : (product.plusSized === true ? PLUS_SIZES : DEFAULT_SIZES).map(size => ({ size, stock: 0 })),
    });
    setDialogOpen(true);
  };

  const resetForm = () => {
    setEditingProduct(null);
    setFormData({
      name: "",
      sku: "",
      plusSized: false,
      costPrice: "",
      salePrice: "",
      stock: "0",
      sizes: DEFAULT_SIZES.map(size => ({ size, stock: 0 })),
    });
  };

  const updateSizeStock = (sizeIndex: number, stock: number) => {
    const newSizes = [...formData.sizes];
    newSizes[sizeIndex] = { ...newSizes[sizeIndex], stock };
    const totalStock = newSizes.reduce((sum, s) => sum + s.stock, 0);
    setFormData({ ...formData, sizes: newSizes, stock: totalStock.toString() });
  };

  const openNewDialog = () => {
    resetForm();
    setFormData(prev => ({ ...prev, sku: generateSku() }));
    setDialogOpen(true);
  };

  const migratePlusSized = async () => {
    if (!confirm('Isso vai marcar como "Plus Size" todos os produtos cujo nome contém "Plus". Continuar?')) return;

    try {
      const result = await apiPost("/api/admin/migrate-plus-sized", { apply: true, limit: 500 });
      toast({
        title: "Migração concluída",
        description: `Atualizados: ${result?.updated ?? 0} | Escaneados: ${result?.scanned ?? 0}`,
      });
      fetchProducts();
    } catch (error) {
      toast({
        title: "Erro ao migrar Plus Size",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  const normalizedSearch = search.trim().toLowerCase();
  const filteredProducts = normalizedSearch
    ? products.filter((p) => {
        const name = (p.name || "").toLowerCase();
        const sku = (p.sku || "").toLowerCase();
        return name.includes(normalizedSearch) || sku.includes(normalizedSearch);
      })
    : products;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Produtos</h1>
          <p className="text-gray-500">Gerencie os produtos da loja</p>
        </div>
        <div className="flex items-center gap-2">
          {userData?.role === "ADMIN" && (
            <>
              <Button variant="outline" onClick={migratePlusSized}>
                Migrar Plus Size
              </Button>
              <Button variant="outline" onClick={migratePlusSizeSizes}>
                Ajustar tamanhos Plus
              </Button>
            </>
          )}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNewDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Novo Produto
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingProduct ? "Editar Produto" : "Novo Produto"}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
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
                  <Label htmlFor="sku">SKU</Label>
                  <Input
                    id="sku"
                    value={formData.sku}
                    readOnly
                    className="bg-gray-100"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formData.plusSized}
                  onChange={(e) => setFormData({ ...formData, plusSized: e.target.checked })}
                />
                Plus Size
              </label>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="costPrice">Preço de Custo</Label>
                  <Input
                    id="costPrice"
                    type="number"
                    step="0.01"
                    value={formData.costPrice}
                    onChange={(e) => {
                      const nextCostPrice = e.target.value;

                      if (editingProduct) {
                        setFormData({ ...formData, costPrice: nextCostPrice });
                        return;
                      }

                      const numericCost = parseFloat(nextCostPrice);
                      const suggestedSalePrice = Number.isFinite(numericCost)
                        ? (numericCost * MARKUP_MULTIPLIER).toFixed(2)
                        : "";

                      setFormData({
                        ...formData,
                        costPrice: nextCostPrice,
                        salePrice: suggestedSalePrice,
                      });
                    }}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="salePrice">Preço de Venda</Label>
                  <Input
                    id="salePrice"
                    type="number"
                    step="0.01"
                    value={formData.salePrice}
                    onChange={(e) =>
                      setFormData({ ...formData, salePrice: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Estoque Total</Label>
                  <Input
                    type="number"
                    value={formData.stock}
                    disabled
                    className="bg-gray-100"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Estoque por Tamanho</Label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {formData.sizes.map((sizeData, index) => (
                    <div key={sizeData.size} className="space-y-1">
                      <Label className="text-xs text-center block">{sizeData.size}</Label>
                      <Input
                        type="number"
                        min="0"
                        value={sizeData.stock}
                        onChange={(e) => updateSizeStock(index, parseInt(e.target.value) || 0)}
                        className="text-center"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit">
                  {editingProduct ? "Salvar" : "Criar"}
                </Button>
              </div>
            </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Lista de Produtos
            </CardTitle>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou SKU..."
              className="w-full sm:max-w-xs"
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-4">Carregando...</p>
          ) : filteredProducts.length === 0 ? (
            <p className="text-center py-4 text-gray-500">
              Nenhum produto cadastrado
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Plus</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead className="text-right">Venda</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>{product.sku}</TableCell>
                    <TableCell>
                      {product.plusSized ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#355444] text-white">
                          PLUS
                        </span>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(product.costPrice)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(product.salePrice)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div>{product.stock}</div>
                      {product.sizes?.length > 0 && (
                        <div className="text-xs text-gray-500">
                          {product.sizes.filter(s => s.stock > 0).map(s => `${s.size}:${s.stock}`).join(" | ")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(product)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(product.id)}
                        >
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

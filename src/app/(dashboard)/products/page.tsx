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

interface Owner {
  id: string;
  name: string;
}

interface ProductSize {
  size: string;
  stock: number;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  ownerId: string;
  owner: Owner;
  costPrice: number;
  salePrice: number;
  stock: number;
  sizes: ProductSize[];
}

const DEFAULT_SIZES = ["PP", "P", "M", "G", "GG", "XG"];

export default function ProductsPage() {
  const { userData } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    sku: "",
    ownerId: "",
    costPrice: "",
    salePrice: "",
    stock: "0",
    sizes: DEFAULT_SIZES.map(size => ({ size, stock: 0 })),
  });

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

  const fetchOwners = async () => {
    try {
      const data = await apiGet("/api/owners");
      if (Array.isArray(data)) {
        setOwners(data);
      } else {
        console.error("Error fetching owners:", data);
        setOwners([]);
      }
    } catch (error) {
      console.error("Error fetching owners:", error);
      setOwners([]);
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchOwners();
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
      ownerId: product.ownerId,
      costPrice: product.costPrice.toString(),
      salePrice: product.salePrice.toString(),
      stock: product.stock.toString(),
      sizes: product.sizes?.length > 0 
        ? product.sizes 
        : DEFAULT_SIZES.map(size => ({ size, stock: 0 })),
    });
    setDialogOpen(true);
  };

  const resetForm = () => {
    setEditingProduct(null);
    setFormData({
      name: "",
      sku: "",
      ownerId: userData?.ownerId || "",
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Produtos</h1>
          <p className="text-gray-500">Gerencie os produtos da loja</p>
        </div>
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

              {userData?.role === "ADMIN" && (
                <div className="space-y-2">
                  <Label htmlFor="owner">Proprietário</Label>
                  <Select
                    value={formData.ownerId}
                    onValueChange={(value) =>
                      setFormData({ ...formData, ownerId: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o proprietário" />
                    </SelectTrigger>
                    <SelectContent>
                      {owners.map((owner) => (
                        <SelectItem key={owner.id} value={owner.id}>
                          {owner.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="costPrice">Preço de Custo</Label>
                  <Input
                    id="costPrice"
                    type="number"
                    step="0.01"
                    value={formData.costPrice}
                    onChange={(e) =>
                      setFormData({ ...formData, costPrice: e.target.value })
                    }
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
                <div className="grid grid-cols-6 gap-2">
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Lista de Produtos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-4">Carregando...</p>
          ) : products.length === 0 ? (
            <p className="text-center py-4 text-gray-500">
              Nenhum produto cadastrado
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Proprietário</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead className="text-right">Venda</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>{product.sku}</TableCell>
                    <TableCell>{product.owner.name}</TableCell>
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

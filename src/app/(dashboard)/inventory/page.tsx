"use client";

import { useState, useEffect } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { Boxes, TrendingUp, Settings2 } from "lucide-react";

interface ProductSize {
  size: string;
  stock: number;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  costPrice: number;
  salePrice: number;
  stock: number;
  sizes: ProductSize[];
}

export default function InventoryPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjustingProduct, setAdjustingProduct] = useState<Product | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [sizeDeltas, setSizeDeltas] = useState<Record<string, string>>({});
  const [submittingAdjust, setSubmittingAdjust] = useState(false);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const data = await apiGet("/api/products");
      setProducts(Array.isArray(data) ? data : []);
    } catch {
      toast({ title: "Erro ao carregar produtos", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const openAdjust = (product: Product) => {
    setAdjustingProduct(product);
    setAdjustDelta("");
    setAdjustReason("");
    setSizeDeltas({});
  };

  const closeAdjust = () => {
    setAdjustingProduct(null);
    setAdjustDelta("");
    setAdjustReason("");
    setSizeDeltas({});
  };

  const submitAdjustment = async () => {
    if (!adjustingProduct) return;
    const hasSizes = Array.isArray(adjustingProduct.sizes) && adjustingProduct.sizes.length > 0;
    const sizeAdjustments = Object.entries(sizeDeltas)
      .map(([size, value]) => ({ size, delta: Math.trunc(Number(value) || 0) }))
      .filter((s) => s.delta !== 0);
    const totalSizeDelta = sizeAdjustments.reduce((sum, s) => sum + s.delta, 0);
    const delta = hasSizes ? totalSizeDelta : Math.trunc(Number(adjustDelta) || 0);

    if (!adjustReason.trim()) {
      toast({ title: "Motivo obrigatório", description: "Informe o motivo do ajuste.", variant: "destructive" });
      return;
    }
    if (delta === 0) {
      toast({ title: "Ajuste inválido", description: "Informe um valor diferente de zero.", variant: "destructive" });
      return;
    }

    try {
      setSubmittingAdjust(true);
      await apiPost("/api/stock-adjustments", {
        productId: adjustingProduct.id,
        delta,
        reason: adjustReason.trim(),
        sizeAdjustments: hasSizes ? sizeAdjustments : [],
      });
      toast({ title: "Ajuste aplicado" });
      closeAdjust();
      await fetchProducts();
    } catch (error) {
      toast({
        title: "Erro ao aplicar ajuste",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmittingAdjust(false);
    }
  };

  const totalInventoryValue = products.reduce((sum, p) => sum + p.stock * p.costPrice, 0);
  const totalStock = products.reduce((sum, p) => sum + p.stock, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Estoque</h1>
        <p className="text-gray-500">Controle de inventário</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Valor Total do Estoque</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(totalInventoryValue)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Itens</CardTitle>
            <Boxes className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStock}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Produtos Cadastrados</CardTitle>
            <Boxes className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{products.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detalhes do Estoque</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-4">Carregando...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Custo Unit.</TableHead>
                  <TableHead className="text-right">Estoque Total</TableHead>
                  <TableHead>Estoque por Tamanho</TableHead>
                  <TableHead className="text-right">Valor Total</TableHead>
                  <TableHead className="text-right">Receita Projetada</TableHead>
                  <TableHead className="text-right">Lucro Projetado</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>{product.sku}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(product.costPrice)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          product.stock === 0
                            ? "text-red-500 font-bold"
                            : product.stock < 5
                            ? "text-yellow-500 font-bold"
                            : ""
                        }
                      >
                        {product.stock}
                      </span>
                    </TableCell>
                    <TableCell>
                      {product.sizes?.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {product.sizes.map((s) => (
                            <span
                              key={s.size}
                              className={`text-xs px-1.5 py-0.5 rounded ${
                                s.stock === 0
                                  ? "bg-red-100 text-red-600"
                                  : s.stock < 3
                                  ? "bg-yellow-100 text-yellow-700"
                                  : "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {s.size}: {s.stock}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(product.stock * product.costPrice)}
                    </TableCell>
                    <TableCell className="text-right text-blue-600">
                      {formatCurrency(product.stock * product.salePrice)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-emerald-600">
                      {formatCurrency(product.stock * (product.salePrice - product.costPrice))}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openAdjust(product)}
                      >
                        <Settings2 className="h-3.5 w-3.5 mr-1" />
                        Ajustar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!adjustingProduct} onOpenChange={(open) => !open && closeAdjust()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajuste de Estoque</DialogTitle>
          </DialogHeader>
          {adjustingProduct && (
            <div className="space-y-4">
              <div className="rounded-md bg-gray-50 p-3 text-sm">
                <p className="font-medium">{adjustingProduct.name}</p>
                <p className="text-xs text-gray-500">SKU: {adjustingProduct.sku}</p>
                <p className="text-xs text-gray-500">Estoque atual: {adjustingProduct.stock}</p>
              </div>

              <p className="text-xs text-gray-500">
                Use valores positivos para aumentar e negativos para reduzir. Ajustes não afetam o relatório de entradas nem o financeiro.
              </p>

              {adjustingProduct.sizes && adjustingProduct.sizes.length > 0 ? (
                <div className="space-y-2">
                  <Label>Ajuste por tamanho</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {adjustingProduct.sizes.map((s) => (
                      <div key={s.size} className="flex items-center gap-2">
                        <span className="text-xs w-20 text-gray-600">
                          {s.size} ({s.stock})
                        </span>
                        <Input
                          type="number"
                          placeholder="0"
                          value={sizeDeltas[s.size] || ""}
                          onChange={(e) =>
                            setSizeDeltas((prev) => ({ ...prev, [s.size]: e.target.value }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="delta">Variação (positiva ou negativa)</Label>
                  <Input
                    id="delta"
                    type="number"
                    placeholder="Ex: -3 ou 5"
                    value={adjustDelta}
                    onChange={(e) => setAdjustDelta(e.target.value)}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="reason">Motivo</Label>
                <Textarea
                  id="reason"
                  placeholder="Ex: Contagem física, perda, dano..."
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeAdjust} disabled={submittingAdjust}>
              Cancelar
            </Button>
            <Button onClick={submitAdjustment} disabled={submittingAdjust}>
              {submittingAdjust ? "Aplicando..." : "Aplicar Ajuste"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { apiGet } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { Boxes, TrendingUp } from "lucide-react";

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
  owner: {
    id: string;
    name: string;
  };
}

interface InventorySummary {
  ownerId: string;
  ownerName: string;
  totalProducts: number;
  totalStock: number;
  inventoryValue: number;
}

export default function InventoryPage() {
  const { userData } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const data = await apiGet("/api/products");
      setProducts(Array.isArray(data) ? data : []);
    } catch (error) {
      toast({ title: "Erro ao carregar produtos", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const summaryByOwner = products.reduce((acc, product) => {
    const ownerId = product.owner.id;
    if (!acc[ownerId]) {
      acc[ownerId] = {
        ownerId,
        ownerName: product.owner.name,
        totalProducts: 0,
        totalStock: 0,
        inventoryValue: 0,
      };
    }
    acc[ownerId].totalProducts += 1;
    acc[ownerId].totalStock += product.stock;
    acc[ownerId].inventoryValue += product.stock * product.costPrice;
    return acc;
  }, {} as Record<string, InventorySummary>);

  const totalInventoryValue = Object.values(summaryByOwner).reduce(
    (sum, s) => sum + s.inventoryValue,
    0
  );

  const totalStock = Object.values(summaryByOwner).reduce(
    (sum, s) => sum + s.totalStock,
    0
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Estoque</h1>
        <p className="text-gray-500">Controle de inventário por proprietário</p>
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
          <CardTitle>Resumo por Proprietário</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proprietário</TableHead>
                <TableHead className="text-right">Produtos</TableHead>
                <TableHead className="text-right">Unidades</TableHead>
                <TableHead className="text-right">Valor do Estoque</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.values(summaryByOwner).map((summary) => (
                <TableRow key={summary.ownerId}>
                  <TableCell className="font-medium">{summary.ownerName}</TableCell>
                  <TableCell className="text-right">{summary.totalProducts}</TableCell>
                  <TableCell className="text-right">{summary.totalStock}</TableCell>
                  <TableCell className="text-right font-bold text-green-600">
                    {formatCurrency(summary.inventoryValue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
                  <TableHead>Proprietário</TableHead>
                  <TableHead className="text-right">Custo Unit.</TableHead>
                  <TableHead className="text-right">Estoque Total</TableHead>
                  <TableHead>Estoque por Tamanho</TableHead>
                  <TableHead className="text-right">Valor Total</TableHead>
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

"use client";

import { useState, useEffect, useRef } from "react";
import { apiGet } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { Barcode, Printer, Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

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

export default function BarcodesPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchProducts();
    loadJsBarcode();
  }, []);

  const loadJsBarcode = () => {
    if (typeof window !== "undefined" && !(window as any).JsBarcode) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js";
      script.async = true;
      document.body.appendChild(script);
    }
  };

  const fetchProducts = async () => {
    try {
      const data = await apiGet("/api/products");
      if (Array.isArray(data)) {
        setProducts(data);
      }
    } catch (error) {
      toast({ title: "Erro ao carregar produtos", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter((product) => {
    return product.name.toLowerCase().includes(search.toLowerCase()) ||
      product.sku.toLowerCase().includes(search.toLowerCase());
  });

  const toggleProduct = (productId: string) => {
    const newSelected = new Set(selectedProducts);
    if (newSelected.has(productId)) {
      newSelected.delete(productId);
    } else {
      newSelected.add(productId);
    }
    setSelectedProducts(newSelected);
  };

  const toggleAll = () => {
    if (selectedProducts.size === filteredProducts.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(filteredProducts.map((p) => p.id)));
    }
  };

  const generateBarcodes = () => {
    if (selectedProducts.size === 0) {
      toast({ title: "Selecione pelo menos um produto", variant: "destructive" });
      return;
    }

    const selectedProductsList = products.filter((p) => selectedProducts.has(p.id));
    
    const printWindow = window.open("", "_blank", "width=800,height=600");
    if (!printWindow) {
      toast({ title: "Erro ao abrir janela de impressão", variant: "destructive" });
      return;
    }

    const barcodesHtml = selectedProductsList
      .map((product) => {
        // Generate stock quantity copies of each barcode
        const barcodeItems = Array(product.stock)
          .fill(null)
          .map(
            (_, i) => `
            <div class="barcode-item">
              <div class="product-name">${product.name}</div>
              <svg class="barcode" id="barcode-${product.id}-${i}"></svg>
              <div class="product-price">${formatCurrency(product.salePrice)}</div>
            </div>
          `
          )
          .join("");
        return barcodeItems;
      })
      .join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Códigos de Barras</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: Arial, sans-serif;
            padding: 10mm;
          }
          .barcodes-container {
            display: flex;
            flex-wrap: wrap;
            gap: 5mm;
            justify-content: flex-start;
          }
          .barcode-item {
            width: 50mm;
            padding: 3mm;
            border: 1px dashed #ccc;
            text-align: center;
            page-break-inside: avoid;
          }
          .product-name {
            font-size: 9px;
            font-weight: bold;
            margin-bottom: 2mm;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .barcode {
            width: 100%;
            height: auto;
          }
          .product-price {
            font-size: 12px;
            font-weight: bold;
            margin-top: 2mm;
          }
          @media print {
            body { padding: 5mm; }
            .barcode-item { border: 1px dashed #999; }
          }
        </style>
      </head>
      <body>
        <div class="barcodes-container">
          ${barcodesHtml}
        </div>
        <script>
          window.onload = function() {
            ${selectedProductsList
              .map((product) =>
                Array(product.stock)
                  .fill(null)
                  .map(
                    (_, i) => `
                    JsBarcode("#barcode-${product.id}-${i}", "${product.sku}", {
                      format: "CODE128",
                      width: 1.5,
                      height: 40,
                      displayValue: true,
                      fontSize: 10,
                      margin: 5
                    });
                  `
                  )
                  .join("")
              )
              .join("")}
            setTimeout(function() {
              window.print();
            }, 500);
          };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Códigos de Barras</h1>
          <p className="text-gray-500">Gere etiquetas com códigos de barras para os produtos</p>
        </div>
        <Button onClick={generateBarcodes} disabled={selectedProducts.size === 0}>
          <Printer className="h-4 w-4 mr-2" />
          Imprimir ({selectedProducts.size})
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Barcode className="h-5 w-5" />
            Selecione os Produtos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 items-end">
            <div className="flex-1 space-y-2">
              <Label>Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Buscar por nome ou SKU..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>

          {loading ? (
            <p className="text-center py-4">Carregando...</p>
          ) : filteredProducts.length === 0 ? (
            <p className="text-center py-4 text-gray-500">Nenhum produto encontrado</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <Checkbox
                        checked={selectedProducts.size === filteredProducts.length && filteredProducts.length > 0}
                        onCheckedChange={toggleAll}
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Produto</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">SKU</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Estoque</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Preço</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredProducts.map((product) => (
                    <tr
                      key={product.id}
                      className={`hover:bg-gray-50 cursor-pointer ${
                        selectedProducts.has(product.id) ? "bg-blue-50" : ""
                      }`}
                      onClick={() => toggleProduct(product.id)}
                    >
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selectedProducts.has(product.id)}
                          onCheckedChange={() => toggleProduct(product.id)}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium">{product.name}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono">{product.sku}</td>
                      <td className="px-4 py-3 text-right">{product.stock}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(product.salePrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

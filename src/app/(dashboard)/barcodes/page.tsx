"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { Printer, Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/layout/page-header";

interface ProductSize {
  size: string;
  stock: number;
}

type WindowWithJsBarcode = Window & {
  JsBarcode?: unknown;
};

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

  const fetchProducts = useCallback(async () => {
    try {
      const data = await apiGet("/api/products");
      if (Array.isArray(data)) {
        setProducts(data);
      }
    } catch {
      toast({ title: "Erro ao carregar produtos", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchProducts();
    loadJsBarcode();
  }, [fetchProducts]);

  const loadJsBarcode = () => {
    if (typeof window !== "undefined" && !(window as WindowWithJsBarcode).JsBarcode) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js";
      script.async = true;
      document.body.appendChild(script);
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
            gap: 4.5mm;
            justify-content: flex-start;
          }
          .barcode-item {
            width: 45mm;
            padding: 2.7mm;
            border: 1px dashed #ccc;
            text-align: center;
            page-break-inside: avoid;
          }
          .product-name {
            font-size: 8px;
            font-weight: bold;
            margin-bottom: 1.8mm;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .barcode {
            width: 100%;
            height: auto;
          }
          .product-price {
            font-size: 14px;
            font-weight: bold;
            line-height: 1;
            margin-top: 1.6mm;
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
                      width: 1.35,
                      height: 36,
                      displayValue: false,
                      fontSize: 10,
                      margin: 4
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
    <div>
      <PageHeader
        title="Códigos de barras"
        meta={<span>Escolha os produtos e imprima as etiquetas</span>}
        actions={
          <Button size="sm" onClick={generateBarcodes} disabled={selectedProducts.size === 0}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Imprimir etiquetas{selectedProducts.size > 0 ? ` · ${selectedProducts.size}` : ""}
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" aria-hidden="true" />
          <Input
            aria-label="Buscar produto"
            placeholder="Buscar por nome ou código"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {selectedProducts.size > 0 ? (
          <p className="text-sm text-ink-2">
            <b className="font-semibold text-ink">{selectedProducts.size}</b> selecionado{selectedProducts.size === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>

          {loading ? (
            <div className="space-y-2" aria-hidden="true">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 animate-pulse border border-rule bg-paper" />)}</div>
          ) : filteredProducts.length === 0 ? (
            <p className="border border-rule bg-paper px-5 py-12 text-center text-sm text-ink-3">Nenhum produto encontrado.</p>
          ) : (
            <div className="overflow-x-auto border border-rule bg-paper">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-ink/80">
                    <th className="w-12 px-4 py-2.5 text-left">
                      <Checkbox
                        aria-label="Selecionar todos"
                        checked={selectedProducts.size === filteredProducts.length && filteredProducts.length > 0}
                        onCheckedChange={toggleAll}
                      />
                    </th>
                    <th className="px-3 py-2.5 text-left font-tag text-xs font-bold uppercase tracking-[0.08em] text-ink-2">Produto</th>
                    <th className="px-3 py-2.5 text-left font-tag text-xs font-bold uppercase tracking-[0.08em] text-ink-2">Código</th>
                    <th className="px-3 py-2.5 text-right font-tag text-xs font-bold uppercase tracking-[0.08em] text-ink-2">Estoque</th>
                    <th className="px-4 py-2.5 text-right font-tag text-xs font-bold uppercase tracking-[0.08em] text-ink-2">Preço</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {filteredProducts.map((product) => (
                    <tr
                      key={product.id}
                      className={`cursor-pointer transition-colors hover:bg-sub ${
                        selectedProducts.has(product.id) ? "bg-denim-tint hover:bg-denim-tint" : ""
                      }`}
                      onClick={() => toggleProduct(product.id)}
                    >
                      <td className="px-4 py-2.5">
                        <Checkbox
                          aria-label={`Selecionar ${product.name}`}
                          checked={selectedProducts.has(product.id)}
                          onCheckedChange={() => toggleProduct(product.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-3 py-2.5 font-semibold">{product.name}</td>
                      <td className="px-3 py-2.5 tracking-[0.04em] text-ink-2">{product.sku}</td>
                      <td className="px-3 py-2.5 text-right">{product.stock}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{formatCurrency(product.salePrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </div>
  );
}

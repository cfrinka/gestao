"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
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
import { cn, formatCurrency } from "@/lib/utils";
import { Settings2, Printer, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { LOW_STOCK, SizeGrid } from "@/components/etiqueta/size-grid";
import { TagHeader, TagRow } from "@/components/etiqueta/tag-row";
import { PriceTag } from "@/components/etiqueta/price-tag";
import { ProductPhoto } from "@/components/etiqueta/product-photo";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { todayISO } from "@/lib/dates";

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
  image?: string;
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
  const [search, setSearch] = useState("");

  const fetchProducts = useCallback(async () => {
    try {
      const data = await apiGet("/api/products");
      setProducts(Array.isArray(data) ? data : []);
    } catch {
      toast({ title: "Erro ao carregar produtos", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

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
        idempotencyKey: crypto.randomUUID(),
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

  const printInventorySheet = () => {
    if (products.length === 0) return;

    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.text("Folha de Contagem de Estoque", 14, 20);
    doc.setFontSize(10);
    doc.text("Data: ____/____/________", 14, 28);
    doc.text("Responsável: ______________________________________", 90, 28);

    const rows: string[][] = [];
    products.forEach((product) => {
      if (product.sizes && product.sizes.length > 0) {
        product.sizes.forEach((s) => {
          rows.push([product.name, product.sku, s.size, String(s.stock), ""]);
        });
      } else {
        rows.push([product.name, product.sku, "-", String(product.stock), ""]);
      }
    });

    autoTable(doc, {
      startY: 36,
      head: [["Produto", "SKU", "Tamanho", "Estoque (Sistema)", "Contagem Física"]],
      body: rows,
      theme: "grid",
      styles: { fontSize: 9, minCellHeight: 8 },
      headStyles: { fillColor: [245, 245, 245], textColor: 20 },
      columnStyles: {
        3: { halign: "right" },
        4: { halign: "right", cellWidth: 35 },
      },
    });

    doc.save(`inventario-${todayISO()}.pdf`);
  };

  const normalizedSearch = search.trim().toLowerCase();
  const visibleProducts = normalizedSearch
    ? products.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(normalizedSearch) ||
          (p.sku || "").toLowerCase().includes(normalizedSearch)
      )
    : products;

  return (
    <div>
      <PageHeader
        title="Estoque"
        meta={
          !loading ? (
            <span>
              <b className="font-semibold text-ink">{totalStock}</b> peças ·{" "}
              <b className="font-semibold text-ink">{products.length}</b> produtos ·{" "}
              <b className="font-semibold text-ink">{formatCurrency(totalInventoryValue)}</b> pelo custo
            </span>
          ) : null
        }
        actions={
          <Button variant="outline" size="sm" onClick={printInventorySheet} disabled={loading || products.length === 0}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Imprimir folha de contagem
          </Button>
        }
      />

      <div className="relative mb-4 w-full sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" aria-hidden="true" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou código"
          aria-label="Buscar produto no estoque"
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse border border-rule bg-paper" />
          ))}
        </div>
      ) : visibleProducts.length === 0 ? (
        <div className="border border-rule bg-paper px-6 py-14 text-center">
          <p className="font-semibold text-ink">
            {normalizedSearch ? `Nenhum produto com “${search.trim()}”` : "Nenhum produto no estoque"}
          </p>
        </div>
      ) : (
        <>
          <TagHeader className="hidden xl:grid xl:grid-cols-[minmax(0,1fr)_262px_116px_56px_220px_96px] xl:gap-x-4">
            <span>Produto</span>
            <span>Tamanhos · estoque</span>
            <span className="text-right">Venda</span>
            <span className="text-right">Peças</span>
            <span className="text-right">Custo · receita · lucro</span>
            <span />
          </TagHeader>
          <ul className="space-y-2">
            {visibleProducts.map((product) => (
              <li key={product.id}>
                <TagRow className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 xl:grid-cols-[minmax(0,1fr)_262px_116px_56px_220px_96px]">
                  <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-3">
                    <ProductPhoto src={product.image} name={product.name} className="h-12 w-12" />
                    <div className="min-w-0">
                      <p className="line-clamp-2 font-semibold leading-snug">{product.name}</p>
                      <p className="text-xs tracking-[0.04em] text-ink-3">{product.sku}</p>
                    </div>
                  </div>
                  <div className="col-span-2 row-start-2 xl:col-span-1 xl:col-start-2 xl:row-start-1">
                    {product.sizes?.length > 0 ? (
                      <SizeGrid sizes={product.sizes} size="sm" lowAt={LOW_STOCK} />
                    ) : (
                      <span className="text-sm text-ink-3">Sem grade</span>
                    )}
                  </div>
                  <div className="col-start-2 row-start-1 text-right xl:col-start-3">
                    <PriceTag value={product.salePrice} className="text-2xl" />
                    <p className="text-xs text-ink-3 xl:hidden">
                      <StockCount value={product.stock} /> peças
                    </p>
                  </div>
                  <p className="hidden text-right xl:col-start-4 xl:row-start-1 xl:block">
                    <span className="sr-only">Peças em estoque: </span>
                    <StockCount value={product.stock} />
                  </p>
                  <dl className="col-start-1 row-start-3 flex flex-wrap gap-x-3 text-xs text-ink-3 xl:col-start-5 xl:row-start-1 xl:block xl:text-right">
                    <div className="flex gap-1 xl:justify-end">
                      <dt>Custo</dt>
                      <dd className="tabular-nums text-ink-2">{formatCurrency(product.stock * product.costPrice)}</dd>
                    </div>
                    <div className="flex gap-1 xl:justify-end">
                      <dt>Receita</dt>
                      <dd className="tabular-nums text-ink-2">{formatCurrency(product.stock * product.salePrice)}</dd>
                    </div>
                    <div className="flex gap-1 xl:justify-end">
                      <dt>Lucro</dt>
                      <dd className="font-semibold tabular-nums text-verde">
                        {formatCurrency(product.stock * (product.salePrice - product.costPrice))}
                      </dd>
                    </div>
                  </dl>
                  <div className="col-start-2 row-start-3 flex justify-end xl:col-start-6 xl:row-start-1">
                    <Button variant="outline" size="sm" onClick={() => openAdjust(product)}>
                      <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Ajustar
                    </Button>
                  </div>
                </TagRow>
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog open={!!adjustingProduct} onOpenChange={(open) => !open && closeAdjust()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajustar estoque</DialogTitle>
          </DialogHeader>
          {adjustingProduct && (
            <div className="space-y-4">
              <div className="border border-rule bg-sub p-3 text-sm">
                <p className="font-semibold">{adjustingProduct.name}</p>
                <p className="text-xs text-ink-3">
                  {adjustingProduct.sku} · {adjustingProduct.stock} peças agora
                </p>
              </div>

              <p className="text-sm text-ink-3">
                Use números positivos para somar e negativos para tirar. O ajuste não entra no relatório de entradas nem no financeiro.
              </p>

              {adjustingProduct.sizes && adjustingProduct.sizes.length > 0 ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold">Ajuste por tamanho</legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {adjustingProduct.sizes.map((s) => (
                      <label key={s.size} className="flex items-center border border-rule-strong bg-paper">
                        <span className="flex h-10 w-16 flex-shrink-0 flex-col items-center justify-center border-r border-rule-strong bg-sub leading-none">
                          <span className="font-tag text-base font-bold">{s.size}</span>
                          <span className="text-[11px] text-ink-3">{s.stock}</span>
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          placeholder="0"
                          aria-label={`Ajuste do tamanho ${s.size}`}
                          value={sizeDeltas[s.size] || ""}
                          onChange={(e) =>
                            setSizeDeltas((prev) => ({ ...prev, [s.size]: e.target.value }))
                          }
                          className="h-10 w-full min-w-0 bg-paper px-2 text-right text-base font-semibold tabular-nums focus:bg-denim-tint focus:outline-none"
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="delta">Quantidade a somar ou tirar</Label>
                  <Input
                    id="delta"
                    type="number"
                    inputMode="numeric"
                    placeholder="Ex.: −3 ou 5"
                    value={adjustDelta}
                    onChange={(e) => setAdjustDelta(e.target.value)}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="reason">Motivo</Label>
                <Textarea
                  id="reason"
                  placeholder="Ex.: contagem física, perda, peça com defeito"
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
              {submittingAdjust ? "Aplicando…" : "Aplicar ajuste"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StockCount({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "font-tag text-xl font-extrabold tabular-nums",
        value <= LOW_STOCK ? "text-vermelho" : "text-ink"
      )}
    >
      {value}
    </span>
  );
}

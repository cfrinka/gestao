"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { roundMoney } from "@/lib/money";
import { apiGet, apiPost, apiPatch } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Minus, Plus, Search, Trash2, Banknote } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SizeGrid } from "@/components/etiqueta/size-grid";
import { PriceTag } from "@/components/etiqueta/price-tag";
import { ProductPhoto } from "@/components/etiqueta/product-photo";

type ExchangeDirection = "IN" | "OUT";
type ExchangePaymentMethod = "cash" | "pix" | "credit" | "debit";

interface ProductSize {
  size: string;
  stock: number;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  plusSized?: boolean;
  salePrice: number;
  stock: number;
  sizes: ProductSize[];
  image?: string;
}

interface ExchangeCartItem {
  product: Product;
  size: string;
  quantity: number;
  direction: ExchangeDirection;
}

interface ExchangeRecord {
  id: string;
  documentNumber?: string;
  customerName?: string;
  notes?: string;
  paymentMethod?: ExchangePaymentMethod;
  totalInValue: number;
  totalOutValue: number;
  discountAmount?: number;
  difference: number;
  addedToCashRegisterSales?: boolean;
  createdByName: string;
  createdAt: string;
}

export default function ExchangesPage() {
  const { toast } = useToast();
  const { userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [exchanges, setExchanges] = useState<ExchangeRecord[]>([]);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [addDirection, setAddDirection] = useState<ExchangeDirection>("IN");
  const [cart, setCart] = useState<ExchangeCartItem[]>([]);
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [differencePaymentMethod, setDifferencePaymentMethod] = useState<ExchangePaymentMethod | "">("")
  const [addingToRegister, setAddingToRegister] = useState<string | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [refundMode, setRefundMode] = useState<"" | "cash" | "none">("");
  // Same retry rule as the POS: an unchanged exchange resent after a dropped response reuses its key.
  const exchangeAttempt = useRef<{ key: string; signature: string } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [productsData, exchangesData] = await Promise.all([
        apiGet("/api/products"),
        apiGet("/api/exchanges?limit=100"),
      ]);
      setProducts(Array.isArray(productsData) ? productsData : []);
      setExchanges(Array.isArray(exchangesData) ? exchangesData : []);
    } catch {
      toast({ title: "Erro ao carregar dados de trocas", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter((p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term));
  }, [products, search]);

  const getSizeStock = (product: Product, size: string): number => {
    const sizeStock = product.sizes?.find((s) => s.size === size);
    return Number(sizeStock?.stock || 0);
  };

  const addToCart = (product: Product, size: string, direction: ExchangeDirection) => {
    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.product.id === product.id && item.size === size && item.direction === direction
      );

      const currentQty = existingIndex >= 0 ? prev[existingIndex].quantity : 0;
      const isOutput = direction === "OUT";
      const availableStock = size ? getSizeStock(product, size) : Number(product.stock || 0);

      if (isOutput && currentQty + 1 > availableStock) {
        toast({
          title: "Estoque insuficiente",
          description: `Disponível: ${availableStock}`,
          variant: "destructive",
        });
        return prev;
      }

      if (existingIndex >= 0) {
        return prev.map((item, i) => (i === existingIndex ? { ...item, quantity: item.quantity + 1 } : item));
      }

      return [...prev, { product, size, quantity: 1, direction }];
    });

    setSelectedProduct(null);
  };

  const handleProductClick = (product: Product) => {
    if (product.sizes && product.sizes.length > 0) {
      setSelectedProduct(product);
      return;
    }
    addToCart(product, "", addDirection);
  };

  const updateQuantity = (productId: string, size: string, direction: ExchangeDirection, delta: number) => {
    setCart((prev) => {
      const next = prev
        .map((item) => {
          if (item.product.id !== productId || item.size !== size || item.direction !== direction) return item;
          const nextQty = item.quantity + delta;
          if (nextQty <= 0) return null;

          if (item.direction === "OUT") {
            const availableStock = item.size ? getSizeStock(item.product, item.size) : Number(item.product.stock || 0);
            if (nextQty > availableStock) {
              toast({
                title: "Estoque insuficiente",
                description: `Disponível: ${availableStock}`,
                variant: "destructive",
              });
              return item;
            }
          }

          return { ...item, quantity: nextQty };
        })
        .filter((item): item is ExchangeCartItem => item !== null);

      return next;
    });
  };

  const removeFromCart = (productId: string, size: string, direction: ExchangeDirection) => {
    setCart((prev) => prev.filter((item) => !(item.product.id === productId && item.size === size && item.direction === direction)));
  };

  const clearCart = () => {
    setCart([]);
  };

  const totalInValue = cart
    .filter((item) => item.direction === "IN")
    .reduce((sum, item) => sum + item.product.salePrice * item.quantity, 0);
  const totalOutValue = cart
    .filter((item) => item.direction === "OUT")
    .reduce((sum, item) => sum + item.product.salePrice * item.quantity, 0);
  const entryItems = cart.filter((item) => item.direction === "IN");
  const outputItems = cart.filter((item) => item.direction === "OUT");
  const grossDifference = totalOutValue - totalInValue;
  const numericDiscountAmount = roundMoney(Math.max(0, Number(discountAmount || 0)));
  const appliedDiscountAmount = roundMoney(Math.min(numericDiscountAmount, Math.max(0, grossDifference)));
  const totalDifference = roundMoney(grossDifference - appliedDiscountAmount);
  // Cashiers may give up to 10% of the difference; more needs an admin's password, checked by the server.
  const needsAdminForDiscount =
    userData?.role === "CASHIER" && appliedDiscountAmount > roundMoney(Math.max(0, grossDifference) * 0.1);

  const handleAddToRegister = async (exchangeId: string) => {
    setAddingToRegister(exchangeId);
    try {
      await apiPatch("/api/exchanges", {
        action: "add_to_register",
        exchangeId,
      });
      toast({ title: "Diferença incluída nas vendas do caixa" });
      await fetchAll();
    } catch (error) {
      toast({
        title: "Erro ao incluir no caixa",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setAddingToRegister(null);
    }
  };

  const registerExchange = async () => {
    if (cart.length === 0) {
      toast({ title: "Adicione itens na troca", variant: "destructive" });
      return;
    }

    if (totalDifference > 0 && !differencePaymentMethod) {
      toast({
        title: "Selecione a forma de pagamento",
        description: "Informe como o cliente pagou a diferença da troca",
        variant: "destructive",
      });
      return;
    }

    if (totalDifference < 0 && !refundMode) {
      toast({
        title: "Diferença a favor do cliente",
        description: "Informe se o valor foi devolvido em dinheiro ou não.",
        variant: "destructive",
      });
      return;
    }

    if (needsAdminForDiscount && !adminPassword.trim()) {
      toast({
        title: "Senha do administrador",
        description: "Desconto acima de 10% precisa da senha de um administrador.",
        variant: "destructive",
      });
      return;
    }

    setProcessing(true);
    try {
      if (needsAdminForDiscount) {
        await apiPost("/api/admin/verify-password", { adminPassword: adminPassword.trim() });
      }

      const exchangePayload = {
        customerName,
        notes,
        discountAmount: appliedDiscountAmount,
        paymentMethod: totalDifference > 0 ? differencePaymentMethod : undefined,
        refundMode: totalDifference < 0 ? refundMode : undefined,
        items: cart.map((item) => ({
          productId: item.product.id,
          size: item.size,
          quantity: item.quantity,
          direction: item.direction,
        })),
      };
      const signature = JSON.stringify(exchangePayload);
      if (exchangeAttempt.current?.signature !== signature) {
        exchangeAttempt.current = { key: crypto.randomUUID(), signature };
      }

      await apiPost("/api/exchanges", { ...exchangePayload, idempotencyKey: exchangeAttempt.current.key });
      exchangeAttempt.current = null;
      setAdminPassword("");
      setRefundMode("");

      toast({ title: "Troca registrada com sucesso" });
      setCustomerName("");
      setNotes("");
      setDiscountAmount("");
      setDifferencePaymentMethod("");
      clearCart();
      await fetchAll();
    } catch (error) {
      toast({
        title: "Erro ao registrar troca",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  const renderLines = (items: ExchangeCartItem[], label: string) =>
    items.map((item) => (
      <li
        key={`${item.product.id}-${item.size}-${item.direction}`}
        className="grid animate-line-in grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b-[1.5px] border-dashed border-rule-strong py-2.5 last:border-b-0"
      >
        <div className="min-w-0">
          <p className="font-semibold leading-snug">
            {item.product.name}
            {item.size ? (
              <span className="ml-1.5 inline-block border-[1.5px] border-ink px-1.5 align-[1px] font-tag text-sm font-bold leading-5">
                {item.size}
              </span>
            ) : null}
          </p>
          <p className="text-xs text-ink-3">
            {label} · {formatCurrency(item.product.salePrice)} cada
          </p>
        </div>
        <span className="self-start pt-0.5 font-tag text-lg font-extrabold tabular-nums">
          {formatCurrency(item.product.salePrice * item.quantity)}
        </span>
        <div className="col-span-2 mt-1.5 flex items-center justify-between">
          <div className="inline-flex items-stretch border border-rule-strong">
            <button
              type="button"
              aria-label={`Diminuir ${item.product.name}`}
              onClick={() => updateQuantity(item.product.id, item.size, item.direction, -1)}
              className="flex h-8 w-8 items-center justify-center text-ink-2 hover:bg-sub hover:text-ink"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="flex w-9 items-center justify-center border-x border-rule-strong text-sm font-semibold tabular-nums">
              {item.quantity}
            </span>
            <button
              type="button"
              aria-label={`Aumentar ${item.product.name}`}
              onClick={() => updateQuantity(item.product.id, item.size, item.direction, 1)}
              className="flex h-8 w-8 items-center justify-center text-ink-2 hover:bg-sub hover:text-ink"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => removeFromCart(item.product.id, item.size, item.direction)}
            className="inline-flex h-8 items-center gap-1.5 px-2 text-sm font-medium text-vermelho hover:bg-vermelho-tint"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Remover
          </button>
        </div>
      </li>
    ));

  return (
    <div className="space-y-6">
      <div className="-mx-3 -mt-3 flex flex-col sm:-mx-4 sm:-mt-4 md:-mx-6 md:-mt-6 lg:h-[calc(100dvh-4rem)] lg:min-h-[560px]">
        <PageHeader
          className="static m-0 sm:m-0 md:m-0"
          title="Trocas"
          meta={<span>Peça que volta, peça que sai; a diferença entra no caixa aberto</span>}
          actions={
            <div className="inline-flex border-[1.5px] border-ink" role="group" aria-label="O que está sendo lançado">
              <button
                type="button"
                aria-pressed={addDirection === "IN"}
                onClick={() => setAddDirection("IN")}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 px-3 text-sm font-semibold transition-colors",
                  addDirection === "IN" ? "bg-ink text-white" : "bg-paper text-ink hover:bg-sub"
                )}
              >
                <ArrowDownLeft className="h-4 w-4" aria-hidden="true" />
                Volta para a loja
              </button>
              <button
                type="button"
                aria-pressed={addDirection === "OUT"}
                onClick={() => setAddDirection("OUT")}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 border-l-[1.5px] border-ink px-3 text-sm font-semibold transition-colors",
                  addDirection === "OUT" ? "bg-ink text-white" : "bg-paper text-ink hover:bg-sub"
                )}
              >
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                Sai com o cliente
              </button>
            </div>
          }
        />

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="flex min-h-0 flex-col px-3 pt-3 sm:px-4 md:px-6 md:pt-5" aria-label="Produtos">
            <p className="mb-2 text-sm text-ink-2">
              Tocando num tamanho, a peça entra como{" "}
              <b className="font-semibold text-ink">{addDirection === "IN" ? "volta para a loja" : "sai com o cliente"}</b>.
            </p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-2" aria-hidden="true" />
              <Input
                aria-label="Buscar produto"
                placeholder="Buscar produto por nome ou código"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-[52px] border-[1.5px] border-ink pl-12 text-base"
              />
            </div>

            <div className="-mx-3 mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4 sm:-mx-4 sm:px-4 md:-mx-6 md:px-6 max-lg:max-h-[60dvh]">
              {loading ? (
                <ul className="space-y-2" aria-hidden="true">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <li key={i} className="tag-shape flex h-[68px] items-center bg-paper pl-7">
                      <div className="h-3 w-40 animate-pulse bg-sub" />
                    </li>
                  ))}
                </ul>
              ) : filteredProducts.length === 0 ? (
                <p className="px-6 py-14 text-center text-sm text-ink-3">Nenhum produto encontrado.</p>
              ) : (
                <ul className="space-y-2">
                  {filteredProducts.map((product) => {
                    const outDisabled = addDirection === "OUT" && Number(product.stock || 0) <= 0;
                    const hasSizes = product.sizes?.length > 0;
                    return (
                      <li key={product.id}>
                        <div
                          className={cn(
                            "tag-shape relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 bg-paper py-2.5 pl-7 pr-3 sm:pr-4 xl:grid-cols-[minmax(0,1fr)_auto_120px]",
                            outDisabled && "opacity-60"
                          )}
                        >
                          <span aria-hidden="true" className="absolute left-[9px] top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full bg-ground" />
                          <button
                            type="button"
                            disabled={outDisabled}
                            onClick={() => handleProductClick(product)}
                            className="col-start-1 row-start-1 flex min-w-0 items-center gap-3 text-left disabled:cursor-not-allowed"
                          >
                            <ProductPhoto src={product.image} name={product.name} className="h-11 w-11" />
                            <span className="min-w-0">
                              <span className="line-clamp-2 font-semibold leading-snug">
                                {product.name}
                                {product.plusSized === true ? (
                                  <span className="ml-1.5 inline-block bg-ink px-1 align-[2px] font-tag text-[11px] font-bold uppercase leading-4 tracking-[0.06em] text-white">
                                    Plus
                                  </span>
                                ) : null}
                              </span>
                              <span className="block text-xs tracking-[0.04em] text-ink-3">{product.sku}</span>
                            </span>
                          </button>
                          <div className="col-span-2 row-start-2 xl:col-span-1 xl:col-start-2 xl:row-start-1">
                            {hasSizes ? (
                              <SizeGrid
                                sizes={product.sizes}
                                productName={product.name}
                                pickEmpty={addDirection === "IN"}
                                onPick={(size) => addToCart(product, size, addDirection)}
                              />
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={outDisabled}
                                onClick={() => addToCart(product, "", addDirection)}
                              >
                                <Plus className="h-4 w-4" aria-hidden="true" />
                                Adicionar
                              </Button>
                            )}
                          </div>
                          <PriceTag
                            value={product.salePrice}
                            className="col-start-2 row-start-1 justify-self-end text-2xl xl:col-start-3"
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <aside className="flex min-h-0 flex-col border-t-2 border-ink bg-paper lg:border-l-[1.5px] lg:border-t-0 lg:border-dashed lg:border-rule-strong" aria-label="Troca atual">
            <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-5">
              <h2 className="font-tag text-xl font-extrabold uppercase tracking-[0.04em]">Troca atual</h2>
              <button
                type="button"
                className="text-sm font-semibold text-denim hover:underline"
                onClick={() => setShowOptionalDetails((prev) => !prev)}
                aria-expanded={showOptionalDetails}
              >
                {showOptionalDetails ? "Ocultar cliente e observação" : "Cliente e observação"}
              </button>
            </div>

            {showOptionalDetails && (
              <div className="space-y-3 px-5 pb-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ex-customer">Cliente (opcional)</Label>
                  <Input id="ex-customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nome do cliente" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ex-notes">Observação</Label>
                  <Input id="ex-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: troca por tamanho" />
                </div>
              </div>
            )}

            {cart.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-10 text-center">
                <ArrowLeftRight className="h-8 w-8 text-ink-3/60" strokeWidth={1.5} aria-hidden="true" />
                <p className="font-semibold">Nenhuma peça na troca</p>
                <p className="max-w-[260px] text-sm text-ink-3">
                  Lance primeiro o que volta para a loja, depois troque o lado e lance o que sai.
                </p>
              </div>
            ) : (
              <>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5">
                  <div>
                    <div className="flex items-baseline justify-between border-b border-rule pb-1">
                      <p className="flex items-center gap-1.5 text-sm font-semibold">
                        <ArrowDownLeft className="h-4 w-4 text-verde" aria-hidden="true" />
                        Volta para a loja
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-verde">{formatCurrency(totalInValue)}</p>
                    </div>
                    {entryItems.length === 0 ? (
                      <p className="py-2 text-sm text-ink-3">Nenhuma peça voltando.</p>
                    ) : (
                      <ul>{renderLines(entryItems, "volta")}</ul>
                    )}
                  </div>

                  <div>
                    <div className="flex items-baseline justify-between border-b border-rule pb-1">
                      <p className="flex items-center gap-1.5 text-sm font-semibold">
                        <ArrowUpRight className="h-4 w-4 text-ink-2" aria-hidden="true" />
                        Sai com o cliente
                      </p>
                      <p className="text-sm font-semibold tabular-nums">{formatCurrency(totalOutValue)}</p>
                    </div>
                    {outputItems.length === 0 ? (
                      <p className="py-2 text-sm text-ink-3">Nenhuma peça saindo.</p>
                    ) : (
                      <ul>{renderLines(outputItems, "sai")}</ul>
                    )}
                  </div>
                </div>

                <div className="border-t-2 border-ink px-5 pb-5 pt-3">
                  {grossDifference > 0 && (
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <Label htmlFor="exchange-discount" className="font-medium text-ink-2">Desconto na troca</Label>
                      <Input
                        id="exchange-discount"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={discountAmount}
                        onChange={(e) => setDiscountAmount(e.target.value)}
                        placeholder="0,00"
                        className="h-9 w-28 text-right tabular-nums"
                      />
                    </div>
                  )}
                  {appliedDiscountAmount > 0 && (
                    <div className="flex justify-between text-sm font-medium text-verde">
                      <span>Desconto aplicado</span>
                      <span className="tabular-nums">−{formatCurrency(appliedDiscountAmount)}</span>
                    </div>
                  )}
                  {needsAdminForDiscount && (
                    <div className="mt-2 space-y-1.5">
                      <Label htmlFor="exchange-admin-password">Senha do administrador</Label>
                      <Input
                        id="exchange-admin-password"
                        type="password"
                        autoComplete="off"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                      />
                      <p className="text-xs text-ink-3">Desconto acima de 10% da diferença precisa de autorização.</p>
                    </div>
                  )}
                  <div className="mt-1 flex items-end justify-between gap-3 py-1">
                    <span className="pb-1 font-tag text-lg font-extrabold uppercase tracking-[0.06em]">
                      {totalDifference > 0 ? "Cliente paga" : totalDifference < 0 ? "A favor do cliente" : "Diferença"}
                    </span>
                    <PriceTag value={Math.abs(totalDifference)} className="text-[44px]" />
                  </div>

                  {totalDifference < 0 && (
                    <fieldset className="mt-2 space-y-1.5">
                      <legend className="text-sm font-medium text-ink">O valor a favor do cliente foi…</legend>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          ["cash", "Devolvido em dinheiro"],
                          ["none", "Não devolvido"],
                        ] as const).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={refundMode === value}
                            onClick={() => setRefundMode(value)}
                            className={cn(
                              "h-10 border-[1.5px] px-3 text-sm font-semibold transition-colors",
                              refundMode === value ? "border-ink bg-ink text-white" : "border-rule-strong bg-paper text-ink hover:border-ink"
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {refundMode === "cash" ? (
                        <p className="text-xs text-ink-3">Sai do dinheiro do caixa e entra no fechamento.</p>
                      ) : null}
                    </fieldset>
                  )}

                  {totalDifference > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <Label htmlFor="ex-pay">Forma de pagamento da diferença</Label>
                      <select
                        id="ex-pay"
                        className="h-10 w-full border border-input bg-paper px-3 text-sm text-ink focus-visible:border-denim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-denim"
                        value={differencePaymentMethod}
                        onChange={(e) => setDifferencePaymentMethod(e.target.value as ExchangePaymentMethod | "")}
                      >
                        <option value="">Selecione</option>
                        <option value="cash">Dinheiro</option>
                        <option value="pix">PIX</option>
                        <option value="debit">Débito</option>
                        <option value="credit">Crédito</option>
                      </select>
                    </div>
                  )}

                  <div className="mt-4 flex gap-2">
                    <Button variant="outline" onClick={clearCart}>
                      Limpar
                    </Button>
                    <Button size="lg" className="flex-1" onClick={registerExchange} disabled={processing}>
                      {processing ? "Registrando…" : "Registrar troca"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </aside>
        </div>
      </div>

      <section className="border border-rule bg-paper" aria-labelledby="recent-exchanges">
        <h2 id="recent-exchanges" className="border-b border-rule px-4 py-3 font-tag text-lg font-bold uppercase tracking-[0.04em]">
          Últimas trocas
        </h2>
          {loading ? (
            <div className="space-y-2 p-4" aria-hidden="true">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 animate-pulse bg-sub" />)}</div>
          ) : exchanges.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-ink-3">Nenhuma troca registrada</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead className="text-right">Voltou</TableHead>
                  <TableHead className="text-right">Saiu</TableHead>
                  <TableHead className="text-right">Desconto</TableHead>
                  <TableHead className="text-right">Diferença</TableHead>
                  <TableHead>Operador</TableHead>
                  <TableHead className="pr-4"><span className="sr-only">Caixa</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exchanges.map((exchange) => (
                  <TableRow key={exchange.id}>
                    <TableCell className="whitespace-nowrap pl-4 tabular-nums text-ink-2">{formatDate(new Date(exchange.createdAt))}</TableCell>
                    <TableCell>{exchange.customerName || "—"}</TableCell>
                    <TableCell className="text-ink-2">
                      {exchange.paymentMethod === "cash" && "Dinheiro"}
                      {exchange.paymentMethod === "pix" && "PIX"}
                      {exchange.paymentMethod === "debit" && "Débito"}
                      {exchange.paymentMethod === "credit" && "Crédito"}
                      {!exchange.paymentMethod && "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(exchange.totalInValue || 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(exchange.totalOutValue || 0)}</TableCell>
                    <TableCell className="text-right tabular-nums text-verde">{formatCurrency(exchange.discountAmount || 0)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(exchange.difference || 0)}</TableCell>
                    <TableCell className="text-ink-2">{exchange.createdByName || "—"}</TableCell>
                    <TableCell className="pr-4">
                      {exchange.difference > 0 && !exchange.addedToCashRegisterSales && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={addingToRegister === exchange.id}
                          onClick={() => handleAddToRegister(exchange.id)}
                        >
                          <Banknote className="h-4 w-4" aria-hidden="true" />
                          {addingToRegister === exchange.id ? "Incluindo…" : "Incluir no caixa"}
                        </Button>
                      )}
                      {exchange.addedToCashRegisterSales && (
                        <Badge variant="positive">No caixa</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </section>

      <Dialog open={!!selectedProduct} onOpenChange={() => setSelectedProduct(null)}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-4xl">
          {selectedProduct && (
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="flex items-center justify-center bg-sub p-6">
                <ProductPhoto
                  src={selectedProduct.image}
                  name={selectedProduct.name}
                  className="aspect-square h-auto w-full max-w-[360px]"
                  displaySize={360}
                />
              </div>
              <div className="flex flex-col p-6">
                <DialogHeader className="mb-1">
                  <DialogTitle className="font-sans text-xl font-bold normal-case tracking-normal">{selectedProduct.name}</DialogTitle>
                  <p className="text-sm text-ink-3">
                    {addDirection === "IN" ? "Escolha o tamanho que volta para a loja" : "Escolha o tamanho que sai com o cliente"}
                  </p>
                </DialogHeader>
                <PriceTag value={selectedProduct.salePrice} className="mt-2 text-[36px]" />
                <div className="mt-6 grid grid-cols-3 border-l-[1.5px] border-t-[1.5px] border-ink">
                  {selectedProduct.sizes?.map((sizeData) => {
                    const disabled = addDirection === "OUT" && sizeData.stock <= 0;
                    return (
                      <button
                        key={sizeData.size}
                        type="button"
                        disabled={disabled}
                        onClick={() => addToCart(selectedProduct, sizeData.size, addDirection)}
                        className={cn(
                          "flex h-[72px] flex-col items-center justify-center border-b-[1.5px] border-r-[1.5px] border-ink transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-denim",
                          disabled ? "cursor-not-allowed bg-sub text-ink-3/60" : "bg-paper text-ink hover:bg-denim hover:text-white"
                        )}
                      >
                        <span className="font-tag text-2xl font-bold leading-none">{sizeData.size}</span>
                        <span className="mt-1 text-xs font-semibold opacity-70">{sizeData.stock} em estoque</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

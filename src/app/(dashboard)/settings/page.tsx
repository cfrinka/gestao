"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPut, apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Save, Search, X, AlertTriangle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { discountSettingsSchema } from "@/domains/settings/discount-settings-schema";
import { PageHeader } from "@/components/layout/page-header";
import { currentMonthISO, todayISO } from "@/lib/dates";

interface Product {
  id: string;
  name: string;
  sku: string;
  salePrice: number;
  stock: number;
}

interface ProductDiscount {
  productId: string;
  discountPercent: number;
}

interface ProductDiscountSelectorProps {
  productDiscounts: ProductDiscount[];
  onChange: (productDiscounts: ProductDiscount[]) => void;
}

function ProductDiscountSelector({ productDiscounts, onChange }: ProductDiscountSelectorProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const data = await apiGet("/api/products");
      setProducts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching products:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter((product) =>
    product.name.toLowerCase().includes(search.toLowerCase()) ||
    product.sku.toLowerCase().includes(search.toLowerCase())
  );

  const addProductDiscount = (productId: string) => {
    const existing = productDiscounts.find(pd => pd.productId === productId);
    if (!existing) {
      onChange([...productDiscounts, { productId, discountPercent: 0 }]);
    }
  };

  const updateProductDiscount = (productId: string, discountPercent: number) => {
    onChange(
      productDiscounts.map(pd =>
        pd.productId === productId ? { ...pd, discountPercent } : pd
      )
    );
  };

  const removeProductDiscount = (productId: string) => {
    onChange(productDiscounts.filter(pd => pd.productId !== productId));
  };

  const getProduct = (productId: string) => products.find(p => p.id === productId);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Adicionar Produto</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" aria-hidden="true" />
          <Input
            placeholder="Buscar por nome ou código"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        {search && !loading && (
          <div className="max-h-40 overflow-y-auto border border-rule">
            {filteredProducts.length === 0 ? (
              <p className="text-center py-2 text-sm text-ink-3">Nenhum produto encontrado</p>
            ) : (
              filteredProducts.map((product) => {
                const hasDiscount = productDiscounts.some(pd => pd.productId === product.id);
                return (
                  <div
                    key={product.id}
                    className={`p-2 hover:bg-sub cursor-pointer flex justify-between items-center ${
                      hasDiscount ? "bg-sub" : ""
                    }`}
                    onClick={() => !hasDiscount && addProductDiscount(product.id)}
                  >
                    <div>
                      <p className="font-medium">{product.name}</p>
                      <p className="text-sm text-ink-3">{product.sku}</p>
                    </div>
                    {hasDiscount ? (
                      <span className="text-xs text-verde">Já adicionado</span>
                    ) : (
                      <Button size="sm" variant="outline">Adicionar</Button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {productDiscounts.length > 0 && (
        <div className="space-y-2">
          <Label>Produtos com Desconto</Label>
          <div className="space-y-2">
            {productDiscounts.map((pd) => {
              const product = getProduct(pd.productId);
              return (
                <div key={pd.productId} className="flex items-center gap-2 p-2 border rounded">
                  <div className="flex-1">
                    <p className="font-medium">{product?.name || "Produto não encontrado"}</p>
                    <p className="text-sm text-ink-3">{product?.sku}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={pd.discountPercent}
                      onChange={(e) => updateProductDiscount(pd.productId, parseFloat(e.target.value) || 0)}
                      className="w-16 text-right"
                    />
                    <span className="text-ink-3 text-sm">%</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeProductDiscount(pd.productId)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface DiscountSettings {
  pixDiscountEnabled: boolean;
  pixDiscountPercent: number;
  fixedDiscountEnabled: boolean;
  fixedDiscountPercent: number;
  progressiveDiscountEnabled: boolean;
  progressiveDiscount1Item: number;
  progressiveDiscount2Items: number;
  progressiveDiscount3PlusItems: number;
  progressiveDiscount4PlusItems: number;
  productDiscountsEnabled: boolean;
  productDiscounts: ProductDiscount[];
}

interface StoreSettings {
  storeName: string;
  address: string;
  phone: string;
  cnpj: string;
  footerMessage: string;
  exchangeDays: number;
  commissionPercent: number;
  discounts: DiscountSettings;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [billSaving, setBillSaving] = useState(false);
  const [settings, setSettings] = useState<StoreSettings>({
    storeName: "",
    address: "",
    phone: "",
    cnpj: "",
    footerMessage: "",
    exchangeDays: 10,
    commissionPercent: 3,
    discounts: {
      pixDiscountEnabled: false,
      pixDiscountPercent: 5,
      fixedDiscountEnabled: false,
      fixedDiscountPercent: 0,
      progressiveDiscountEnabled: false,
      progressiveDiscount1Item: 0,
      progressiveDiscount2Items: 0,
      progressiveDiscount3PlusItems: 40,
      progressiveDiscount4PlusItems: 60,
      productDiscountsEnabled: false,
      productDiscounts: [],
    },
  });

  const [billKind, setBillKind] = useState<"ONE_TIME" | "FIXED" | "INSTALLMENTS">("ONE_TIME");
  const [billName, setBillName] = useState("");
  const [billAmount, setBillAmount] = useState<string>("");
  const [billDueDate, setBillDueDate] = useState<string>(() => todayISO());
  const [billDayOfMonth, setBillDayOfMonth] = useState<string>("5");
  const [billMonthsAhead, setBillMonthsAhead] = useState<string>("12");
  const [billFirstDueDate, setBillFirstDueDate] = useState<string>(() => todayISO());
  const [billInstallmentsCount, setBillInstallmentsCount] = useState<string>("3");
  const [adminPassword, setAdminPassword] = useState<string>("");
  const [adminPasswordSaving, setAdminPasswordSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await apiGet("/api/settings");
      setSettings({
        storeName: data.storeName || "",
        address: data.address || "",
        phone: data.phone || "",
        cnpj: data.cnpj || "",
        footerMessage: data.footerMessage || "",
        exchangeDays: Number.isFinite(data.exchangeDays) ? data.exchangeDays : 10,
        commissionPercent: Number.isFinite(Number(data.commissionPercent)) ? Number(data.commissionPercent) : 3,
        discounts: {
          pixDiscountEnabled: data.discounts?.pixDiscountEnabled ?? false,
          pixDiscountPercent: data.discounts?.pixDiscountPercent ?? 5,
          fixedDiscountEnabled: data.discounts?.fixedDiscountEnabled ?? false,
          fixedDiscountPercent: data.discounts?.fixedDiscountPercent ?? 0,
          progressiveDiscountEnabled: data.discounts?.progressiveDiscountEnabled ?? false,
          progressiveDiscount1Item: data.discounts?.progressiveDiscount1Item ?? 0,
          progressiveDiscount2Items: data.discounts?.progressiveDiscount2Items ?? 0,
          progressiveDiscount3PlusItems: data.discounts?.progressiveDiscount3PlusItems ?? 40,
          progressiveDiscount4PlusItems: data.discounts?.progressiveDiscount4PlusItems ?? 60,
          productDiscountsEnabled: data.discounts?.productDiscountsEnabled ?? false,
          productDiscounts: data.discounts?.productDiscounts ?? [],
        },
      });
    } catch {
      toast({ title: "Erro ao carregar configurações", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const previewExchangeDeadline = new Date();
  previewExchangeDeadline.setDate(previewExchangeDeadline.getDate() + Math.max(0, Math.floor(settings.exchangeDays || 0)));
  const previewExchangeDeadlineStr = previewExchangeDeadline.toLocaleDateString("pt-BR");

  const handleCreateBill = async () => {
    const parsed = parseFloat(billAmount);
    if (!billName.trim()) {
      toast({ title: "Informe o nome da conta", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ title: "Informe um valor válido", variant: "destructive" });
      return;
    }

    setBillSaving(true);
    try {
      if (billKind === "ONE_TIME") {
        await apiPost("/api/bills", {
          kind: "ONE_TIME",
          name: billName.trim(),
          amount: parsed,
          dueDate: billDueDate,
        });
      }

      if (billKind === "FIXED") {
        await apiPost("/api/bills", {
          kind: "FIXED",
          name: billName.trim(),
          amount: parsed,
          dayOfMonth: parseInt(billDayOfMonth, 10),
          monthsAhead: parseInt(billMonthsAhead, 10),
          startMonth: currentMonthISO(),
        });
      }

      if (billKind === "INSTALLMENTS") {
        await apiPost("/api/bills", {
          kind: "INSTALLMENTS",
          name: billName.trim(),
          amount: parsed,
          firstDueDate: billFirstDueDate,
          installmentsCount: parseInt(billInstallmentsCount, 10),
          intervalMonths: 1,
        });
      }

      toast({ title: "Conta(s) criada(s)" });
      setBillName("");
      setBillAmount("");
    } catch (error) {
      toast({
        title: "Erro ao criar conta",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setBillSaving(false);
    }
  };

  const handleSave = async () => {
    const validation = discountSettingsSchema.safeParse(settings.discounts);
    if (!validation.success) {
      toast({
        title: "Configuração de desconto inválida",
        description: validation.error.issues[0]?.message || "Verifique os percentuais de desconto (0 a 100%).",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      await apiPut("/api/settings", settings);
      toast({ title: "Configurações salvas com sucesso!" });
    } catch {
      toast({ title: "Erro ao salvar configurações", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSetAdminPassword = async () => {
    if (!adminPassword.trim() || adminPassword.length < 4) {
      toast({ title: "A senha deve ter pelo menos 4 caracteres", variant: "destructive" });
      return;
    }

    setAdminPasswordSaving(true);
    try {
      await apiPost("/api/admin/set-password", { adminPassword: adminPassword.trim() });
      toast({ title: "Senha de administrador definida com sucesso!" });
      setAdminPassword("");
    } catch {
      toast({ title: "Erro ao definir senha", variant: "destructive" });
    } finally {
      setAdminPasswordSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p>Carregando configurações...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Configurações"
        meta={<span>Dados da loja, cupom, descontos e senha do administrador</span>}
        actions={
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4" aria-hidden="true" />
            {saving ? "Salvando…" : "Salvar configurações"}
          </Button>
        }
        className="mb-0 md:mb-0"
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dados da loja</CardTitle>
            <CardDescription>
              Informações que aparecem no cabeçalho do cupom
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="storeName">Nome da loja</Label>
              <Input
                id="storeName"
                value={settings.storeName}
                onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
                placeholder="Benê Brasil"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Endereço</Label>
              <Input
                id="address"
                value={settings.address}
                onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                placeholder="Rua Exemplo, 123 - Centro"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input
                id="phone"
                value={settings.phone}
                onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                placeholder="(11) 99999-9999"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cnpj">CNPJ</Label>
              <Input
                id="cnpj"
                value={settings.cnpj}
                onChange={(e) => setSettings({ ...settings, cnpj: e.target.value })}
                placeholder="00.000.000/0001-00"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cupom</CardTitle>
            <CardDescription>
              Personalize a mensagem do rodapé do cupom
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="footerMessage">Mensagem do rodapé</Label>
              <Textarea
                id="footerMessage"
                value={settings.footerMessage}
                onChange={(e) => setSettings({ ...settings, footerMessage: e.target.value })}
                placeholder="Obrigado pela preferência!&#10;Volte sempre!"
                rows={4}
              />
              <p className="text-xs text-ink-3">
                Use Enter para quebrar linhas
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="exchangeDays">Prazo de troca (dias corridos)</Label>
              <Input
                id="exchangeDays"
                type="number"
                min="0"
                max="365"
                value={settings.exchangeDays}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    exchangeDays: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                  })
                }
              />
              <p className="text-xs text-ink-3">
                Esse prazo sai impresso no comprovante de troca do PDV.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="commissionPercent">Comissão dos vendedores (%)</Label>
              <Input
                id="commissionPercent"
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.1"
                value={settings.commissionPercent}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    commissionPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                  })
                }
                className="w-28 tabular-nums"
              />
              <p className="text-xs text-ink-3">
                Usada na tela Comissão para todos os meses mostrados.
              </p>
            </div>

            <div className="bg-sub p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">Prévia do cupom</p>
              <div className="mx-auto max-w-[300px] border border-rule bg-paper p-3 font-mono text-xs shadow-[0_6px_16px_-10px_rgba(40,40,40,0.4)]">
                <div className="text-center border-b border-dashed pb-2 mb-2">
                  <p className="font-bold">{settings.storeName || "NOME DA LOJA"}</p>
                  {settings.address && <p>{settings.address}</p>}
                  {settings.phone && <p>Tel: {settings.phone}</p>}
                  {settings.cnpj && <p>CNPJ: {settings.cnpj}</p>}
                </div>
                <p className="text-center text-ink-3">... itens da venda ...</p>
                <div className="text-center border-t border-dashed pt-2 mt-2">
                  <p className="font-semibold">Comprovante para troca</p>
                  <p>Trocas em ate {Math.max(0, Math.floor(settings.exchangeDays || 0))} dias corridos</p>
                  <p>Valido ate: {previewExchangeDeadlineStr}</p>
                </div>
                <div className="text-center border-t border-dashed pt-2 mt-2">
                  {settings.footerMessage.split('\n').map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Descontos automáticos</CardTitle>
          <CardDescription>
            Configure descontos que serão aplicados automaticamente nas vendas
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4 border border-rule p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Desconto PIX</Label>
                <p className="text-sm text-ink-3">Aplica desconto em pagamentos via PIX</p>
              </div>
              <Checkbox
                checked={settings.discounts.pixDiscountEnabled}
                onCheckedChange={(checked) =>
                  setSettings({
                    ...settings,
                    discounts: { ...settings.discounts, pixDiscountEnabled: checked === true },
                  })
                }
              />
            </div>
            {settings.discounts.pixDiscountEnabled && (
              <div className="flex items-center gap-2 border-l border-rule-strong pl-4">
                <Label htmlFor="pixPercent" className="whitespace-nowrap">Porcentagem:</Label>
                <Input
                  id="pixPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={settings.discounts.pixDiscountPercent}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      discounts: { ...settings.discounts, pixDiscountPercent: parseFloat(e.target.value) || 0 },
                    })
                  }
                  className="w-24"
                />
                <span className="text-ink-3">%</span>
              </div>
            )}
          </div>

          <div className="space-y-4 border border-rule p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Desconto Fixo</Label>
                <p className="text-sm text-ink-3">Aplica um percentual fixo de desconto em todas as vendas</p>
              </div>
              <Checkbox
                checked={settings.discounts.fixedDiscountEnabled}
                onCheckedChange={(checked) =>
                  setSettings({
                    ...settings,
                    discounts: { ...settings.discounts, fixedDiscountEnabled: checked === true },
                  })
                }
              />
            </div>
            {settings.discounts.fixedDiscountEnabled && (
              <div className="flex items-center gap-2 border-l border-rule-strong pl-4">
                <Label htmlFor="fixedPercent" className="whitespace-nowrap">Porcentagem:</Label>
                <Input
                  id="fixedPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={settings.discounts.fixedDiscountPercent}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      discounts: { ...settings.discounts, fixedDiscountPercent: parseFloat(e.target.value) || 0 },
                    })
                  }
                  className="w-24"
                />
                <span className="text-ink-3">%</span>
              </div>
            )}
          </div>

          <div className="space-y-4 border border-rule p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Desconto Progressivo</Label>
                <p className="text-sm text-ink-3">Desconto baseado na quantidade de itens</p>
              </div>
              <Checkbox
                checked={settings.discounts.progressiveDiscountEnabled}
                onCheckedChange={(checked) =>
                  setSettings({
                    ...settings,
                    discounts: { ...settings.discounts, progressiveDiscountEnabled: checked === true },
                  })
                }
              />
            </div>
            {settings.discounts.progressiveDiscountEnabled && (
              <div className="space-y-3 border-l border-rule-strong pl-4">
                <div className="flex items-center gap-2">
                  <Label className="w-24 whitespace-nowrap">1 item:</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={settings.discounts.progressiveDiscount1Item}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        discounts: { ...settings.discounts, progressiveDiscount1Item: parseFloat(e.target.value) || 0 },
                      })
                    }
                    className="w-20"
                  />
                  <span className="text-ink-3">%</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-24 whitespace-nowrap">2 itens:</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={settings.discounts.progressiveDiscount2Items}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        discounts: { ...settings.discounts, progressiveDiscount2Items: parseFloat(e.target.value) || 0 },
                      })
                    }
                    className="w-20"
                  />
                  <span className="text-ink-3">%</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-24 whitespace-nowrap">3 itens:</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={settings.discounts.progressiveDiscount3PlusItems}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        discounts: { ...settings.discounts, progressiveDiscount3PlusItems: parseFloat(e.target.value) || 0 },
                      })
                    }
                    className="w-20"
                  />
                  <span className="text-ink-3">%</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-24 whitespace-nowrap">4+ itens:</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={settings.discounts.progressiveDiscount4PlusItems}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        discounts: { ...settings.discounts, progressiveDiscount4PlusItems: parseFloat(e.target.value) || 0 },
                      })
                    }
                    className="w-20"
                  />
                  <span className="text-ink-3">%</span>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 border border-rule p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Descontos por Produto</Label>
                <p className="text-sm text-ink-3">Configure descontos específicos para produtos selecionados</p>
              </div>
              <Checkbox
                checked={settings.discounts.productDiscountsEnabled}
                onCheckedChange={(checked) =>
                  setSettings({
                    ...settings,
                    discounts: { ...settings.discounts, productDiscountsEnabled: checked === true },
                  })
                }
              />
            </div>
            {settings.discounts.productDiscountsEnabled && (
              <ProductDiscountSelector
                productDiscounts={settings.discounts.productDiscounts}
                onChange={(productDiscounts) =>
                  setSettings({
                    ...settings,
                    discounts: { ...settings.discounts, productDiscounts },
                  })
                }
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contas da loja</CardTitle>
          <CardDescription>
            Cadastre contas fixas, avulsas e parceladas
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2 md:col-span-2">
              <Label>Nome</Label>
              <Input value={billName} onChange={(e) => setBillName(e.target.value)} placeholder="Ex: Aluguel" />
            </div>
            <div className="space-y-2">
              <Label>Valor</Label>
              <Input value={billAmount} onChange={(e) => setBillAmount(e.target.value)} type="number" step="0.01" />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <select
                className="h-10 w-full border border-input bg-paper px-3 text-sm text-ink focus-visible:border-denim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-denim"
                value={billKind}
                onChange={(e) => setBillKind(e.target.value as typeof billKind)}
              >
                <option value="ONE_TIME">Avulsa</option>
                <option value="FIXED">Fixa</option>
                <option value="INSTALLMENTS">Parcelada</option>
              </select>
            </div>
          </div>

          {billKind === "ONE_TIME" && (
            <div className="space-y-2">
              <Label>Vencimento</Label>
              <Input type="date" value={billDueDate} onChange={(e) => setBillDueDate(e.target.value)} />
            </div>
          )}

          {billKind === "FIXED" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Dia do vencimento</Label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  value={billDayOfMonth}
                  onChange={(e) => setBillDayOfMonth(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Meses à frente</Label>
                <Input
                  type="number"
                  min="1"
                  max="36"
                  value={billMonthsAhead}
                  onChange={(e) => setBillMonthsAhead(e.target.value)}
                />
              </div>
            </div>
          )}

          {billKind === "INSTALLMENTS" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>1º vencimento</Label>
                <Input
                  type="date"
                  value={billFirstDueDate}
                  onChange={(e) => setBillFirstDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Nº parcelas</Label>
                <Input
                  type="number"
                  min="1"
                  max="60"
                  value={billInstallmentsCount}
                  onChange={(e) => setBillInstallmentsCount(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleCreateBill} disabled={billSaving}>
              {billSaving ? "Salvando…" : "Adicionar Conta"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Senha do administrador</CardTitle>
          <CardDescription>
            Configure a senha para correções administrativas de débito e outras funções restritas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="flex gap-2 border border-rule bg-sub p-3 text-sm text-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-vermelho" aria-hidden="true" />
              <span>Esta senha autoriza correções de débito, descontos acima do limite do caixa e outras operações sensíveis.</span>
            </p>

            <div className="space-y-2">
              <Label htmlFor="adminPassword">Nova senha do administrador</Label>
              <Input
                id="adminPassword"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                autoComplete="new-password"
              />
              <p className="text-xs text-ink-3">
                A senha deve ter pelo menos 4 caracteres
              </p>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSetAdminPassword}
                disabled={adminPasswordSaving || !adminPassword.trim() || adminPassword.length < 4}
                variant="outline"
              >
                {adminPasswordSaving ? "Salvando…" : "Definir senha"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end border-t border-rule pt-4">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4" aria-hidden="true" />
          {saving ? "Salvando…" : "Salvar configurações"}
        </Button>
      </div>
    </div>
  );
}

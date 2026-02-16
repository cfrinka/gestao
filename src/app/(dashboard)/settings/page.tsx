"use client";

import { useState, useEffect } from "react";
import { apiGet, apiPut, apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Save, Store, Receipt, Percent } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

interface DiscountSettings {
  pixDiscountEnabled: boolean;
  pixDiscountPercent: number;
  fixedDiscountEnabled: boolean;
  fixedDiscountPercent: number;
  progressiveDiscountEnabled: boolean;
  progressiveDiscount1Item: number;
  progressiveDiscount2Items: number;
  progressiveDiscount3PlusItems: number;
}

interface StoreSettings {
  storeName: string;
  address: string;
  phone: string;
  cnpj: string;
  footerMessage: string;
  exchangeDays: number;
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
    discounts: {
      pixDiscountEnabled: false,
      pixDiscountPercent: 5,
      fixedDiscountEnabled: false,
      fixedDiscountPercent: 0,
      progressiveDiscountEnabled: false,
      progressiveDiscount1Item: 0,
      progressiveDiscount2Items: 0,
      progressiveDiscount3PlusItems: 0,
    },
  });

  const [billKind, setBillKind] = useState<"ONE_TIME" | "FIXED" | "INSTALLMENTS">("ONE_TIME");
  const [billName, setBillName] = useState("");
  const [billAmount, setBillAmount] = useState<string>("");
  const [billDueDate, setBillDueDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [billDayOfMonth, setBillDayOfMonth] = useState<string>("5");
  const [billMonthsAhead, setBillMonthsAhead] = useState<string>("12");
  const [billFirstDueDate, setBillFirstDueDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [billInstallmentsCount, setBillInstallmentsCount] = useState<string>("3");

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const data = await apiGet("/api/settings");
      setSettings({
        storeName: data.storeName || "",
        address: data.address || "",
        phone: data.phone || "",
        cnpj: data.cnpj || "",
        footerMessage: data.footerMessage || "",
        exchangeDays: Number.isFinite(data.exchangeDays) ? data.exchangeDays : 10,
        discounts: {
          pixDiscountEnabled: data.discounts?.pixDiscountEnabled ?? false,
          pixDiscountPercent: data.discounts?.pixDiscountPercent ?? 5,
          fixedDiscountEnabled: data.discounts?.fixedDiscountEnabled ?? false,
          fixedDiscountPercent: data.discounts?.fixedDiscountPercent ?? 0,
          progressiveDiscountEnabled: data.discounts?.progressiveDiscountEnabled ?? false,
          progressiveDiscount1Item: data.discounts?.progressiveDiscount1Item ?? 0,
          progressiveDiscount2Items: data.discounts?.progressiveDiscount2Items ?? 0,
          progressiveDiscount3PlusItems: data.discounts?.progressiveDiscount3PlusItems ?? 0,
        },
      });
    } catch (error) {
      toast({ title: "Erro ao carregar configurações", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

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
          startMonth: new Date().toISOString().slice(0, 7),
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
    setSaving(true);
    try {
      await apiPut("/api/settings", settings);
      toast({ title: "Configurações salvas com sucesso!" });
    } catch (error) {
      toast({ title: "Erro ao salvar configurações", variant: "destructive" });
    } finally {
      setSaving(false);
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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[#2A5473]">Configurações</h1>
        <p className="text-gray-500">Personalize as informações da sua loja</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-5 w-5 text-[#355444]" />
              Dados da Loja
            </CardTitle>
            <CardDescription>
              Informações que aparecem no cabeçalho do cupom
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="storeName">Nome da Loja</Label>
              <Input
                id="storeName"
                value={settings.storeName}
                onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
                placeholder="Minha Loja"
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
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-[#355444]" />
              Cupom Fiscal
            </CardTitle>
            <CardDescription>
              Personalize a mensagem do rodapé do cupom
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="footerMessage">Mensagem do Rodapé</Label>
              <Textarea
                id="footerMessage"
                value={settings.footerMessage}
                onChange={(e) => setSettings({ ...settings, footerMessage: e.target.value })}
                placeholder="Obrigado pela preferência!&#10;Volte sempre!"
                rows={4}
              />
              <p className="text-xs text-gray-500">
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
              <p className="text-xs text-gray-500">
                Esse prazo sera usado no comprovante para troca impresso no PDV.
              </p>
            </div>

            <div className="p-4 bg-gray-100 rounded-lg">
              <p className="text-xs text-gray-500 mb-2">Prévia do Cupom:</p>
              <div className="font-mono text-xs bg-white p-3 rounded border">
                <div className="text-center border-b border-dashed pb-2 mb-2">
                  <p className="font-bold">{settings.storeName || "NOME DA LOJA"}</p>
                  {settings.address && <p>{settings.address}</p>}
                  {settings.phone && <p>Tel: {settings.phone}</p>}
                  {settings.cnpj && <p>CNPJ: {settings.cnpj}</p>}
                </div>
                <p className="text-center text-gray-500">... itens da venda ...</p>
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
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5 text-[#355444]" />
            Descontos Automáticos
          </CardTitle>
          <CardDescription>
            Configure descontos que serão aplicados automaticamente nas vendas
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4 p-4 border rounded-lg">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Desconto PIX</Label>
                <p className="text-sm text-gray-500">Aplica desconto em pagamentos via PIX</p>
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
              <div className="flex items-center gap-2 pl-4 border-l-2 border-[#355444]">
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
                <span className="text-gray-500">%</span>
              </div>
            )}
          </div>

          <div className="space-y-4 p-4 border rounded-lg">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Desconto Fixo</Label>
                <p className="text-sm text-gray-500">Aplica um percentual fixo de desconto em todas as vendas</p>
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
              <div className="flex items-center gap-2 pl-4 border-l-2 border-[#355444]">
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
                <span className="text-gray-500">%</span>
              </div>
            )}
          </div>

          <div className="space-y-4 p-4 border rounded-lg">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Desconto Progressivo</Label>
                <p className="text-sm text-gray-500">Desconto baseado na quantidade de itens</p>
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
              <div className="space-y-3 pl-4 border-l-2 border-[#355444]">
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
                  <span className="text-gray-500">%</span>
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
                  <span className="text-gray-500">%</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-24 whitespace-nowrap">3+ itens:</Label>
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
                  <span className="text-gray-500">%</span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-[#355444]" />
            Contas da Loja
          </CardTitle>
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
                className="w-full p-2 border rounded-md"
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
              {billSaving ? "Salvando..." : "Adicionar Conta"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="bg-[#2A5473] hover:bg-[#2A5473]/90">
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Salvando..." : "Salvar Configurações"}
        </Button>
      </div>
    </div>
  );
}

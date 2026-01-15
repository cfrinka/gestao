"use client";

import { useState, useEffect } from "react";
import { apiGet, apiPut } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Save, Store, Receipt } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface StoreSettings {
  storeName: string;
  address: string;
  phone: string;
  cnpj: string;
  footerMessage: string;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<StoreSettings>({
    storeName: "",
    address: "",
    phone: "",
    cnpj: "",
    footerMessage: "",
  });

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
      });
    } catch (error) {
      toast({ title: "Erro ao carregar configurações", variant: "destructive" });
    } finally {
      setLoading(false);
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
                  {settings.footerMessage.split('\n').map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="bg-[#2A5473] hover:bg-[#2A5473]/90">
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Salvando..." : "Salvar Configurações"}
        </Button>
      </div>
    </div>
  );
}

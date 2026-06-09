"use client";

import { useState, useEffect } from "react";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Save, Search, Tags, RefreshCw, ImageIcon, ImageOff, Printer, Upload, Loader2 } from "lucide-react";

const PRODUCT_CATEGORIES = [
  "Blusas",
  "Regatas",
  "Camisetas",
  "Shorts",
  "Calças",
  "Saias",
  "Conjuntos",
] as const;

interface Product {
  id: string;
  name: string;
  sku: string;
  category?: string;
  imageSource?: "uploaded" | "random" | "none";
}

export default function BulkCategoryPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [uploadingProductId, setUploadingProductId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterNoPhoto, setFilterNoPhoto] = useState(false);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [originalCategories, setOriginalCategories] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const data = await apiGet("/api/products");
      if (Array.isArray(data)) {
        setProducts(data);
        const cats: Record<string, string> = {};
        for (const p of data) {
          cats[p.id] = p.category || "";
        }
        setCategories(cats);
        setOriginalCategories({ ...cats });
      }
    } catch {
      toast({ title: "Erro ao carregar produtos", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const changedProducts = products.filter(
    (p) => categories[p.id] !== originalCategories[p.id]
  );

  const handleSave = async () => {
    if (changedProducts.length === 0) {
      toast({ title: "Nenhuma alteração para salvar" });
      return;
    }

    setSaving(true);
    try {
      const updates = changedProducts.map((p) => ({
        id: p.id,
        category: categories[p.id] || "",
      }));

      await apiPatch("/api/products/bulk-category", { updates });

      toast({ title: `${updates.length} produto(s) atualizado(s)!` });
      setOriginalCategories({ ...categories });
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSyncImageSource = async () => {
    setSyncing(true);
    try {
      const result = await apiPost("/api/products/sync-image-source", {});
      toast({ title: `Sincronizado! ${result.updated} de ${result.total} produtos atualizados.` });
      fetchProducts();
    } catch {
      toast({ title: "Erro ao sincronizar", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const setBulkCategory = (category: string) => {
    const filtered = filteredProducts;
    const newCats = { ...categories };
    for (const p of filtered) {
      newCats[p.id] = category;
    }
    setCategories(newCats);
  };

  const handleImageUpload = async (productId: string, file: File) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      toast({ title: "Tipo inválido", description: "Use JPEG, PNG, WebP ou GIF", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "Máximo 5MB", variant: "destructive" });
      return;
    }

    setUploadingProductId(productId);
    try {
      const { auth } = await import("@/lib/firebase");
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Não autenticado");

      const formDataUpload = new FormData();
      formDataUpload.append("file", file);
      formDataUpload.append("productId", productId);

      const response = await fetch("/api/images/upload", {
        method: "POST",
        body: formDataUpload,
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Erro ao fazer upload");
      }

      const data = await response.json();
      if (data?.url) {
        // Update the product with the new image and imageSource
        const { apiPut } = await import("@/lib/api-client");
        await apiPut(`/api/products/${productId}`, { image: data.url, imageSource: "uploaded" });
        toast({ title: "Foto enviada!" });
        fetchProducts();
      }
    } catch (error) {
      toast({
        title: "Erro ao enviar imagem",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setUploadingProductId(null);
    }
  };

  const handlePrint = () => {
    const names = filteredProducts.map((p) => p.name);
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>Lista de Produtos</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { font-size: 16px; margin-bottom: 10px; }
        ul { padding-left: 20px; }
        li { font-size: 14px; line-height: 1.8; }
      </style></head><body>
      <h1>Lista de Produtos (${names.length})</h1>
      <ul>${names.map((n) => `<li>${n}</li>`).join("")}</ul>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const normalizedSearch = search.trim().toLowerCase();
  const filteredProducts = products.filter((p) => {
    if (normalizedSearch) {
      const matchesSearch =
        p.name.toLowerCase().includes(normalizedSearch) ||
        p.sku.toLowerCase().includes(normalizedSearch);
      if (!matchesSearch) return false;
    }
    if (filterNoPhoto && p.imageSource === "uploaded") return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Categorizar Produtos</h1>
          <p className="text-gray-500 text-sm">Atribua categorias em massa</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint} disabled={filteredProducts.length === 0}>
            <Printer className="h-4 w-4 mr-1" />
            Imprimir ({filteredProducts.length})
          </Button>
          <Button variant="outline" size="sm" onClick={handleSyncImageSource} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando..." : "Sync Imagens"}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || changedProducts.length === 0}>
            <Save className="h-4 w-4 mr-1" />
            {saving ? "Salvando..." : `Salvar (${changedProducts.length})`}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="space-y-3">
            <CardTitle className="flex items-center gap-2">
              <Tags className="h-5 w-5" />
              Produtos ({filteredProducts.length})
            </CardTitle>
            <div className="flex gap-2 w-full">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome ou SKU..."
                  className="pl-10"
                />
              </div>
              <Button
                variant={filterNoPhoto ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterNoPhoto(!filterNoPhoto)}
                className="whitespace-nowrap"
              >
                <ImageOff className="h-4 w-4 mr-1" />
                Sem foto
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="text-sm text-gray-500 mr-1 self-center">Aplicar a todos visíveis:</span>
            {PRODUCT_CATEGORIES.map((cat) => (
              <Button
                key={cat}
                variant="outline"
                size="sm"
                onClick={() => setBulkCategory(cat)}
              >
                {cat}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setBulkCategory("")}
              className="text-red-500"
            >
              Limpar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-4">Carregando...</p>
          ) : filteredProducts.length === 0 ? (
            <p className="text-center py-4 text-gray-500">Nenhum produto encontrado</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto space-y-1">
              {filteredProducts.map((product) => {
                const changed = categories[product.id] !== originalCategories[product.id];
                return (
                  <div
                    key={product.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md ${
                      changed ? "bg-yellow-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex-shrink-0" title={
                      product.imageSource === "uploaded" ? "Foto enviada" :
                      product.imageSource === "random" ? "Imagem aleatória" :
                      "Sem imagem"
                    }>
                      {product.imageSource === "uploaded" ? (
                        <ImageIcon className="h-4 w-4 text-green-600" />
                      ) : product.imageSource === "random" ? (
                        <ImageIcon className="h-4 w-4 text-orange-500" />
                      ) : (
                        <ImageOff className="h-4 w-4 text-gray-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{product.name}</p>
                    </div>
                    <select
                      value={categories[product.id] || ""}
                      onChange={(e) =>
                        setCategories({ ...categories, [product.id]: e.target.value })
                      }
                      className="flex-shrink-0 h-9 w-28 sm:w-40 rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Sem categoria</option>
                      {PRODUCT_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                    <div className="flex-shrink-0">
                      <input
                        type="file"
                        id={`upload-${product.id}`}
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleImageUpload(product.id, file);
                          e.target.value = "";
                        }}
                        className="hidden"
                        disabled={uploadingProductId === product.id}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={uploadingProductId === product.id}
                        onClick={() => document.getElementById(`upload-${product.id}`)?.click()}
                        title="Enviar foto"
                      >
                        {uploadingProductId === product.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

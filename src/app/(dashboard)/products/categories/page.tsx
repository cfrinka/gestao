"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Save, Search, RefreshCw, ImageIcon, ImageOff, Printer, Upload, Loader2 } from "lucide-react";
import { useProductCategories, withCurrentCategory } from "@/lib/use-product-categories";
import { PageHeader } from "@/components/layout/page-header";

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
  const productCategories = useProductCategories();

  const fetchProducts = useCallback(async () => {
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
  }, [toast]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

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
    <div>
      <PageHeader
        title="Categorias"
        meta={<span>Atribua categorias a vários produtos de uma vez</span>}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={filteredProducts.length === 0}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              Imprimir lista · {filteredProducts.length}
            </Button>
            <Button variant="outline" size="sm" onClick={handleSyncImageSource} disabled={syncing}>
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
              {syncing ? "Sincronizando…" : "Sincronizar fotos"}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || changedProducts.length === 0}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {saving ? "Salvando…" : changedProducts.length > 0 ? `Salvar ${changedProducts.length} ${changedProducts.length === 1 ? "alteração" : "alterações"}` : "Salvar"}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" aria-hidden="true" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou código"
                aria-label="Buscar produto"
                className="pl-9"
              />
            </div>
            <Button
              variant={filterNoPhoto ? "default" : "outline"}
              aria-pressed={filterNoPhoto}
              onClick={() => setFilterNoPhoto(!filterNoPhoto)}
              className="whitespace-nowrap"
            >
              <ImageOff className="h-4 w-4" aria-hidden="true" />
              Só sem foto
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-sm text-ink-2">
              Aplicar aos {filteredProducts.length} visíveis:
            </span>
            {productCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setBulkCategory(cat)}
                className="inline-flex h-8 items-center border border-rule-strong bg-paper px-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink"
              >
                {cat}
              </button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setBulkCategory("")}
              className="text-vermelho hover:bg-vermelho-tint"
            >
              Tirar categoria
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-1" aria-hidden="true">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-11 animate-pulse bg-sub" />)}</div>
          ) : filteredProducts.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-3">Nenhum produto encontrado</p>
          ) : (
            <div className="max-h-[60vh] divide-y divide-rule overflow-y-auto border-y border-rule">
              {filteredProducts.map((product) => {
                const changed = categories[product.id] !== originalCategories[product.id];
                return (
                  <div
                    key={product.id}
                    className={`flex items-center gap-2 px-2 py-1.5 ${
                      changed ? "bg-denim-tint" : "hover:bg-sub"
                    }`}
                  >
                    <div className="flex-shrink-0" title={
                      product.imageSource === "uploaded" ? "Foto enviada" :
                      product.imageSource === "random" ? "Imagem aleatória" :
                      "Sem imagem"
                    }>
                      {product.imageSource === "uploaded" ? (
                        <ImageIcon className="h-4 w-4 text-verde" aria-label="Foto enviada" />
                      ) : product.imageSource === "random" ? (
                        <ImageIcon className="h-4 w-4 text-ink-3" aria-label="Imagem aleatória" />
                      ) : (
                        <ImageOff className="h-4 w-4 text-ink-3/60" aria-label="Sem imagem" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-semibold">{product.name}{changed ? <span className="ml-2 text-xs font-semibold text-denim">alterado</span> : null}</p>
                    </div>
                    <select
                      value={categories[product.id] || ""}
                      onChange={(e) =>
                        setCategories({ ...categories, [product.id]: e.target.value })
                      }
                      aria-label={`Categoria de ${product.name}`}
                      className="h-10 w-full border border-input bg-paper px-3 text-sm text-ink focus-visible:border-denim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-denim h-9 w-32 flex-shrink-0 px-2 sm:w-44"
                    >
                      <option value="">Sem categoria</option>
                      {withCurrentCategory(productCategories, categories[product.id]).map((cat) => (
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
                        className="h-9 w-9"
                        disabled={uploadingProductId === product.id}
                        onClick={() => document.getElementById(`upload-${product.id}`)?.click()}
                        title="Enviar foto"
                        aria-label={`Enviar foto de ${product.name}`}
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

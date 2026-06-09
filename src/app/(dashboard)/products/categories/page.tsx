"use client";

import { useState, useEffect } from "react";
import { apiGet, apiPatch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Save, Search, Tags } from "lucide-react";

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
}

export default function BulkCategoryPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
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

  const setBulkCategory = (category: string) => {
    const filtered = filteredProducts;
    const newCats = { ...categories };
    for (const p of filtered) {
      newCats[p.id] = category;
    }
    setCategories(newCats);
  };

  const normalizedSearch = search.trim().toLowerCase();
  const filteredProducts = normalizedSearch
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(normalizedSearch) ||
          p.sku.toLowerCase().includes(normalizedSearch)
      )
    : products;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Categorizar Produtos</h1>
          <p className="text-gray-500">Atribua categorias em massa aos seus produtos</p>
        </div>
        <Button onClick={handleSave} disabled={saving || changedProducts.length === 0}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Salvando..." : `Salvar (${changedProducts.length})`}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
            <CardTitle className="flex items-center gap-2">
              <Tags className="h-5 w-5" />
              Produtos ({filteredProducts.length})
            </CardTitle>
            <div className="flex gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome ou SKU..."
                  className="pl-10"
                />
              </div>
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
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr,200px] gap-4 px-3 py-2 text-sm font-medium text-gray-500 border-b">
                <span>Produto</span>
                <span>Categoria</span>
              </div>
              <div className="max-h-[60vh] overflow-y-auto">
                {filteredProducts.map((product) => {
                  const changed = categories[product.id] !== originalCategories[product.id];
                  return (
                    <div
                      key={product.id}
                      className={`grid grid-cols-[1fr,200px] gap-4 px-3 py-2 items-center rounded-md ${
                        changed ? "bg-yellow-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{product.name}</p>
                        <p className="text-xs text-gray-400">{product.sku}</p>
                      </div>
                      <select
                        value={categories[product.id] || ""}
                        onChange={(e) =>
                          setCategories({ ...categories, [product.id]: e.target.value })
                        }
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">Sem categoria</option>
                        {PRODUCT_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

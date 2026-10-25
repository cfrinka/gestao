"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { cn, formatCurrency, generateSku } from "@/lib/utils";
import { Plus, Pencil, Trash2, RefreshCw, Upload, Loader2, Download, Search } from "lucide-react";
import type { ProductSizeType } from "@/lib/db-types";
import { useProductCategories, withCurrentCategory } from "@/lib/use-product-categories";
import { PageHeader } from "@/components/layout/page-header";
import { ProductPhoto } from "@/components/etiqueta/product-photo";
import { PriceTag } from "@/components/etiqueta/price-tag";
import { LOW_STOCK, SizeGrid } from "@/components/etiqueta/size-grid";
import { TagHeader, TagRow } from "@/components/etiqueta/tag-row";

interface ProductSize {
  size: string;
  stock: number;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  plusSized?: boolean;
  sizeType?: ProductSizeType;
  category?: string;
  costPrice: number;
  salePrice: number;
  stock: number;
  sizes: ProductSize[];
  image?: string;
  imageSource?: "uploaded" | "random" | "none";
}

const DEFAULT_SIZES = ["TU", "P", "M", "G", "GG", "XG"];
const PLUS_SIZES = ["GG", "XG", "G1", "G2", "G3"];
const NUMERIC_SIZES = ["36", "38", "40", "42", "44", "46", "48"];
const MARKUP_MULTIPLIER = 2.8;

function getSizeGrid(sizeType: ProductSizeType, plusSized: boolean): string[] {
  if (sizeType === "numeric") return NUMERIC_SIZES;
  return plusSized ? PLUS_SIZES : DEFAULT_SIZES;
}

function normalizeSizeLabel(value: string): string {
  return value.trim().toUpperCase() === "PP" ? "TU" : value;
}

function normalizeProductSizes(sizes: ProductSize[]): ProductSize[] {
  const bySize = new Map<string, number>();

  for (const sizeEntry of sizes || []) {
    const normalizedSize = normalizeSizeLabel(String(sizeEntry.size || "").trim());
    if (!normalizedSize) continue;
    const previous = bySize.get(normalizedSize) ?? 0;
    bySize.set(normalizedSize, previous + Number(sizeEntry.stock || 0));
  }

  const preferredOrder = ["TU", "P", "M", "G", "GG", "XG", "G1", "G2", "G3", ...NUMERIC_SIZES];
  const ordered: ProductSize[] = [];

  for (const size of preferredOrder) {
    const stock = bySize.get(size);
    if (stock !== undefined) {
      ordered.push({ size, stock });
      bySize.delete(size);
    }
  }

  for (const [size, stock] of Array.from(bySize.entries())) {
    ordered.push({ size, stock });
  }

  return ordered;
}

export default function ProductsPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const productCategories = useProductCategories();
  const [formData, setFormData] = useState({
    name: "",
    sku: "",
    plusSized: false,
    sizeType: "letter" as ProductSizeType,
    category: "",
    costPrice: "",
    salePrice: "",
    stock: "0",
    sizes: DEFAULT_SIZES.map(size => ({ size, stock: 0 })),
    image: "",
    imageSource: "none" as "uploaded" | "random" | "none",
  });

  useEffect(() => {
    if (editingProduct) return;
    const expected = getSizeGrid(formData.sizeType, formData.plusSized);
    const sameShape =
      Array.isArray(formData.sizes) &&
      formData.sizes.length === expected.length &&
      formData.sizes.every((s, i) => s.size === expected[i]);
    if (sameShape) return;

    setFormData((prev) => ({
      ...prev,
      sizes: expected.map((size) => ({ size, stock: 0 })),
      stock: "0",
    }));
  }, [formData.sizeType, formData.plusSized, editingProduct]);

  const fetchProducts = useCallback(async () => {
    try {
      const data = await apiGet("/api/products");
      if (Array.isArray(data)) {
        const normalizedProducts = data.map((product) => ({
          ...product,
          sizes: normalizeProductSizes(Array.isArray(product.sizes) ? product.sizes : []),
        }));
        setProducts(normalizedProducts);
      } else {
        console.error("Error fetching products:", data);
        setProducts([]);
      }
    } catch {
      toast({ title: "Erro ao carregar produtos", variant: "destructive" });
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const payload = { ...formData, idempotencyKey: crypto.randomUUID() };
      if (editingProduct) {
        await apiPut(`/api/products/${editingProduct.id}`, payload);
      } else {
        await apiPost("/api/products", payload);
      }

      toast({
        title: editingProduct ? "Produto atualizado!" : "Produto criado!",
      });
      setDialogOpen(false);
      resetForm();
      fetchProducts();
    } catch (error) {
      toast({
        title: "Erro",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este produto?")) return;

    try {
      await apiDelete(`/api/products/${id}`);
      toast({ title: "Produto excluído!" });
      fetchProducts();
    } catch {
      toast({ title: "Erro ao excluir produto", variant: "destructive" });
    }
  };

  const handleEdit = (product: Product) => {
    const sizeType: ProductSizeType = product.sizeType === "numeric" ? "numeric" : "letter";
    setEditingProduct(product);
    setFormData({
      name: product.name,
      sku: product.sku,
      plusSized: product.plusSized === true,
      sizeType,
      category: product.category || "",
      costPrice: product.costPrice.toString(),
      salePrice: product.salePrice.toString(),
      stock: product.stock.toString(),
      sizes: product.sizes?.length > 0
        ? normalizeProductSizes(product.sizes)
        : getSizeGrid(sizeType, product.plusSized === true).map(size => ({ size, stock: 0 })),
      image: product.image || "",
      imageSource: product.imageSource || "none",
    });
    setDialogOpen(true);
  };

  const resetForm = () => {
    setEditingProduct(null);
    setFormData({
      name: "",
      sku: "",
      plusSized: false,
      sizeType: "letter",
      category: "",
      costPrice: "",
      salePrice: "",
      stock: "0",
      sizes: DEFAULT_SIZES.map(size => ({ size, stock: 0 })),
      image: "",
      imageSource: "none",
    });
  };

  const updateSizeStock = (sizeIndex: number, stock: number) => {
    const newSizes = [...formData.sizes];
    newSizes[sizeIndex] = { ...newSizes[sizeIndex], stock };
    const totalStock = newSizes.reduce((sum, s) => sum + s.stock, 0);
    setFormData({ ...formData, sizes: newSizes, stock: totalStock.toString() });
  };

  const changeSizeType = (sizeType: ProductSizeType) => {
    if (sizeType === formData.sizeType) return;
    // Letter and numeric grids share no labels, so switching discards the current per-size stock.
    if (editingProduct && Number(formData.stock) > 0 && !confirm("Trocar a grade vai zerar o estoque atual deste produto. Continuar?")) return;
    setFormData({
      ...formData,
      sizeType,
      sizes: getSizeGrid(sizeType, formData.plusSized).map(size => ({ size, stock: 0 })),
      stock: "0",
    });
  };

  const openNewDialog = () => {
    resetForm();
    setFormData(prev => ({ ...prev, sku: generateSku() }));
    setDialogOpen(true);
  };

  const fetchRandomImage = async () => {
    try {
      const query = formData.name || "fashion clothing";
      const response = await apiGet(`/api/images/random?query=${encodeURIComponent(query)}`);
      if (response?.url) {
        setFormData(prev => ({ ...prev, image: response.url, imageSource: "random" }));
      }
    } catch {
      toast({ title: "Erro ao buscar imagem", variant: "destructive" });
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      toast({ title: "Tipo de arquivo inválido", description: "Use JPEG, PNG, WebP ou GIF", variant: "destructive" });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "Máximo 5MB", variant: "destructive" });
      return;
    }

    setUploadingImage(true);
    try {
      const { auth } = await import("@/lib/firebase");
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        throw new Error("Não autenticado");
      }

      const formDataUpload = new FormData();
      formDataUpload.append("file", file);
      if (editingProduct?.id) {
        formDataUpload.append("productId", editingProduct.id);
      }

      const response = await fetch("/api/images/upload", {
        method: "POST",
        body: formDataUpload,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Erro ao fazer upload");
      }

      const data = await response.json();
      if (data?.url) {
        setFormData(prev => ({ ...prev, image: data.url, imageSource: "uploaded" }));
        toast({ title: "Imagem enviada com sucesso!" });
      }
    } catch (error) {
      toast({
        title: "Erro ao enviar imagem",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive"
      });
    } finally {
      setUploadingImage(false);
      // Reset input
      e.target.value = "";
    }
  };

  const handleDownloadJson = async () => {
    try {
      const data = await apiGet("/api/products");
      if (Array.isArray(data)) {
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `products-${new Date().toISOString().split("T")[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast({ title: "Produtos exportados com sucesso!" });
      }
    } catch {
      toast({ title: "Erro ao exportar produtos", variant: "destructive" });
    }
  };

  const normalizedSearch = search.trim().toLowerCase();
  const filteredProducts = normalizedSearch
    ? products.filter((p) => {
        const name = (p.name || "").toLowerCase();
        const sku = (p.sku || "").toLowerCase();
        return name.includes(normalizedSearch) || sku.includes(normalizedSearch);
      })
    : products;

  const totalPieces = products.reduce((sum, p) => sum + (p.stock || 0), 0);

  return (
    <div>
      <PageHeader
        title="Produtos"
        meta={
          !loading ? (
            <span>
              <b className="font-semibold text-ink">{products.length}</b> produtos ·{" "}
              <b className="font-semibold text-ink">{totalPieces}</b> peças em estoque
            </span>
          ) : null
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleDownloadJson}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Exportar JSON
            </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openNewDialog}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Novo produto
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {editingProduct ? "Editar produto" : "Novo produto"}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sku">Código (SKU)</Label>
                  <Input
                    id="sku"
                    value={formData.sku}
                    readOnly
                    className="bg-sub font-medium tracking-[0.04em]"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="category">Categoria</Label>
                  <select
                    id="category"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="flex h-10 w-full border border-input bg-paper px-3 py-2 text-sm text-ink focus-visible:border-denim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-denim"
                  >
                    <option value="">Sem categoria</option>
                    {withCurrentCategory(productCategories, formData.category).map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex h-10 cursor-pointer items-center gap-2.5 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={formData.plusSized}
                      onChange={(e) => setFormData({ ...formData, plusSized: e.target.checked })}
                      className="h-[18px] w-[18px] accent-[hsl(var(--denim))]"
                    />
                    Plus size
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="costPrice">Preço de custo</Label>
                  <Input
                    id="costPrice"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={formData.costPrice}
                    onChange={(e) => {
                      const nextCostPrice = e.target.value;

                      if (editingProduct) {
                        setFormData({ ...formData, costPrice: nextCostPrice });
                        return;
                      }

                      const numericCost = parseFloat(nextCostPrice);
                      const suggestedSalePrice = Number.isFinite(numericCost)
                        ? (numericCost * MARKUP_MULTIPLIER).toFixed(2)
                        : "";

                      setFormData({
                        ...formData,
                        costPrice: nextCostPrice,
                        salePrice: suggestedSalePrice,
                      });
                    }}
                    className="tabular-nums"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="salePrice">Preço de venda</Label>
                  <Input
                    id="salePrice"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={formData.salePrice}
                    onChange={(e) =>
                      setFormData({ ...formData, salePrice: e.target.value })
                    }
                    className="tabular-nums"
                    required
                  />
                  {!editingProduct ? (
                    <p className="text-xs text-ink-3">Sugerido: custo × {MARKUP_MULTIPLIER.toString().replace(".", ",")}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stock-total">Estoque total</Label>
                  <Input
                    id="stock-total"
                    type="number"
                    value={formData.stock}
                    disabled
                    className="bg-sub tabular-nums"
                  />
                </div>
              </div>

              <fieldset className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <legend className="text-sm font-semibold">
                    Estoque por {formData.sizeType === "numeric" ? "numeração" : "tamanho"}
                  </legend>
                  <div className="inline-flex border-[1.5px] border-ink" role="group" aria-label="Tipo de grade">
                    <button
                      type="button"
                      aria-pressed={formData.sizeType === "letter"}
                      onClick={() => changeSizeType("letter")}
                      className={cn(
                        "h-8 px-3 text-sm font-semibold transition-colors",
                        formData.sizeType === "letter" ? "bg-ink text-white" : "bg-paper text-ink hover:bg-sub"
                      )}
                    >
                      Letras
                    </button>
                    <button
                      type="button"
                      aria-pressed={formData.sizeType === "numeric"}
                      onClick={() => changeSizeType("numeric")}
                      className={cn(
                        "h-8 border-l-[1.5px] border-ink px-3 text-sm font-semibold transition-colors",
                        formData.sizeType === "numeric" ? "bg-ink text-white" : "bg-paper text-ink hover:bg-sub"
                      )}
                    >
                      Numeração
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap border-l-[1.5px] border-t-[1.5px] border-ink">
                  {formData.sizes.map((sizeData, index) => (
                    <label
                      key={sizeData.size}
                      className="flex w-[25%] min-w-[72px] flex-col border-b-[1.5px] border-r-[1.5px] border-ink sm:w-auto sm:flex-1"
                    >
                      <span className="bg-sub py-1 text-center font-tag text-lg font-bold leading-none">
                        {sizeData.size}
                      </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        aria-label={`Estoque do tamanho ${sizeData.size}`}
                        value={sizeData.stock}
                        onChange={(e) => updateSizeStock(index, parseInt(e.target.value) || 0)}
                        className="h-10 w-full bg-paper text-center text-base font-semibold tabular-nums focus:bg-denim-tint focus:outline-none"
                      />
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="space-y-2">
                <Label htmlFor="image-url">Foto do produto</Label>
                <div className="flex gap-2">
                  <Input
                    id="image-url"
                    placeholder="Endereço da imagem, ou envie um arquivo"
                    value={formData.image}
                    onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                    className="flex-1"
                  />
                  <input
                    type="file"
                    id="image-upload"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleImageUpload}
                    className="hidden"
                    disabled={uploadingImage}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => document.getElementById("image-upload")?.click()}
                    disabled={uploadingImage}
                    title="Enviar foto"
                    aria-label="Enviar foto"
                  >
                    {uploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={fetchRandomImage}
                    title="Gerar imagem aleatória"
                    aria-label="Gerar imagem aleatória"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                {formData.image && (
                  <div className="relative mt-2 h-24 w-24 overflow-hidden border border-rule bg-sub">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={formData.image}
                      alt="Prévia da foto"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-rule pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit">
                  {editingProduct ? "Salvar alterações" : "Cadastrar produto"}
                </Button>
              </div>
            </form>
            </DialogContent>
          </Dialog>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou código"
            aria-label="Buscar produto"
            className="pl-9"
          />
        </div>
        {normalizedSearch ? (
          <p className="text-sm text-ink-3">
            {filteredProducts.length} de {products.length} produtos
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex h-16 items-center gap-3 border border-rule bg-paper px-4">
              <div className="h-11 w-11 animate-pulse bg-sub" />
              <div className="h-3 w-48 animate-pulse bg-sub" />
            </div>
          ))}
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="border border-rule bg-paper px-6 py-14 text-center">
          <p className="font-semibold text-ink">
            {normalizedSearch ? `Nenhum produto com “${search.trim()}”` : "Nenhum produto cadastrado"}
          </p>
          <p className="mt-1 text-sm text-ink-3">
            {normalizedSearch
              ? "Confira o nome ou o código e tente de novo."
              : "Cadastre o primeiro produto com o botão Novo produto."}
          </p>
        </div>
      ) : (
        <>
          <TagHeader className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_262px_116px_96px_56px_84px] lg:gap-x-4">
            <span>Produto</span>
            <span>Tamanhos · estoque</span>
            <span className="text-right">Venda</span>
            <span className="text-right">Custo</span>
            <span className="text-right">Peças</span>
            <span />
          </TagHeader>
          <ul className="space-y-2">
            {filteredProducts.map((product) => (
              <li key={product.id}>
                <TagRow className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 lg:grid-cols-[minmax(0,1fr)_262px_116px_96px_56px_84px]">
                  <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-3">
                    <ProductPhoto src={product.image} name={product.name} className="h-12 w-12" />
                    <div className="min-w-0">
                      <p className="line-clamp-2 font-semibold leading-snug">{product.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                        <span className="tracking-[0.04em]">{product.sku}</span>
                        {product.category ? <Badge variant="secondary">{product.category}</Badge> : null}
                        {product.plusSized ? <Badge>Plus</Badge> : null}
                      </p>
                    </div>
                  </div>
                  <div className="col-span-2 row-start-2 lg:col-span-1 lg:col-start-2 lg:row-start-1">
                    {product.sizes?.length > 0 ? (
                      <SizeGrid sizes={product.sizes} size="sm" lowAt={LOW_STOCK} />
                    ) : (
                      <span className="text-sm text-ink-3">Sem grade</span>
                    )}
                  </div>
                  <div className="col-start-2 row-start-1 text-right lg:col-start-3">
                    <PriceTag value={product.salePrice} className="text-2xl" />
                  </div>
                  <p className="col-start-1 row-start-3 text-xs text-ink-3 lg:col-start-4 lg:row-start-1 lg:text-right lg:text-sm lg:text-ink-2">
                    <span className="lg:sr-only">Custo </span>
                    {formatCurrency(product.costPrice)}
                    <span className="lg:hidden">
                      {" · "}
                      <b className={cn("font-semibold", product.stock <= LOW_STOCK ? "text-vermelho" : "text-ink")}>{product.stock}</b> peças
                    </span>
                  </p>
                  <p className={cn("hidden text-right font-tag text-xl font-extrabold tabular-nums lg:col-start-5 lg:row-start-1 lg:block", product.stock <= LOW_STOCK ? "text-vermelho" : "text-ink")}>
                    <span className="sr-only">Peças em estoque: </span>
                    {product.stock}
                  </p>
                  <div className="col-start-2 row-start-3 flex justify-end gap-1 lg:col-start-6 lg:row-start-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${product.name}`}
                      onClick={() => handleEdit(product)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Excluir ${product.name}`}
                      className="hover:bg-vermelho-tint hover:text-vermelho"
                      onClick={() => handleDelete(product.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TagRow>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

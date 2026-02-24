"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ClipboardList, Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";

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
  difference: number;
  createdByName: string;
  createdAt: string;
}

export default function ExchangesPage() {
  const { toast } = useToast();
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
  const [differencePaymentMethod, setDifferencePaymentMethod] = useState<ExchangePaymentMethod | "">("");

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
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
  };

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
  const totalDifference = totalOutValue - totalInValue;

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

    setProcessing(true);
    try {
      const idempotencyKey = crypto.randomUUID();

      await apiPost("/api/exchanges", {
        customerName,
        notes,
        paymentMethod: totalDifference > 0 ? differencePaymentMethod : undefined,
        idempotencyKey,
        items: cart.map((item) => ({
          productId: item.product.id,
          size: item.size,
          quantity: item.quantity,
          direction: item.direction,
        })),
      });

      toast({ title: "Troca registrada com sucesso" });
      setCustomerName("");
      setNotes("");
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

  return (
    <div className="space-y-6">
      <div className="h-[calc(100vh-18rem)] min-h-[440px] flex gap-6">
        <div className="flex-1 flex flex-col">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Trocas</h1>
              <p className="text-gray-500">Operação de troca no estilo PDV</p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={addDirection === "IN" ? "default" : "outline"}
                onClick={() => setAddDirection("IN")}
              >
                Entrada
              </Button>
              <Button
                variant={addDirection === "OUT" ? "default" : "outline"}
                onClick={() => setAddDirection("OUT")}
              >
                Saída
              </Button>
            </div>
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Buscar produto por nome ou SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="text-center py-4">Carregando produtos...</p>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filteredProducts.map((product) => {
                  const outDisabled = addDirection === "OUT" && Number(product.stock || 0) <= 0;
                  return (
                    <Card
                      key={product.id}
                      className={`cursor-pointer transition-all hover:shadow-md ${outDisabled ? "opacity-50" : ""}`}
                      onClick={() => {
                        if (!outDisabled) handleProductClick(product);
                      }}
                    >
                      <CardContent className="p-4 relative">
                        {product.plusSized === true && (
                          <div className="absolute right-3 top-3">
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#355444] text-white">
                              PLUS
                            </span>
                          </div>
                        )}
                        <div className="flex flex-col">
                          <span className="font-medium text-sm truncate">{product.name}</span>
                          <span className="text-xs text-gray-500">{product.sku}</span>
                          <div className="flex justify-between items-center mt-2">
                            <span className="font-bold text-green-600">{formatCurrency(product.salePrice)}</span>
                            <span className="text-xs text-gray-400">Est: {product.stock}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <Card className="w-96 flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Troca atual
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            <Button
              type="button"
              variant="outline"
              className="mb-3"
              onClick={() => setShowOptionalDetails((prev) => !prev)}
            >
              {showOptionalDetails ? "Ocultar detalhes" : "Mais detalhes"}
            </Button>

            {showOptionalDetails && (
              <>
                <div className="space-y-2 mb-3">
                  <Label>Cliente (opcional)</Label>
                  <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nome do cliente" />
                </div>
                <div className="space-y-2 mb-4">
                  <Label>Observações</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex: Troca por tamanho" />
                </div>
              </>
            )}

            {cart.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-gray-400">Nenhum item na troca</div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-green-700">Entradas</p>
                      <p className="text-xs text-green-700">{formatCurrency(totalInValue)}</p>
                    </div>
                    {entryItems.length === 0 ? (
                      <p className="text-xs text-gray-400">Nenhum item de entrada</p>
                    ) : (
                      entryItems.map((item) => (
                        <div key={`${item.product.id}-${item.size}-${item.direction}`} className="flex items-center gap-2 p-2 bg-green-50 rounded-lg">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              {item.product.name}
                              {item.size && <span className="ml-1 text-blue-600">({item.size})</span>}
                            </p>
                            <p className="text-xs text-gray-500">Entrada • {formatCurrency(item.product.salePrice)}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQuantity(item.product.id, item.size, item.direction, -1)}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-8 text-center text-sm">{item.quantity}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQuantity(item.product.id, item.size, item.direction, 1)}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-500"
                              onClick={() => removeFromCart(item.product.id, item.size, item.direction)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-red-700">Saídas</p>
                      <p className="text-xs text-red-700">{formatCurrency(totalOutValue)}</p>
                    </div>
                    {outputItems.length === 0 ? (
                      <p className="text-xs text-gray-400">Nenhum item de saída</p>
                    ) : (
                      outputItems.map((item) => (
                        <div key={`${item.product.id}-${item.size}-${item.direction}`} className="flex items-center gap-2 p-2 bg-red-50 rounded-lg">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              {item.product.name}
                              {item.size && <span className="ml-1 text-blue-600">({item.size})</span>}
                            </p>
                            <p className="text-xs text-gray-500">Saída • {formatCurrency(item.product.salePrice)}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQuantity(item.product.id, item.size, item.direction, -1)}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-8 text-center text-sm">{item.quantity}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQuantity(item.product.id, item.size, item.direction, 1)}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-500"
                              onClick={() => removeFromCart(item.product.id, item.size, item.direction)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="space-y-1 text-sm border-t pt-3 mt-3">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total de entradas:</span>
                    <span className="text-green-600 font-medium">{formatCurrency(totalInValue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total de saídas:</span>
                    <span className="text-red-600 font-medium">{formatCurrency(totalOutValue)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold">
                    <span>Diferença:</span>
                    <span>{formatCurrency(totalDifference)}</span>
                  </div>
                </div>

                {totalDifference > 0 && (
                  <div className="space-y-2 mt-3">
                    <Label>Forma de pagamento da diferença</Label>
                    <select
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      value={differencePaymentMethod}
                      onChange={(e) => setDifferencePaymentMethod(e.target.value as ExchangePaymentMethod | "")}
                    >
                      <option value="">Selecione</option>
                      <option value="cash">Dinheiro</option>
                      <option value="pix">Pix</option>
                      <option value="debit">Débito</option>
                      <option value="credit">Crédito</option>
                    </select>
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  <Button variant="outline" className="flex-1" onClick={clearCart}>
                    Limpar
                  </Button>
                  <Button className="flex-1" onClick={registerExchange} disabled={processing}>
                    {processing ? "Registrando..." : "Registrar"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Últimas trocas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-4">Carregando...</p>
          ) : exchanges.length === 0 ? (
            <p className="text-center py-4 text-gray-500">Nenhuma troca registrada</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Pagamento Diferença</TableHead>
                  <TableHead className="text-right">Entradas</TableHead>
                  <TableHead className="text-right">Saídas</TableHead>
                  <TableHead className="text-right">Diferença</TableHead>
                  <TableHead>Operador</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exchanges.map((exchange) => (
                  <TableRow key={exchange.id}>
                    <TableCell>{formatDate(new Date(exchange.createdAt))}</TableCell>
                    <TableCell>{exchange.customerName || "-"}</TableCell>
                    <TableCell>
                      {exchange.paymentMethod === "cash" && "Dinheiro"}
                      {exchange.paymentMethod === "pix" && "Pix"}
                      {exchange.paymentMethod === "debit" && "Débito"}
                      {exchange.paymentMethod === "credit" && "Crédito"}
                      {!exchange.paymentMethod && "-"}
                    </TableCell>
                    <TableCell className="text-right text-green-600">{formatCurrency(exchange.totalInValue || 0)}</TableCell>
                    <TableCell className="text-right text-red-600">{formatCurrency(exchange.totalOutValue || 0)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(exchange.difference || 0)}</TableCell>
                    <TableCell>{exchange.createdByName || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedProduct} onOpenChange={() => setSelectedProduct(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Selecione o tamanho</DialogTitle>
          </DialogHeader>
          {selectedProduct && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                {selectedProduct.name} - {formatCurrency(selectedProduct.salePrice)}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {selectedProduct.sizes?.map((sizeData) => {
                  const disabled = addDirection === "OUT" && sizeData.stock <= 0;
                  return (
                    <Button
                      key={sizeData.size}
                      variant={disabled ? "ghost" : "outline"}
                      disabled={disabled}
                      className={`h-12 ${disabled ? "opacity-50" : ""}`}
                      onClick={() => addToCart(selectedProduct, sizeData.size, addDirection)}
                    >
                      <div className="flex flex-col">
                        <span className="font-bold">{sizeData.size}</span>
                        <span className="text-xs text-gray-500">({sizeData.stock})</span>
                      </div>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

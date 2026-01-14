"use client";

import { useState, useEffect } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { ShoppingCart, Plus, Minus, Trash2, CreditCard, Search, Banknote, Smartphone, X } from "lucide-react";
import { Label } from "@/components/ui/label";

interface ProductSize {
  size: string;
  stock: number;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  salePrice: number;
  stock: number;
  sizes: ProductSize[];
  owner: {
    id: string;
    name: string;
  };
}

interface CartItem {
  product: Product;
  size: string;
  quantity: number;
}

interface PaymentMethod {
  method: "DINHEIRO" | "DEBITO" | "CREDITO" | "PIX";
  amount: number;
}

export default function POSPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedSize, setSelectedSize] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [payments, setPayments] = useState<PaymentMethod[]>([]);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const data = await apiGet("/api/products");
      setProducts(Array.isArray(data) ? data : []);
    } catch (error) {
      toast({ title: "Erro ao carregar produtos", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase())
  );

  const addToCart = (product: Product, size: string) => {
    // Check size-specific stock
    const sizeStock = product.sizes?.find(s => s.size === size)?.stock || product.stock;
    const existing = cart.find((item) => item.product.id === product.id && item.size === size);
    
    if (existing) {
      if (existing.quantity >= sizeStock) {
        toast({
          title: "Estoque insuficiente",
          description: `Apenas ${sizeStock} unidades disponíveis para tamanho ${size}`,
          variant: "destructive",
        });
        return;
      }
      setCart(
        cart.map((item) =>
          item.product.id === product.id && item.size === size
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      );
    } else {
      if (sizeStock < 1) {
        toast({
          title: "Produto sem estoque neste tamanho",
          variant: "destructive",
        });
        return;
      }
      setCart([...cart, { product, size, quantity: 1 }]);
    }
    setSelectedProduct(null);
    setSelectedSize("");
  };

  const handleProductClick = (product: Product) => {
    if (product.sizes?.length > 0) {
      setSelectedProduct(product);
      setSelectedSize("");
    } else {
      addToCart(product, "");
    }
  };

  const updateQuantity = (productId: string, size: string, delta: number) => {
    setCart(
      cart
        .map((item) => {
          if (item.product.id === productId && item.size === size) {
            const sizeStock = item.product.sizes?.find(s => s.size === size)?.stock || item.product.stock;
            const newQty = item.quantity + delta;
            if (newQty > sizeStock) {
              toast({
                title: "Estoque insuficiente",
                variant: "destructive",
              });
              return item;
            }
            return { ...item, quantity: Math.max(0, newQty) };
          }
          return item;
        })
        .filter((item) => item.quantity > 0)
    );
  };

  const removeFromCart = (productId: string, size: string) => {
    setCart(cart.filter((item) => !(item.product.id === productId && item.size === size)));
  };

  const clearCart = () => {
    setCart([]);
  };

  const total = cart.reduce(
    (sum, item) => sum + item.product.salePrice * item.quantity,
    0
  );

  const openPaymentModal = () => {
    if (cart.length === 0) {
      toast({ title: "Carrinho vazio", variant: "destructive" });
      return;
    }
    setPayments([]);
    setShowPaymentModal(true);
  };

  const addPaymentMethod = (method: PaymentMethod["method"]) => {
    const existing = payments.find(p => p.method === method);
    if (!existing) {
      setPayments([...payments, { method, amount: 0 }]);
    }
  };

  const removePaymentMethod = (method: PaymentMethod["method"]) => {
    setPayments(payments.filter(p => p.method !== method));
  };

  const updatePaymentAmount = (method: PaymentMethod["method"], amount: number) => {
    setPayments(payments.map(p => 
      p.method === method ? { ...p, amount: Math.max(0, amount) } : p
    ));
  };

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = total - totalPaid;

  const handleCheckout = async () => {
    if (cart.length === 0) {
      toast({ title: "Carrinho vazio", variant: "destructive" });
      return;
    }

    if (remaining > 0.01) {
      toast({ 
        title: "Valor insuficiente", 
        description: `Falta ${formatCurrency(remaining)} para completar o pagamento`,
        variant: "destructive" 
      });
      return;
    }

    if (payments.length === 0) {
      toast({ title: "Selecione uma forma de pagamento", variant: "destructive" });
      return;
    }

    setProcessing(true);
    try {
      const order = await apiPost("/api/checkout", {
        items: cart.map((item) => ({
          productId: item.product.id,
          size: item.size,
          quantity: item.quantity,
        })),
        payments: payments.filter(p => p.amount > 0),
      });
      toast({
        title: "Venda realizada com sucesso!",
        description: `Pedido #${order.id.slice(-6).toUpperCase()} - ${formatCurrency(order.totalAmount)}`,
      });
      clearCart();
      setShowPaymentModal(false);
      setPayments([]);
      fetchProducts();
    } catch (error) {
      toast({
        title: "Erro ao processar venda",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  const groupedByOwner = cart.reduce((acc, item) => {
    const ownerId = item.product.owner.id;
    if (!acc[ownerId]) {
      acc[ownerId] = {
        owner: item.product.owner,
        items: [],
        subtotal: 0,
      };
    }
    acc[ownerId].items.push(item);
    acc[ownerId].subtotal += item.product.salePrice * item.quantity;
    return acc;
  }, {} as Record<string, { owner: { id: string; name: string }; items: CartItem[]; subtotal: number }>);

  return (
    <div className="h-[calc(100vh-8rem)] flex gap-6">
      <div className="flex-1 flex flex-col">
        <div className="mb-4">
          <h1 className="text-3xl font-bold text-gray-900">PDV</h1>
          <p className="text-gray-500">Ponto de Venda</p>
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
              {filteredProducts.map((product) => (
                <Card
                  key={product.id}
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    product.stock === 0 ? "opacity-50" : ""
                  }`}
                  onClick={() => handleProductClick(product)}
                >
                  <CardContent className="p-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-sm truncate">
                        {product.name}
                      </span>
                      <span className="text-xs text-gray-500">{product.sku}</span>
                      <div className="flex justify-between items-center mt-2">
                        <span className="font-bold text-green-600">
                          {formatCurrency(product.salePrice)}
                        </span>
                        <span className="text-xs text-gray-400">
                          Est: {product.stock}
                        </span>
                      </div>
                      <span className="text-xs text-blue-600 mt-1">
                        {product.owner.name}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <Card className="w-96 flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Carrinho
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col">
          {cart.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              Carrinho vazio
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto space-y-2">
                {cart.map((item) => (
                  <div
                    key={`${item.product.id}-${item.size}`}
                    className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {item.product.name}
                        {item.size && <span className="ml-1 text-blue-600">({item.size})</span>}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatCurrency(item.product.salePrice)} x {item.quantity}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => updateQuantity(item.product.id, item.size, -1)}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-8 text-center text-sm">
                        {item.quantity}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => updateQuantity(item.product.id, item.size, 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-500"
                        onClick={() => removeFromCart(item.product.id, item.size)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Separator className="my-4" />

              <div className="space-y-2 text-sm">
                <p className="font-semibold text-gray-600">Divisão por Proprietário:</p>
                {Object.values(groupedByOwner).map((group) => (
                  <div key={group.owner.id} className="flex justify-between">
                    <span className="text-gray-600">{group.owner.name}:</span>
                    <span>{formatCurrency(group.subtotal)}</span>
                  </div>
                ))}
              </div>

              <Separator className="my-4" />

              <div className="flex justify-between items-center text-lg font-bold">
                <span>Total:</span>
                <span className="text-green-600">{formatCurrency(total)}</span>
              </div>

              <div className="flex gap-2 mt-4">
                <Button variant="outline" className="flex-1" onClick={clearCart}>
                  Limpar
                </Button>
                <Button
                  className="flex-1"
                  onClick={openPaymentModal}
                  disabled={processing}
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  Finalizar
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Payment Method Dialog */}
      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Forma de Pagamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-gray-100 rounded-lg">
              <span className="font-semibold">Total da Compra:</span>
              <span className="text-xl font-bold text-green-600">{formatCurrency(total)}</span>
            </div>

            <div>
              <Label className="text-sm font-medium">Adicionar Forma de Pagamento:</Label>
              <div className="grid grid-cols-4 gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addPaymentMethod("DINHEIRO")}
                  disabled={payments.some(p => p.method === "DINHEIRO")}
                  className="flex flex-col h-16 gap-1"
                >
                  <Banknote className="h-5 w-5" />
                  <span className="text-xs">Dinheiro</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addPaymentMethod("DEBITO")}
                  disabled={payments.some(p => p.method === "DEBITO")}
                  className="flex flex-col h-16 gap-1"
                >
                  <CreditCard className="h-5 w-5" />
                  <span className="text-xs">Débito</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addPaymentMethod("CREDITO")}
                  disabled={payments.some(p => p.method === "CREDITO")}
                  className="flex flex-col h-16 gap-1"
                >
                  <CreditCard className="h-5 w-5" />
                  <span className="text-xs">Crédito</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addPaymentMethod("PIX")}
                  disabled={payments.some(p => p.method === "PIX")}
                  className="flex flex-col h-16 gap-1"
                >
                  <Smartphone className="h-5 w-5" />
                  <span className="text-xs">PIX</span>
                </Button>
              </div>
            </div>

            {payments.length > 0 && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">Valores:</Label>
                {payments.map((payment) => (
                  <div key={payment.method} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <span className="text-sm font-medium">
                        {payment.method === "DINHEIRO" && "Dinheiro"}
                        {payment.method === "DEBITO" && "Débito"}
                        {payment.method === "CREDITO" && "Crédito"}
                        {payment.method === "PIX" && "PIX"}
                      </span>
                    </div>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={payment.amount || ""}
                      onChange={(e) => updatePaymentAmount(payment.method, parseFloat(e.target.value) || 0)}
                      className="w-32 text-right"
                      placeholder="0,00"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-500"
                      onClick={() => removePaymentMethod(payment.method)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {payments.length > 0 && (
              <div className="space-y-2 p-3 bg-gray-100 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span>Total Pago:</span>
                  <span className="font-medium">{formatCurrency(totalPaid)}</span>
                </div>
                <div className={`flex justify-between text-sm ${remaining > 0.01 ? "text-red-600" : "text-green-600"}`}>
                  <span>{remaining > 0.01 ? "Falta:" : "Troco:"}</span>
                  <span className="font-bold">{formatCurrency(Math.abs(remaining))}</span>
                </div>
              </div>
            )}

            {payments.length === 0 && (
              <p className="text-center text-gray-500 py-4">Selecione uma forma de pagamento acima</p>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowPaymentModal(false)}>
                Cancelar
              </Button>
              <Button
                className="flex-1"
                onClick={handleCheckout}
                disabled={processing || remaining > 0.01 || payments.length === 0}
              >
                {processing ? "Processando..." : "Confirmar Venda"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Size Selection Dialog */}
      <Dialog open={!!selectedProduct} onOpenChange={() => setSelectedProduct(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Selecione o Tamanho</DialogTitle>
          </DialogHeader>
          {selectedProduct && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                {selectedProduct.name} - {formatCurrency(selectedProduct.salePrice)}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {selectedProduct.sizes?.map((sizeData) => (
                  <Button
                    key={sizeData.size}
                    variant={sizeData.stock > 0 ? "outline" : "ghost"}
                    disabled={sizeData.stock === 0}
                    className={`h-12 ${sizeData.stock === 0 ? "opacity-50" : ""}`}
                    onClick={() => {
                      addToCart(selectedProduct, sizeData.size);
                    }}
                  >
                    <div className="flex flex-col">
                      <span className="font-bold">{sizeData.size}</span>
                      <span className="text-xs text-gray-500">({sizeData.stock})</span>
                    </div>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

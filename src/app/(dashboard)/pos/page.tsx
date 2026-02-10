"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
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
import { ShoppingCart, Plus, Minus, Trash2, CreditCard, Search, Banknote, Smartphone, X, Lock, Unlock, FileText, Scan } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
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

interface CashRegister {
  id: string;
  userId: string;
  userName: string;
  openedAt: string;
  closedAt: string | null;
  openingBalance: number;
  closingBalance: number | null;
  status: "OPEN" | "CLOSED";
  totalSales: number;
  totalCash: number;
  totalDebit: number;
  totalCredit: number;
  totalPix: number;
  salesCount: number;
}

interface Order {
  id: string;
  totalAmount: number;
  payments: PaymentMethod[];
  createdAt: string;
  isPaidLater?: boolean;
  clientName?: string;
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
}

interface StoreSettings {
  storeName: string;
  address: string;
  phone: string;
  cnpj: string;
  footerMessage: string;
  discounts: DiscountSettings;
}

interface Client {
  id: string;
  name: string;
  phone?: string;
  balance: number;
}

export default function POSPage() {
  const { userData } = useAuth();
  const { toast } = useToast();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedSize, setSelectedSize] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [payments, setPayments] = useState<PaymentMethod[]>([]);
  const [discount, setDiscount] = useState<number>(0);
  
  // Pay later state
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [showPayLater, setShowPayLater] = useState(false);
  
  // Cash register state
  const [cashRegister, setCashRegister] = useState<CashRegister | null>(null);
  const [showOpenRegisterModal, setShowOpenRegisterModal] = useState(false);
  const [showCloseRegisterModal, setShowCloseRegisterModal] = useState(false);
  const [showClosingReport, setShowClosingReport] = useState(false);
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [closingBalance, setClosingBalance] = useState<number>(0);
  const [closingReportData, setClosingReportData] = useState<{ register: CashRegister; orders: Order[] } | null>(null);
  
  // Store settings for receipt
  const [storeSettings, setStoreSettings] = useState<StoreSettings>({
    storeName: "Gestão Loja",
    address: "",
    phone: "",
    cnpj: "",
    footerMessage: "Obrigado pela preferência!\nVolte sempre!",
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

  useEffect(() => {
    fetchProducts();
    fetchCashRegister();
    fetchStoreSettings();
    fetchClients();
    // Auto-focus search input for barcode scanner
    searchInputRef.current?.focus();
  }, []);

  const fetchClients = async () => {
    try {
      const data = await apiGet("/api/clients");
      setClients(Array.isArray(data) ? data : []);
    } catch (error) {
      // Clients may not be accessible for cashiers
      setClients([]);
    }
  };
  
  const fetchStoreSettings = async () => {
    try {
      const data = await apiGet("/api/settings");
      setStoreSettings({
        storeName: data.storeName || "Gestão Loja",
        address: data.address || "",
        phone: data.phone || "",
        cnpj: data.cnpj || "",
        footerMessage: data.footerMessage || "Obrigado pela preferência!\nVolte sempre!",
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
      console.error("Error fetching store settings:", error);
    }
  };

  // Re-focus search input after interactions (for continuous scanning)
  useEffect(() => {
    if (!selectedProduct && !showPaymentModal && !showOpenRegisterModal && !showCloseRegisterModal && !showClosingReport) {
      searchInputRef.current?.focus();
    }
  }, [selectedProduct, showPaymentModal, showOpenRegisterModal, showCloseRegisterModal, showClosingReport]);

  // Clear lastScanned indicator after 2 seconds
  useEffect(() => {
    if (lastScanned) {
      const timer = setTimeout(() => setLastScanned(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [lastScanned]);

  const handleBarcodeSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && search.trim()) {
      e.preventDefault();
      // Find exact SKU match (barcode scanners input exact codes)
      const exactMatch = products.find(
        (p) => p.sku.toLowerCase() === search.trim().toLowerCase()
      );
      
      if (exactMatch) {
        setLastScanned(exactMatch.name);
        if (exactMatch.sizes?.length > 0) {
          // Product has sizes, show size selection
          setSelectedProduct(exactMatch);
        } else {
          // No sizes, add directly to cart
          addToCart(exactMatch, "");
          toast({
            title: "Produto adicionado",
            description: exactMatch.name,
          });
        }
        setSearch("");
      } else {
        toast({
          title: "Produto não encontrado",
          description: `SKU: ${search}`,
          variant: "destructive",
        });
      }
    }
  };

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

  const fetchCashRegister = async () => {
    try {
      const data = await apiGet("/api/cash-register");
      setCashRegister(data.register || null);
    } catch (error) {
      console.error("Error fetching cash register:", error);
    }
  };

  const handleOpenRegister = async () => {
    try {
      const data = await apiPost("/api/cash-register", {
        action: "open",
        openingBalance,
      });
      setCashRegister(data.register);
      setShowOpenRegisterModal(false);
      setOpeningBalance(0);
      toast({ title: "Caixa aberto com sucesso!" });
    } catch (error) {
      toast({ title: "Erro ao abrir caixa", variant: "destructive" });
    }
  };

  const handleCloseRegister = async () => {
    try {
      const data = await apiPost("/api/cash-register", {
        action: "close",
        closingBalance,
      });
      setClosingReportData(data);
      setShowCloseRegisterModal(false);
      setShowClosingReport(true);
      setCashRegister(null);
      setClosingBalance(0);
    } catch (error) {
      toast({ title: "Erro ao fechar caixa", variant: "destructive" });
    }
  };

  const exportClosingReportPDF = () => {
    if (!closingReportData) return;
    
    const { register, orders } = closingReportData;
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text("Relatório de Fechamento de Caixa", 14, 22);
    
    doc.setFontSize(10);
    doc.text(`Operador: ${register.userName}`, 14, 32);
    doc.text(`Abertura: ${new Date(register.openedAt).toLocaleString("pt-BR")}`, 14, 38);
    doc.text(`Fechamento: ${register.closedAt ? new Date(register.closedAt).toLocaleString("pt-BR") : "-"}`, 14, 44);
    
    doc.setFontSize(12);
    doc.text("Resumo do Caixa", 14, 56);
    
    const totalFiado = orders.filter(o => o.isPaidLater).reduce((sum, o) => sum + o.totalAmount, 0);
    
    autoTable(doc, {
      startY: 60,
      head: [["Descrição", "Valor"]],
      body: [
        ["Saldo Inicial", formatCurrency(register.openingBalance)],
        ["Total em Vendas", formatCurrency(register.totalSales)],
        ["Dinheiro", formatCurrency(register.totalCash)],
        ["Débito", formatCurrency(register.totalDebit)],
        ["Crédito", formatCurrency(register.totalCredit)],
        ["PIX", formatCurrency(register.totalPix)],
        ["Fiado", formatCurrency(totalFiado)],
        ["Quantidade de Vendas", register.salesCount.toString()],
        ["Saldo Final Informado", formatCurrency(register.closingBalance || 0)],
        ["Saldo Esperado (Inicial + Dinheiro)", formatCurrency(register.openingBalance + register.totalCash)],
      ],
    });
    
    const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY || 120;
    
    if (orders.length > 0) {
      doc.setFontSize(12);
      doc.text("Vendas Realizadas", 14, finalY + 10);
      
      autoTable(doc, {
        startY: finalY + 14,
        head: [["#", "Horário", "Valor", "Pagamento", "Cliente"]],
        body: orders.map((order, index) => [
          (index + 1).toString(),
          new Date(order.createdAt).toLocaleTimeString("pt-BR"),
          formatCurrency(order.totalAmount),
          order.isPaidLater ? "FIADO" : order.payments.map(p => `${p.method}: ${formatCurrency(p.amount)}`).join(", "),
          order.clientName || "-",
        ]),
      });
    }
    
    doc.save(`fechamento-caixa-${new Date().toISOString().split("T")[0]}.pdf`);
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

  const subtotal = cart.reduce(
    (sum, item) => sum + item.product.salePrice * item.quantity,
    0
  );

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Calculate automatic discounts
  const calculateAutoDiscounts = () => {
    let autoDiscount = 0;
    const details: { label: string; value: number }[] = [];

    // Fixed discount (percentage)
    if (storeSettings.discounts.fixedDiscountEnabled && storeSettings.discounts.fixedDiscountPercent > 0) {
      const fixedValue = (subtotal * storeSettings.discounts.fixedDiscountPercent) / 100;
      autoDiscount += fixedValue;
      details.push({ label: `Desconto fixo (${storeSettings.discounts.fixedDiscountPercent}%)`, value: fixedValue });
    }

    // Progressive discount based on item count
    if (storeSettings.discounts.progressiveDiscountEnabled) {
      let progressivePercent = 0;
      if (totalItems >= 3) {
        progressivePercent = storeSettings.discounts.progressiveDiscount3PlusItems;
      } else if (totalItems === 2) {
        progressivePercent = storeSettings.discounts.progressiveDiscount2Items;
      } else if (totalItems === 1) {
        progressivePercent = storeSettings.discounts.progressiveDiscount1Item;
      }
      if (progressivePercent > 0) {
        const progressiveValue = (subtotal * progressivePercent) / 100;
        autoDiscount += progressiveValue;
        details.push({ label: `Desconto ${totalItems >= 3 ? "3+" : totalItems} ${totalItems === 1 ? "item" : "itens"} (${progressivePercent}%)`, value: progressiveValue });
      }
    }

    return { autoDiscount, details };
  };

  // PIX discount is calculated separately as it depends on payment method
  const calculatePixDiscount = () => {
    if (!storeSettings.discounts.pixDiscountEnabled) return 0;
    const pixPayment = payments.find(p => p.method === "PIX");
    if (pixPayment && pixPayment.amount > 0) {
      return (pixPayment.amount * storeSettings.discounts.pixDiscountPercent) / 100;
    }
    return 0;
  };

  const { autoDiscount, details: autoDiscountDetails } = calculateAutoDiscounts();
  const pixDiscount = calculatePixDiscount();
  const totalAutoDiscount = autoDiscount + pixDiscount;
  const totalDiscount = totalAutoDiscount + discount; // manual discount added on top
  const total = Math.max(0, subtotal - totalDiscount);

  const canApplyDiscount = userData?.role === "ADMIN";
  const canUsePayLater = userData?.role === "ADMIN";

  const openPaymentModal = () => {
    if (cart.length === 0) {
      toast({ title: "Carrinho vazio", variant: "destructive" });
      return;
    }
    setPayments([]);
    setDiscount(0);
    setSelectedClientId("");
    setShowPayLater(false);
    setShowPaymentModal(true);
  };

  const addPaymentMethod = (method: PaymentMethod["method"]) => {
    const existing = payments.find(p => p.method === method);
    if (!existing) {
      // Calculate remaining amount to pay (before any new PIX discount)
      const currentPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      const baseRemaining = Math.max(0, subtotal - autoDiscount - effectiveManualDiscount - currentPaid);
      
      let initialAmount = 0;
      if (method === "PIX" && storeSettings.discounts.pixDiscountEnabled) {
        // PIX discount creates circular dependency: total = base - PIX*rate, payment = PIX
        // To have payment = total (no change): PIX = base - PIX*rate → PIX(1+rate) = base → PIX = base/(1+rate)
        const discountRate = storeSettings.discounts.pixDiscountPercent / 100;
        initialAmount = Math.round((baseRemaining / (1 + discountRate)) * 100) / 100;
      }
      
      setPayments([...payments, { method, amount: initialAmount }]);
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
  const effectiveManualDiscount = canApplyDiscount ? discount : 0;
  const effectiveDiscount = totalAutoDiscount + effectiveManualDiscount;

  const printReceipt = (orderId: string, orderSubtotal: number, orderDiscount: number, orderTotal: number, orderPayments: PaymentMethod[], orderItems: CartItem[], change: number) => {
    const receiptWindow = window.open('', '_blank', 'width=320,height=600');
    if (!receiptWindow) {
      toast({ title: "Erro ao abrir janela de impressão", variant: "destructive" });
      return;
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR');
    const timeStr = now.toLocaleTimeString('pt-BR');

    // Helper to truncate and pad strings for fixed-width columns
    const truncate = (str: string, len: number) => str.length > len ? str.substring(0, len) : str;
    const padRight = (str: string, len: number) => truncate(str, len).padEnd(len);
    const padLeft = (str: string, len: number) => truncate(str, len).padStart(len);

    // Format currency without R$ prefix for compactness
    const formatValue = (value: number) => {
      return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    // 24 chars width for 58mm thermal printer (narrower to prevent wrapping)
    const LINE_WIDTH = 24;
    const dividerLine = '-'.repeat(LINE_WIDTH);

    // Build items text (Name 12 | Qty 2 | Value 8 = 22 + 2 spaces)
    const itemsText = orderItems.map(item => {
      const name = truncate(item.product.name + (item.size ? ` (${item.size})` : ''), 12);
      const qty = item.quantity.toString();
      const value = formatValue(item.product.salePrice * item.quantity);
      return `${padRight(name, 12)} ${padLeft(qty, 2)} ${padLeft(value, 8)}`;
    }).join('\n');

    // Build payments text
    const paymentsText = orderPayments.filter(p => p.amount > 0).map(p => {
      const method = truncate(p.method, 14);
      const value = formatValue(p.amount);
      return `${padRight(method, 14)} ${padLeft(value, 8)}`;
    }).join('\n');

    // Build row helper for label: value format
    const buildRow = (label: string, value: string) => {
      const remaining = LINE_WIDTH - label.length - 1;
      return `${label} ${padLeft(truncate(value, remaining), remaining)}`;
    };

    receiptWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Cupom</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: 'Courier New', Courier, monospace; 
            font-size: 12px;
            line-height: 1.3;
            width: 44mm; 
            padding: 2mm;
            -webkit-print-color-adjust: exact;
          }
          pre {
            font-family: inherit;
            font-size: inherit;
            white-space: pre;
            margin: 0;
            overflow: hidden;
          }
          .center { text-align: center; word-wrap: break-word; }
          .bold { font-weight: bold; }
          .divider { margin: 3px 0; }
          .section { margin: 4px 0; }
          @media print {
            body { width: 44mm; }
            @page { margin: 0; size: 58mm auto; }
          }
        </style>
      </head>
      <body>
        <div class="center">
          <div class="bold">${storeSettings.storeName.toUpperCase()}</div>
          ${storeSettings.address ? `<div>${storeSettings.address}</div>` : ''}
          ${storeSettings.phone ? `<div>Tel: ${storeSettings.phone}</div>` : ''}
          ${storeSettings.cnpj ? `<div>CNPJ: ${storeSettings.cnpj}</div>` : ''}
          <div style="margin-top: 4px;">CUPOM NAO FISCAL</div>
        </div>
        
        <pre class="divider">${dividerLine}</pre>
        
        <pre class="section">${buildRow('Data:', dateStr)}
${buildRow('Hora:', timeStr)}
${buildRow('Pedido:', '#' + orderId.slice(-6).toUpperCase())}${cashRegister ? '\n' + buildRow('Operador:', truncate(cashRegister.userName, 18)) : ''}</pre>
        
        <pre class="divider">${dividerLine}</pre>
        
        <pre class="section bold">${padRight('Item', 12)} ${padLeft('Qt', 2)} ${padLeft('Valor', 8)}</pre>
        <pre class="section">${itemsText}</pre>
        
        <pre class="divider">${dividerLine}</pre>
        
        <pre class="section">${buildRow('SUBTOTAL:', formatValue(orderSubtotal))}${orderDiscount > 0 ? '\n' + buildRow('DESCONTO:', '-' + formatValue(orderDiscount)) : ''}</pre>
        <pre class="section bold">${buildRow('TOTAL:', 'R$ ' + formatValue(orderTotal))}</pre>
        
        <pre class="divider">${dividerLine}</pre>
        
        <pre class="section bold">${padRight('Pagamento', 14)} ${padLeft('Valor', 8)}</pre>
        <pre class="section">${paymentsText}</pre>
        
        ${change > 0 ? `
          <pre class="divider">${dividerLine}</pre>
          <pre class="section bold">${buildRow('TROCO:', 'R$ ' + formatValue(change))}</pre>
        ` : ''}
        
        <pre class="divider">${dividerLine}</pre>
        
        <div class="center section">
          ${storeSettings.footerMessage.split('\n').map(line => `<div>${line}</div>`).join('')}
        </div>
        
        <script>
          window.onload = function() {
            window.print();
            window.onafterprint = function() { window.close(); };
          };
        </script>
      </body>
      </html>
    `);
    receiptWindow.document.close();
  };

  const handlePayLater = async () => {
    if (cart.length === 0) {
      toast({ title: "Carrinho vazio", variant: "destructive" });
      return;
    }

    if (!selectedClientId) {
      toast({ title: "Selecione um cliente", variant: "destructive" });
      return;
    }

    setProcessing(true);
    const cartSnapshot = [...cart];
    
    try {
      const order = await apiPost("/api/checkout", {
        items: cart.map((item) => ({
          productId: item.product.id,
          size: item.size,
          quantity: item.quantity,
        })),
        discount: effectiveDiscount,
        clientId: selectedClientId,
        payLater: true,
      });
      
      const selectedClient = clients.find(c => c.id === selectedClientId);
      
      toast({
        title: "Venda fiado registrada!",
        description: `Pedido #${order.id.slice(-6).toUpperCase()} - ${formatCurrency(order.totalAmount)} para ${selectedClient?.name}`,
      });
      clearCart();
      setShowPaymentModal(false);
      setSelectedClientId("");
      setShowPayLater(false);
      fetchProducts();
      fetchClients();
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
    const cartSnapshot = [...cart]; // Save cart before clearing
    const paymentsSnapshot = payments.filter(p => p.amount > 0);
    const change = totalPaid > total ? totalPaid - total : 0;
    
    try {
      const order = await apiPost("/api/checkout", {
        items: cart.map((item) => ({
          productId: item.product.id,
          size: item.size,
          quantity: item.quantity,
        })),
        payments: paymentsSnapshot,
        discount: effectiveDiscount,
      });
      
      // Print receipt
      printReceipt(order.id, order.subtotal, order.discount, order.totalAmount, paymentsSnapshot, cartSnapshot, change);
      
      toast({
        title: "Venda realizada com sucesso!",
        description: `Pedido #${order.id.slice(-6).toUpperCase()} - ${formatCurrency(order.totalAmount)}`,
      });
      clearCart();
      setShowPaymentModal(false);
      setPayments([]);
      fetchProducts();
      fetchCashRegister(); // Refresh cash register totals
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

  return (
    <div className="h-[calc(100vh-8rem)] flex gap-6">
      <div className="flex-1 flex flex-col">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">PDV</h1>
            <p className="text-gray-500">Ponto de Venda</p>
          </div>
          <div className="flex items-center gap-3">
            {cashRegister ? (
              <>
                <div className="text-right text-sm">
                  <p className="text-green-600 font-medium flex items-center gap-1">
                    <Unlock className="h-4 w-4" /> Caixa Aberto
                  </p>
                  <p className="text-gray-500">
                    Vendas: {cashRegister.salesCount} | Total: {formatCurrency(cashRegister.totalSales)}
                  </p>
                </div>
                <Button variant="destructive" onClick={() => setShowCloseRegisterModal(true)}>
                  <Lock className="h-4 w-4 mr-2" />
                  Fechar Caixa
                </Button>
              </>
            ) : (
              <Button onClick={() => setShowOpenRegisterModal(true)}>
                <Unlock className="h-4 w-4 mr-2" />
                Abrir Caixa
              </Button>
            )}
          </div>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            ref={searchInputRef}
            placeholder="Buscar produto por nome ou SKU (escaneie o código de barras)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleBarcodeSearch}
            className="pl-10 pr-10"
          />
          <Scan className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#355444]" />
          {lastScanned && (
            <div className="absolute top-full left-0 right-0 mt-1 p-2 bg-[#355444] text-white text-sm rounded-md animate-pulse z-10">
              ✓ Escaneado: {lastScanned}
            </div>
          )}
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
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal:</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                {totalAutoDiscount > 0 && (
                  <div className="flex justify-between items-center text-green-600 text-sm">
                    <span className="text-sm">Descontos ativos:</span>
                    <span>Descontos ativos:</span>
                    <span>-{formatCurrency(totalAutoDiscount)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-lg font-bold pt-1 border-t">
                  <span>Total:</span>
                  <span className="text-green-600">{formatCurrency(total)}</span>
                </div>
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
            <div className="p-3 bg-gray-100 rounded-lg space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Subtotal:</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              {autoDiscountDetails.map((d, i) => (
                <div key={i} className="flex justify-between items-center text-green-600">
                  <span className="text-sm">{d.label}:</span>
                  <span className="font-medium">-{formatCurrency(d.value)}</span>
                </div>
              ))}
              {pixDiscount > 0 && (
                <div className="flex justify-between items-center text-green-600">
                  <span className="text-sm">Desconto PIX ({storeSettings.discounts.pixDiscountPercent}%):</span>
                  <span className="font-medium">-{formatCurrency(pixDiscount)}</span>
                </div>
              )}
              {discount > 0 && (
                <div className="flex justify-between items-center text-red-600">
                  <span className="text-sm">Desconto manual:</span>
                  <span className="font-medium">-{formatCurrency(discount)}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-1 border-t">
                <span className="font-semibold">Total:</span>
                <span className="text-xl font-bold text-green-600">{formatCurrency(total)}</span>
              </div>
            </div>

            {storeSettings.discounts.pixDiscountEnabled && !payments.some(p => p.method === "PIX") && (
              <div className="p-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                💡 Adicione pagamento PIX para ganhar {storeSettings.discounts.pixDiscountPercent}% de desconto!
              </div>
            )}

            {canApplyDiscount && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Desconto Adicional (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max={subtotal - totalAutoDiscount}
                  value={discount || ""}
                  onChange={(e) => setDiscount(Math.min(subtotal - totalAutoDiscount, parseFloat(e.target.value) || 0))}
                  placeholder="0,00"
                  className="text-right"
                />
              </div>
            )}

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

            {payments.length === 0 && !showPayLater && (
              <p className="text-center text-gray-500 py-4">Selecione uma forma de pagamento acima</p>
            )}

            {canUsePayLater && (
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-sm font-medium">Venda Fiado (Pagar Depois)</Label>
                  <Button
                    variant={showPayLater ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowPayLater(!showPayLater)}
                  >
                    {showPayLater ? "Cancelar Fiado" : "Vender Fiado"}
                  </Button>
                </div>
                
                {showPayLater && (
                  <div className="space-y-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <p className="text-sm text-orange-700">Selecione o cliente que irá pagar depois:</p>
                    <select
                      className="w-full p-2 border rounded-md"
                      value={selectedClientId}
                      onChange={(e) => setSelectedClientId(e.target.value)}
                    >
                      <option value="">Selecione um cliente...</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name} {client.balance > 0 ? `(Deve: ${formatCurrency(client.balance)})` : ""}
                        </option>
                      ))}
                    </select>
                    {clients.length === 0 && (
                      <p className="text-xs text-orange-600">Nenhum cliente cadastrado. Cadastre clientes na página de Clientes.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowPaymentModal(false)}>
                Cancelar
              </Button>
              {showPayLater ? (
                <Button
                  className="flex-1 bg-orange-600 hover:bg-orange-700"
                  onClick={handlePayLater}
                  disabled={processing || !selectedClientId}
                >
                  {processing ? "Processando..." : "Confirmar Fiado"}
                </Button>
              ) : (
                <Button
                  className="flex-1"
                  onClick={handleCheckout}
                  disabled={processing || remaining > 0.01 || payments.length === 0}
                >
                  {processing ? "Processando..." : "Confirmar Venda"}
                </Button>
              )}
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

      {/* Open Register Dialog */}
      <Dialog open={showOpenRegisterModal} onOpenChange={setShowOpenRegisterModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Abrir Caixa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Saldo Inicial (Troco)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={openingBalance || ""}
                onChange={(e) => setOpeningBalance(parseFloat(e.target.value) || 0)}
                placeholder="0,00"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowOpenRegisterModal(false)}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={handleOpenRegister}>
                <Unlock className="h-4 w-4 mr-2" />
                Abrir Caixa
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Close Register Dialog */}
      <Dialog open={showCloseRegisterModal} onOpenChange={setShowCloseRegisterModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Fechar Caixa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {cashRegister && (
              <div className="p-3 bg-gray-100 rounded-lg space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Saldo Inicial:</span>
                  <span className="font-medium">{formatCurrency(cashRegister.openingBalance)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total em Vendas:</span>
                  <span className="font-medium">{formatCurrency(cashRegister.totalSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Dinheiro Recebido:</span>
                  <span className="font-medium">{formatCurrency(cashRegister.totalCash)}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-bold">
                  <span>Saldo Esperado:</span>
                  <span>{formatCurrency(cashRegister.openingBalance + cashRegister.totalCash)}</span>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Saldo Final (Contagem do Dinheiro)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={closingBalance || ""}
                onChange={(e) => setClosingBalance(parseFloat(e.target.value) || 0)}
                placeholder="0,00"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowCloseRegisterModal(false)}>
                Cancelar
              </Button>
              <Button variant="destructive" className="flex-1" onClick={handleCloseRegister}>
                <Lock className="h-4 w-4 mr-2" />
                Fechar Caixa
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Closing Report Dialog */}
      <Dialog open={showClosingReport} onOpenChange={setShowClosingReport}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Relatório de Fechamento de Caixa</DialogTitle>
          </DialogHeader>
          {closingReportData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-gray-100 rounded-lg">
                  <p className="text-sm text-gray-500">Operador</p>
                  <p className="font-medium">{closingReportData.register.userName}</p>
                </div>
                <div className="p-3 bg-gray-100 rounded-lg">
                  <p className="text-sm text-gray-500">Período</p>
                  <p className="font-medium text-sm">
                    {new Date(closingReportData.register.openedAt).toLocaleString("pt-BR")}
                    <br />
                    até {closingReportData.register.closedAt ? new Date(closingReportData.register.closedAt).toLocaleString("pt-BR") : "-"}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-gray-500">Total Vendas</p>
                    <p className="text-lg font-bold text-green-600">{formatCurrency(closingReportData.register.totalSales)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-gray-500">Qtd. Vendas</p>
                    <p className="text-lg font-bold">{closingReportData.register.salesCount}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-gray-500">Saldo Inicial</p>
                    <p className="text-lg font-bold">{formatCurrency(closingReportData.register.openingBalance)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-gray-500">Saldo Final</p>
                    <p className="text-lg font-bold">{formatCurrency(closingReportData.register.closingBalance || 0)}</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Formas de Pagamento</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-2"><Banknote className="h-4 w-4" /> Dinheiro:</span>
                    <span className="font-medium">{formatCurrency(closingReportData.register.totalCash)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Débito:</span>
                    <span className="font-medium">{formatCurrency(closingReportData.register.totalDebit)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Crédito:</span>
                    <span className="font-medium">{formatCurrency(closingReportData.register.totalCredit)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-2"><Smartphone className="h-4 w-4" /> PIX:</span>
                    <span className="font-medium">{formatCurrency(closingReportData.register.totalPix)}</span>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between text-sm">
                    <span className="text-orange-600 font-medium">Fiado:</span>
                    <span className="font-medium text-orange-600">
                      {formatCurrency(closingReportData.orders.filter(o => o.isPaidLater).reduce((sum, o) => sum + o.totalAmount, 0))}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Conferência de Caixa</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Saldo Esperado (Inicial + Dinheiro):</span>
                    <span className="font-medium">{formatCurrency(closingReportData.register.openingBalance + closingReportData.register.totalCash)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Saldo Informado:</span>
                    <span className="font-medium">{formatCurrency(closingReportData.register.closingBalance || 0)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-sm font-bold">
                    <span>Diferença:</span>
                    <span className={(closingReportData.register.closingBalance || 0) - (closingReportData.register.openingBalance + closingReportData.register.totalCash) < 0 ? "text-red-600" : "text-green-600"}>
                      {formatCurrency((closingReportData.register.closingBalance || 0) - (closingReportData.register.openingBalance + closingReportData.register.totalCash))}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {closingReportData.orders.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Vendas Realizadas ({closingReportData.orders.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-48 overflow-y-auto space-y-2">
                      {closingReportData.orders.map((order, index) => (
                        <div key={order.id} className={`flex justify-between items-center p-2 rounded text-sm ${order.isPaidLater ? 'bg-orange-50' : 'bg-gray-50'}`}>
                          <div>
                            <span className="font-medium">#{index + 1}</span>
                            <span className="text-gray-500 ml-2">{new Date(order.createdAt).toLocaleTimeString("pt-BR")}</span>
                            {order.clientName && (
                              <span className="text-blue-600 ml-2 text-xs">({order.clientName})</span>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="font-medium">{formatCurrency(order.totalAmount)}</span>
                            <span className={`ml-2 text-xs ${order.isPaidLater ? 'text-orange-600 font-medium' : 'text-gray-500'}`}>
                              {order.isPaidLater ? 'FIADO' : order.payments.map(p => p.method).join(", ")}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowClosingReport(false)}>
                  Fechar
                </Button>
                <Button className="flex-1" onClick={exportClosingReportPDF}>
                  <FileText className="h-4 w-4 mr-2" />
                  Exportar PDF
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

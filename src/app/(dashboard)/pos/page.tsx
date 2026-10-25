"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
import { cn, formatCurrency } from "@/lib/utils";
import { Plus, Minus, Trash2, CreditCard, Search, Banknote, Smartphone, X, Lock, Unlock, FileText, ArrowDownCircle, ArrowUpCircle, Check, ScanLine, BadgePercent, AlertTriangle, ChevronDown } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Label } from "@/components/ui/label";
import { useProductCategories } from "@/lib/use-product-categories";
import { PageHeader, StateTag } from "@/components/layout/page-header";
import { SizeGrid } from "@/components/etiqueta/size-grid";
import { PriceTag } from "@/components/etiqueta/price-tag";
import { ProductPhoto } from "@/components/etiqueta/product-photo";

interface ProductSize {
  size: string;
  stock: number;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  plusSized?: boolean;
  category?: string;
  salePrice: number;
  stock: number;
  sizes: ProductSize[];
  image?: string;
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
  totalCashSupply?: number;
  totalCashWithdrawal?: number;
  salesCount: number;
  totalExchangeDifferenceIn?: number;
  exchangeDifferenceCount?: number;
}

interface Order {
  id: string;
  totalAmount: number;
  payments: PaymentMethod[];
  createdAt: string;
  isPaidLater?: boolean;
  clientName?: string;
}

interface ProductDiscount {
  productId: string;
  discountPercent: number;
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
  discounts: DiscountSettings;
}

interface Client {
  id: string;
  name: string;
  phone?: string;
  balance: number;
}

const NOTE_DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2] as const;
const COIN_DENOMINATIONS = [1, 0.5, 0.25, 0.1, 0.05] as const;
const CASH_DENOMINATIONS = [...NOTE_DENOMINATIONS, ...COIN_DENOMINATIONS] as const;
const CASH_DENOMINATION_GROUPS = [
  { label: "Cédulas", values: NOTE_DENOMINATIONS },
  { label: "Moedas", values: COIN_DENOMINATIONS },
] as const;

type DenominationCounts = Record<string, number>;

function createEmptyDenominationCounts(): DenominationCounts {
  return CASH_DENOMINATIONS.reduce<DenominationCounts>((acc, value) => {
    acc[value.toString()] = 0;
    return acc;
  }, {});
}

function calculateDenominationTotal(counts: DenominationCounts): number {
  const total = CASH_DENOMINATIONS.reduce((sum, value) => {
    const quantity = Number(counts[value.toString()] || 0);
    return sum + value * quantity;
  }, 0);

  return Number(total.toFixed(2));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface ReceiptOrderItem {
  productName?: string;
  size?: string;
  quantity: number;
  totalRevenue?: number;
  lineTotal?: number;
}

export default function POSPage() {
  const { userData } = useAuth();
  const { toast } = useToast();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const productCategories = useProductCategories();
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [payments, setPayments] = useState<PaymentMethod[]>([]);
  const [discount, setDiscount] = useState<number>(0);
  const [showAdminPasswordModal, setShowAdminPasswordModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [verifyingAdmin, setVerifyingAdmin] = useState(false);
  const [adminAuthorized, setAdminAuthorized] = useState(false);

  // Pay later state
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [showPayLater, setShowPayLater] = useState(false);
  const [showMobileCart, setShowMobileCart] = useState(false);

  // Cash register state
  const pendingCheckoutAction = useRef<"checkout" | "payLater" | null>(null);
  const [cashRegister, setCashRegister] = useState<CashRegister | null>(null);
  const [showOpenRegisterModal, setShowOpenRegisterModal] = useState(false);
  const [showCloseRegisterModal, setShowCloseRegisterModal] = useState(false);
  const [openingRegister, setOpeningRegister] = useState(false);
  const [closingRegister, setClosingRegister] = useState(false);
  const [showCashAdjustmentModal, setShowCashAdjustmentModal] = useState(false);
  const [cashAdjustmentType, setCashAdjustmentType] = useState<"supply" | "withdrawal">("supply");
  const [cashAdjustmentAmount, setCashAdjustmentAmount] = useState<string>("");
  const [cashAdjustmentNote, setCashAdjustmentNote] = useState<string>("");
  const [processingCashAdjustment, setProcessingCashAdjustment] = useState(false);
  const [showClosingReport, setShowClosingReport] = useState(false);
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [closingBalance, setClosingBalance] = useState<number>(0);
  const [openingDenominations, setOpeningDenominations] = useState<DenominationCounts>(() => createEmptyDenominationCounts());
  const [closingDenominations, setClosingDenominations] = useState<DenominationCounts>(() => createEmptyDenominationCounts());
  const [closingReportData, setClosingReportData] = useState<{ register: CashRegister; orders: Order[] } | null>(null);

  // Store settings for receipt
  const [storeSettings, setStoreSettings] = useState<StoreSettings>({
    storeName: "Benê Brasil",
    address: "",
    phone: "",
    cnpj: "",
    footerMessage: "Obrigado pela preferência!\nVolte sempre!",
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
      progressiveDiscount4PlusItems: 60,
      productDiscountsEnabled: false,
      productDiscounts: [],
    },
  });

  const fetchProducts = useCallback(async () => {
    try {
      const data = await apiGet("/api/products");
      setProducts(Array.isArray(data) ? data : []);
    } catch {
      toast({ title: "Erro ao carregar produtos", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchProducts();
    fetchCashRegister();
    fetchStoreSettings();
    fetchClients();
    // Auto-focus search input for barcode scanner
    searchInputRef.current?.focus();
  }, [fetchProducts]);

  const fetchClients = async () => {
    try {
      const data = await apiGet("/api/clients");
      setClients(Array.isArray(data) ? data : []);
    } catch {
      // Clients may not be accessible for cashiers
      setClients([]);
    }
  };

  const openCashAdjustmentModal = (type: "supply" | "withdrawal") => {
    setCashAdjustmentType(type);
    setCashAdjustmentAmount("");
    setCashAdjustmentNote("");
    setShowCashAdjustmentModal(true);
  };

  const handleCashAdjustment = async () => {
    const amount = Number(cashAdjustmentAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Informe um valor válido", variant: "destructive" });
      return;
    }

    setProcessingCashAdjustment(true);
    try {
      const data = await apiPost("/api/cash-register", {
        action: cashAdjustmentType,
        amount,
        note: cashAdjustmentNote,
        idempotencyKey: crypto.randomUUID(),
      });
      setCashRegister(data.register || null);
      setShowCashAdjustmentModal(false);
      setCashAdjustmentAmount("");
      setCashAdjustmentNote("");
      toast({
        title: cashAdjustmentType === "supply" ? "Troco adicionado" : "Sangria registrada",
      });
    } catch (error) {
      toast({
        title: "Erro ao registrar movimentação",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setProcessingCashAdjustment(false);
    }
  };

  const fetchStoreSettings = async () => {
    try {
      const data = await apiGet("/api/settings");
      setStoreSettings({
        storeName: data.storeName || "Benê Brasil",
        address: data.address || "",
        phone: data.phone || "",
        cnpj: data.cnpj || "",
        footerMessage: data.footerMessage || "Obrigado pela preferência!\nVolte sempre!",
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
          progressiveDiscount4PlusItems: data.discounts?.progressiveDiscount4PlusItems ?? 60,
          productDiscountsEnabled: data.discounts?.productDiscountsEnabled ?? false,
          productDiscounts: data.discounts?.productDiscounts ?? [],
        },
      });
    } catch (error) {
      console.error("Error fetching store settings:", error);
    }
  };

  // Resume pending checkout after cash register is opened
  useEffect(() => {
    if (cashRegister?.status === "OPEN" && pendingCheckoutAction.current) {
      const action = pendingCheckoutAction.current;
      pendingCheckoutAction.current = null;
      if (action === "checkout") {
        handleCheckout();
      } else if (action === "payLater") {
        handlePayLater();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashRegister]);

  // Re-focus search input after interactions (for continuous scanning)
  useEffect(() => {
    if (!selectedProduct && !showPaymentModal && !showOpenRegisterModal && !showCloseRegisterModal && !showClosingReport) {
      searchInputRef.current?.focus();
    }
  }, [selectedProduct, showPaymentModal, showOpenRegisterModal, showCloseRegisterModal, showClosingReport]);

  // Counter shortcuts: F2 jumps to the scanner field, F9 finishes the sale.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === "F9") {
        e.preventDefault();
        if (cart.length > 0 && !showPaymentModal && !processing) openPaymentModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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

  const fetchCashRegister = async () => {
    try {
      const data = await apiGet("/api/cash-register");
      setCashRegister(data.register || null);
    } catch (error) {
      console.error("Error fetching cash register:", error);
    }
  };

  const handleOpenRegister = async () => {
    setOpeningRegister(true);
    try {
      const data = await apiPost("/api/cash-register", {
        action: "open",
        openingBalance,
      });
      setCashRegister(data.register);
      setShowOpenRegisterModal(false);
      setOpeningBalance(0);
      setOpeningDenominations(createEmptyDenominationCounts());
      toast({ title: "Caixa aberto com sucesso!" });
    } catch {
      toast({ title: "Erro ao abrir caixa", variant: "destructive" });
    } finally {
      setOpeningRegister(false);
    }
  };

  const handleCloseRegister = async () => {
    setClosingRegister(true);
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
      setClosingDenominations(createEmptyDenominationCounts());
    } catch {
      toast({ title: "Erro ao fechar caixa", variant: "destructive" });
    } finally {
      setClosingRegister(false);
    }
  };

  const handleDenominationQuantityChange = (
    mode: "open" | "close",
    denomination: number,
    value: string
  ) => {
    const numeric = Math.max(0, Math.floor(Number(value) || 0));
    const key = denomination.toString();

    if (mode === "open") {
      const next = { ...openingDenominations, [key]: numeric };
      setOpeningDenominations(next);
      setOpeningBalance(calculateDenominationTotal(next));
      return;
    }

    const next = { ...closingDenominations, [key]: numeric };
    setClosingDenominations(next);
    setClosingBalance(calculateDenominationTotal(next));
  };

  const openRegisterModal = () => {
    setOpeningDenominations(createEmptyDenominationCounts());
    setOpeningBalance(0);
    setShowOpenRegisterModal(true);
  };

  const closeRegisterModal = () => {
    setClosingDenominations(createEmptyDenominationCounts());
    setClosingBalance(0);
    setShowCloseRegisterModal(true);
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
        ["Diferença de Troca (Entrada)", formatCurrency(register.totalExchangeDifferenceIn || 0)],
        ["Dinheiro", formatCurrency(register.totalCash)],
        ["Débito", formatCurrency(register.totalDebit)],
        ["Crédito", formatCurrency(register.totalCredit)],
        ["PIX", formatCurrency(register.totalPix)],
        ["Fiado", formatCurrency(totalFiado)],
        ["Quantidade de Vendas", register.salesCount.toString()],
        ["Trocas com Diferença", (register.exchangeDifferenceCount || 0).toString()],
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

  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !selectedCategory || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

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
  };

  const handleProductClick = (product: Product) => {
    if (product.sizes?.length > 0) {
      setSelectedProduct(product);
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

    // Product-specific discounts
    if (storeSettings.discounts.productDiscountsEnabled) {
      cart.forEach((cartItem) => {
        const productDiscount = storeSettings.discounts.productDiscounts.find(
          (pd) => pd.productId === cartItem.product.id
        );
        if (productDiscount && productDiscount.discountPercent > 0) {
          const discountValue = (cartItem.product.salePrice * cartItem.quantity * productDiscount.discountPercent) / 100;
          autoDiscount += discountValue;
          details.push({
            label: `${cartItem.product.name} (${productDiscount.discountPercent}%)`,
            value: discountValue
          });
        }
      });
    }

    // Fixed discount (percentage)
    if (storeSettings.discounts.fixedDiscountEnabled && storeSettings.discounts.fixedDiscountPercent > 0) {
      const fixedValue = (subtotal * storeSettings.discounts.fixedDiscountPercent) / 100;
      autoDiscount += fixedValue;
      details.push({ label: `Desconto fixo (${storeSettings.discounts.fixedDiscountPercent}%)`, value: fixedValue });
    }

    // Progressive discount based on item count
    if (storeSettings.discounts.progressiveDiscountEnabled) {
      let progressivePercent = 0;
      if (totalItems >= 4) {
        progressivePercent = storeSettings.discounts.progressiveDiscount4PlusItems;
      } else if (totalItems === 3) {
        progressivePercent = storeSettings.discounts.progressiveDiscount3PlusItems;
      } else if (totalItems === 2) {
        progressivePercent = storeSettings.discounts.progressiveDiscount2Items;
      } else if (totalItems === 1) {
        progressivePercent = storeSettings.discounts.progressiveDiscount1Item;
      }
      if (progressivePercent > 0) {
        const progressiveValue = (subtotal * progressivePercent) / 100;
        autoDiscount += progressiveValue;
        const countLabel = totalItems >= 4 ? "4+" : totalItems.toString();
        details.push({ label: `Desconto ${countLabel} ${totalItems === 1 ? "item" : "itens"} (${progressivePercent}%)`, value: progressiveValue });
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

  const canApplyDiscount = userData?.role === "ADMIN" || userData?.role === "CASHIER";
  const canUsePayLater = userData?.role === "ADMIN" || userData?.role === "CASHIER";
  const maxCashierDiscount = subtotal * 0.10;

  const openPaymentModal = () => {
    if (cart.length === 0) {
      toast({ title: "Carrinho vazio", variant: "destructive" });
      return;
    }
    setPayments([]);
    setDiscount(0);
    setSelectedClientId("");
    setShowPayLater(false);
    setAdminPassword("");
    setAdminAuthorized(false);
    setShowPaymentModal(true);
  };

  const handleDiscountChange = (value: number) => {
    const isCashier = userData?.role === "CASHIER";

    if (isCashier && value > maxCashierDiscount && !adminAuthorized) {
      // Cashier trying to apply discount > 10%, require admin authorization
      setDiscount(value);
      setShowAdminPasswordModal(true);
      return;
    }

    setDiscount(value);
  };

  const handleAdminVerification = async () => {
    if (!adminPassword) {
      toast({ title: "Informe a senha de administrador", variant: "destructive" });
      return;
    }

    setVerifyingAdmin(true);
    try {
      // Verify admin password using the same method as debt corrections
      const response = await apiPost("/api/admin/verify-password", {
        adminPassword: adminPassword.trim()
      });

      if (response.success) {
        toast({ title: "Autorização confirmada" });
        setAdminAuthorized(true);
        setShowAdminPasswordModal(false);
        setAdminPassword("");
        // Discount is already set, just close the modal
      } else {
        toast({ title: response.error || "Senha de administrador inválida", variant: "destructive" });
        // Reset discount to max allowed for cashier
        setDiscount(maxCashierDiscount);
      }
    } catch {
      toast({
        title: "Erro na verificação",
        description: "Senha de administrador inválida",
        variant: "destructive"
      });
      // Reset discount to max allowed for cashier
      setDiscount(maxCashierDiscount);
    } finally {
      setVerifyingAdmin(false);
    }
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

  const printReceipt = (
    orderId: string,
    options: {
      isTest?: boolean;
      items: ReceiptOrderItem[];
      payments: PaymentMethod[];
      subtotal: number;
      totalAmount: number;
      discount: number;
    }
  ) => {
    const { isTest = false, items, payments, subtotal, totalAmount, discount } = options;
    const receiptWindow = window.open('', '_blank', 'width=420,height=700');
    if (!receiptWindow) {
      toast({ title: "Erro ao abrir janela de impressão", variant: "destructive" });
      return;
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR');
    const timeStr = now.toLocaleTimeString('pt-BR');
    const exchangeDays = Number.isFinite(storeSettings.exchangeDays) ? Math.max(0, Math.floor(storeSettings.exchangeDays)) : 10;
    const exchangeDeadline = new Date(now);
    exchangeDeadline.setDate(exchangeDeadline.getDate() + exchangeDays);
    const exchangeDeadlineStr = exchangeDeadline.toLocaleDateString('pt-BR');

    const paymentLabel: Record<PaymentMethod["method"], string> = {
      DINHEIRO: "Dinheiro",
      DEBITO: "Debito",
      CREDITO: "Credito",
      PIX: "PIX",
    };

    const itemsRows = items
      .map((item) => {
        const itemName = escapeHtml(`${item.productName || "Produto"}${item.size ? ` (${item.size})` : ""}`);
        const itemTotal = item.totalRevenue ?? item.lineTotal ?? 0;
        return `<tr><td>${item.quantity}x ${itemName}</td><td class="right">${formatCurrency(itemTotal)}</td></tr>`;
      })
      .join("");

    const paymentsRows = payments
      .map((payment) => `<tr><td>${paymentLabel[payment.method] || payment.method}</td><td class="right">${formatCurrency(payment.amount)}</td></tr>`)
      .join("");

    const storeName = escapeHtml(storeSettings.storeName.toUpperCase());
    const storeAddress = escapeHtml(storeSettings.address);
    const storePhone = escapeHtml(storeSettings.phone);
    const storeCnpj = escapeHtml(storeSettings.cnpj);
    const operatorName = cashRegister ? escapeHtml(cashRegister.userName) : "";
    const documentLabel = isTest ? "TESTE-80MM" : `#${escapeHtml(orderId.slice(-6).toUpperCase())}`;
    const footerLines = storeSettings.footerMessage
      .split("\n")
      .map((line) => `<div class="line">${escapeHtml(line)}</div>`)
      .join("");

    receiptWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Comprovantes</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body {
            width: 80mm;
            max-width: 80mm;
          }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 11px;
            line-height: 1.3;
            font-weight: 600;
            color: #000;
            padding: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            overflow-wrap: anywhere;
            word-break: break-word;
          }
          .receipt {
            width: 80mm;
            max-width: 80mm;
            padding: 2.5mm 2.5mm 3mm;
            break-after: page;
            page-break-after: always;
          }
          .receipt:last-child {
            break-after: auto;
            page-break-after: auto;
          }
          .center { text-align: center; overflow-wrap: anywhere; word-break: break-word; }
          .bold { font-weight: bold; }
          .divider { margin: 8px 0; border-top: 1px dashed #000; }
          .section { margin: 6px 0; }
          .muted { font-size: 11px; }
          .store-name { font-size: 15px; line-height: 1.2; letter-spacing: 0.3px; }
          .line { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
          .meta { margin: 2px 0; }
          .meta strong { display: inline-block; min-width: 78px; }
          .policy { margin: 6px 0; text-align: left; }
          .policy-line { display: block; line-height: 1.3; }
          .validity { text-align: center; margin-top: 6px; }
          .footer-note { text-align: center; }
          .title { font-size: 14px; margin-bottom: 4px; }
          table { width: 100%; border-collapse: collapse; }
          td { vertical-align: top; padding: 1px 0; }
          td.right { text-align: right; white-space: nowrap; padding-left: 8px; }
          .totals td { padding-top: 2px; }
          @media print {
            html, body { width: 80mm !important; max-width: 80mm !important; }
            @page { margin: 0; size: 80mm auto; }
            .receipt { break-after: page; page-break-after: always; }
            .receipt:last-child { break-after: auto; page-break-after: auto; }
          }
        </style>
      </head>
      <body>
        <div class="receipt">
          <div class="center">
            <div class="bold store-name line">${storeName}</div>
            ${storeAddress ? `<div class="line">${storeAddress}</div>` : ''}
            ${storePhone ? `<div class="line">Tel: ${storePhone}</div>` : ''}
            ${storeCnpj ? `<div class="line">CNPJ: ${storeCnpj}</div>` : ''}
          </div>

          <div class="divider"></div>

          <div class="center title bold">CUPOM NAO FISCAL</div>

          <div class="section muted">
            <div class="meta"><strong>Data:</strong> ${dateStr}</div>
            <div class="meta"><strong>Hora:</strong> ${timeStr}</div>
            <div class="meta"><strong>Documento:</strong> ${documentLabel}</div>
            ${operatorName ? `<div class="meta"><strong>Operador:</strong> ${operatorName}</div>` : ''}
          </div>

          <div class="divider"></div>

          <table>
            <tbody>
              ${itemsRows}
            </tbody>
          </table>

          <div class="divider"></div>

          <table class="totals">
            <tbody>
              <tr><td>Subtotal</td><td class="right">${formatCurrency(subtotal)}</td></tr>
              ${discount > 0 ? `<tr><td>Desconto</td><td class="right">-${formatCurrency(discount)}</td></tr>` : ""}
              <tr><td><strong>Total</strong></td><td class="right"><strong>${formatCurrency(totalAmount)}</strong></td></tr>
            </tbody>
          </table>

          ${payments.length > 0 ? `<div class="divider"></div><table><tbody>${paymentsRows}</tbody></table>` : ""}

          <div class="divider"></div>
          <div class="center muted">Documento sem valor fiscal</div>
        </div>

        <div class="receipt">
          <div class="center">
            <div class="bold store-name line">${storeName}</div>
            ${storeAddress ? `<div class="line">${storeAddress}</div>` : ''}
            ${storePhone ? `<div class="line">Tel: ${storePhone}</div>` : ''}
          </div>

          <div class="divider"></div>

          <div class="section muted">
            <div class="meta"><strong>Data:</strong> ${dateStr}</div>
            <div class="meta"><strong>Hora:</strong> ${timeStr}</div>
            <div class="meta"><strong>Documento:</strong> ${documentLabel}</div>
            ${operatorName ? `<div class="meta"><strong>Operador:</strong> ${operatorName}</div>` : ''}
          </div>

          <div class="divider"></div>

          <div class="center section">
            <div class="bold title">COMPROVANTE PARA TROCA</div>
            <div class="section policy">
              <span class="policy-line">Trocas em ate ${exchangeDays} dias</span>
              <span class="policy-line">corridos, mediante apresentacao</span>
              <span class="policy-line">deste comprovante.</span>
            </div>
            <div class="validity"><strong>Valido ate:</strong> ${exchangeDeadlineStr}</div>
            <div class="muted footer-note">Produto deve estar sem uso e com etiqueta.</div>
          </div>

          ${storeSettings.footerMessage
            ? `<div class="divider"></div>
               <div class="center section muted">
                 ${footerLines}
               </div>`
            : ''}

          ${isTest ? `<div class="divider"></div><div class="center muted"><strong>IMPRESSAO DE TESTE</strong></div>` : ''}
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

    if (!cashRegister || cashRegister.status !== "OPEN") {
      pendingCheckoutAction.current = "payLater";
      openRegisterModal();
      toast({ title: "Caixa fechado", description: "Abra o caixa para finalizar a venda.", variant: "destructive" });
      return;
    }

    setProcessing(true);
    const idempotencyKey = crypto.randomUUID();

    try {
      const order = await apiPost("/api/checkout", {
        items: cart.map((item) => ({
          productId: item.product.id,
          size: item.size,
          quantity: item.quantity,
        })),
        discount: effectiveManualDiscount,
        promoDiscount: totalAutoDiscount,
        clientId: selectedClientId,
        payLater: true,
        idempotencyKey,
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

    if (!cashRegister || cashRegister.status !== "OPEN") {
      pendingCheckoutAction.current = "checkout";
      openRegisterModal();
      toast({ title: "Caixa fechado", description: "Abra o caixa para finalizar a venda.", variant: "destructive" });
      return;
    }

    setProcessing(true);
    const paymentsSnapshot = payments.filter(p => p.amount > 0);
    const idempotencyKey = crypto.randomUUID();

    try {
      const order = await apiPost("/api/checkout", {
        items: cart.map((item) => ({
          productId: item.product.id,
          size: item.size,
          quantity: item.quantity,
        })),
        payments: paymentsSnapshot,
        discount: effectiveManualDiscount,
        promoDiscount: totalAutoDiscount,
        idempotencyKey,
      });

      printReceipt(order.id, {
        items: Array.isArray(order.items) ? order.items : [],
        payments: paymentsSnapshot,
        subtotal: order.subtotal,
        totalAmount: order.totalAmount,
        discount: order.discount,
      });

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

  const cartSizesFor = (productId: string) =>
    cart.filter((item) => item.product.id === productId).map((item) => item.size);

  const categoryCounts = products.reduce<Record<string, number>>((acc, p) => {
    if (p.category) acc[p.category] = (acc[p.category] || 0) + 1;
    return acc;
  }, {});

  const registerOpenedAt = cashRegister
    ? new Date(cashRegister.openedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;

  const renderStub = () => (
    <>
      <div className="flex items-baseline justify-between gap-3 px-5 pb-3 pt-5">
        <h2 className="font-tag text-xl font-extrabold uppercase tracking-[0.04em]">Venda atual</h2>
        <div className="text-sm text-ink-2">
          {totalItems} {totalItems === 1 ? "peça" : "peças"}
          {cart.length > 0 ? (
            <button
              type="button"
              onClick={clearCart}
              className="ml-3 font-semibold text-denim underline-offset-4 hover:underline"
            >
              Limpar
            </button>
          ) : null}
        </div>
      </div>

      {cart.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 pb-10 text-center">
          <ScanLine className="h-8 w-8 text-ink-3/60" strokeWidth={1.5} aria-hidden="true" />
          <p className="font-semibold text-ink">Nenhuma peça na venda</p>
          <p className="max-w-[260px] text-sm text-ink-3">
            Bipe o código de barras ou toque no tamanho de um produto para adicionar.
          </p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-5" aria-label="Peças na venda">
          {cart.map((item) => (
            <li
              key={`${item.product.id}-${item.size}`}
              className="grid animate-line-in grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b-[1.5px] border-dashed border-rule-strong py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="font-semibold leading-snug text-ink">
                  {item.product.name}
                  {item.size ? (
                    <span className="ml-1.5 inline-block border-[1.5px] border-ink px-1.5 align-[1px] font-tag text-sm font-bold leading-5">
                      {item.size}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {item.product.sku} · {formatCurrency(item.product.salePrice)} cada
                </p>
              </div>
              <PriceTag value={item.product.salePrice * item.quantity} className="self-start pt-0.5 text-lg" />
              <div className="col-span-2 mt-2 flex items-center justify-between">
                <div className="inline-flex items-stretch border border-rule-strong">
                  <button
                    type="button"
                    aria-label={`Diminuir ${item.product.name}`}
                    onClick={() => updateQuantity(item.product.id, item.size, -1)}
                    className="flex h-8 w-8 items-center justify-center text-ink-2 transition-colors hover:bg-sub hover:text-ink"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="flex w-9 items-center justify-center border-x border-rule-strong text-sm font-semibold tabular-nums">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label={`Aumentar ${item.product.name}`}
                    onClick={() => updateQuantity(item.product.id, item.size, 1)}
                    className="flex h-8 w-8 items-center justify-center text-ink-2 transition-colors hover:bg-sub hover:text-ink"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeFromCart(item.product.id, item.size)}
                  className="inline-flex h-8 items-center gap-1.5 px-2 text-sm font-medium text-vermelho transition-colors hover:bg-vermelho-tint"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cart.length > 0 ? (
        <div className="border-t-2 border-ink px-5 pb-5 pt-3">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between text-ink-2">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{formatCurrency(subtotal)}</dd>
            </div>
            {autoDiscountDetails.map((d, i) => (
              <div key={i} className="flex justify-between gap-3 font-medium text-verde">
                <dt>{d.label}</dt>
                <dd className="whitespace-nowrap tabular-nums">−{formatCurrency(d.value)}</dd>
              </div>
            ))}
            {pixDiscount > 0 ? (
              <div className="flex justify-between gap-3 font-medium text-verde">
                <dt>Desconto PIX ({storeSettings.discounts.pixDiscountPercent}%)</dt>
                <dd className="whitespace-nowrap tabular-nums">−{formatCurrency(pixDiscount)}</dd>
              </div>
            ) : null}
            {discount > 0 ? (
              <div className="flex justify-between gap-3 font-medium text-verde">
                <dt>Desconto manual</dt>
                <dd className="whitespace-nowrap tabular-nums">−{formatCurrency(discount)}</dd>
              </div>
            ) : null}
          </dl>
          <div className="mt-2 flex items-end justify-between gap-3 py-2">
            <span className="pb-1 font-tag text-lg font-extrabold uppercase tracking-[0.06em]">Total</span>
            <PriceTag value={total} className="text-[52px] tracking-[-0.01em]" />
          </div>
          <Button size="lg" className="mt-2 h-14 w-full text-lg" onClick={openPaymentModal} disabled={processing}>
            <CreditCard className="h-5 w-5" aria-hidden="true" />
            Finalizar venda
            <kbd className="ml-1 hidden border border-white/50 px-1.5 font-sans text-xs font-medium lg:inline">F9</kbd>
          </Button>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="-m-3 flex h-[calc(100dvh-56px)] flex-col sm:-m-4 md:-m-6 md:h-[100dvh]">
      <PageHeader
        className="static m-0 sm:m-0 md:m-0"
        title="PDV"
        inlineActions
        meta={
          cashRegister ? (
            <>
              <StateTag tone="open">Caixa aberto · {registerOpenedAt}</StateTag>
              <span className="hidden sm:inline">
                <b className="font-semibold text-ink">{cashRegister.salesCount}</b>{" "}
                {cashRegister.salesCount === 1 ? "venda" : "vendas"}
              </span>
              <b className="hidden font-semibold tabular-nums text-ink sm:inline">{formatCurrency(cashRegister.totalSales)}</b>
            </>
          ) : (
            <StateTag tone="closed">Caixa fechado</StateTag>
          )
        }
        actions={
          cashRegister ? (
            <>
              <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => openCashAdjustmentModal("supply")}>
                <ArrowUpCircle className="h-4 w-4" aria-hidden="true" />
                Troco
              </Button>
              <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => openCashAdjustmentModal("withdrawal")}>
                <ArrowDownCircle className="h-4 w-4" aria-hidden="true" />
                Sangria
              </Button>
              <Button variant="danger" size="sm" className="hidden sm:inline-flex" onClick={closeRegisterModal}>
                <Lock className="h-4 w-4" aria-hidden="true" />
                Fechar caixa
              </Button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button variant="outline" size="sm" className="sm:hidden">
                    Caixa
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={6}
                    className="z-50 min-w-[200px] border border-ink bg-paper p-1 shadow-[0_12px_28px_-10px_rgba(40,40,40,0.35)]"
                  >
                    <DropdownMenu.Item
                      onSelect={() => openCashAdjustmentModal("supply")}
                      className="flex h-11 cursor-default items-center gap-2 px-3 text-sm font-semibold outline-none data-[highlighted]:bg-denim-tint"
                    >
                      <ArrowUpCircle className="h-4 w-4" aria-hidden="true" />
                      Adicionar troco
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onSelect={() => openCashAdjustmentModal("withdrawal")}
                      className="flex h-11 cursor-default items-center gap-2 px-3 text-sm font-semibold outline-none data-[highlighted]:bg-denim-tint"
                    >
                      <ArrowDownCircle className="h-4 w-4" aria-hidden="true" />
                      Registrar sangria
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-rule" />
                    <DropdownMenu.Item
                      onSelect={closeRegisterModal}
                      className="flex h-11 cursor-default items-center gap-2 px-3 text-sm font-semibold text-vermelho outline-none data-[highlighted]:bg-vermelho-tint"
                    >
                      <Lock className="h-4 w-4" aria-hidden="true" />
                      Fechar caixa
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </>
          ) : (
            <Button size="sm" onClick={openRegisterModal}>
              <Unlock className="h-4 w-4" aria-hidden="true" />
              Abrir caixa
            </Button>
          )
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-h-0 flex-col px-3 pt-3 sm:px-4 md:px-6 md:pt-5" aria-label="Produtos">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-2" aria-hidden="true" />
            <Input
              ref={searchInputRef}
              aria-label="Buscar produto por nome ou código"
              placeholder="Bipe ou busque o produto"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleBarcodeSearch}
              className="h-11 border-[1.5px] border-ink pl-12 pr-14 text-base focus-visible:border-denim md:h-[52px]"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 border border-rule-strong px-1.5 text-xs font-medium text-ink-2 md:inline">
              F2
            </kbd>
            {lastScanned ? (
              <div
                role="status"
                className="absolute left-0 right-0 top-full z-10 mt-1 flex items-center gap-2 bg-verde px-3 py-2 text-sm font-semibold text-white animate-in fade-in-0 slide-in-from-top-1"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                Lido: {lastScanned}
              </div>
            ) : null}
          </div>

          <div className="-mx-3 mt-3 flex gap-1.5 scroll-row overflow-x-auto px-3 pb-1 sm:-mx-4 sm:px-4 md:mx-0 md:flex-wrap md:overflow-visible md:px-0" role="group" aria-label="Categorias">
            {["", ...productCategories].map((cat) => {
              const active = selectedCategory === cat;
              const count = cat ? categoryCounts[cat] || 0 : products.length;
              return (
                <button
                  key={cat || "todos"}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedCategory(active && cat ? "" : cat)}
                  className={cn(
                    "inline-flex h-9 flex-shrink-0 items-center gap-1.5 border px-3 text-sm font-semibold transition-colors",
                    active
                      ? "border-ink bg-ink text-white"
                      : "border-rule-strong bg-paper text-ink hover:border-ink"
                  )}
                >
                  {cat || "Todos"}
                  <span className={cn("text-xs font-medium tabular-nums", active ? "text-white/70" : "text-ink-3")}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="-mx-3 mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4 sm:-mx-4 sm:px-4 md:-mx-6 md:px-6">
            {loading ? (
              <ul className="space-y-2" aria-hidden="true">
                {Array.from({ length: 7 }).map((_, i) => (
                  <li key={i} className="tag-shape flex h-[68px] items-center gap-3 bg-paper pl-7 pr-4">
                    <div className="h-12 w-12 animate-pulse bg-sub" />
                    <div className="h-3 w-40 animate-pulse bg-sub" />
                  </li>
                ))}
              </ul>
            ) : filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                <p className="font-semibold text-ink">Nenhum produto encontrado</p>
                <p className="text-sm text-ink-3">
                  {search ? `Nada com “${search}”` : "Nenhum produto nesta categoria"}
                  {selectedCategory ? ` em ${selectedCategory}` : ""}.
                </p>
                {(search || selectedCategory) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setSearch("");
                      setSelectedCategory("");
                      searchInputRef.current?.focus();
                    }}
                  >
                    Limpar busca
                  </Button>
                )}
              </div>
            ) : (
              <ul className="space-y-2">
                {filteredProducts.map((product) => {
                  const soldOut = product.stock === 0;
                  const hasSizes = product.sizes?.length > 0;
                  return (
                    <li key={product.id}>
                      <div
                        className={cn(
                          "tag-shape relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 bg-paper py-2 pl-7 pr-3 sm:pr-4 lg:gap-y-2.5 lg:py-2.5 xl:grid-cols-[minmax(0,1fr)_auto_128px]",
                          soldOut && "opacity-60"
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="absolute left-[9px] top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full bg-ground"
                        />
                        <button
                          type="button"
                          onClick={() => handleProductClick(product)}
                          disabled={soldOut}
                          aria-label={`${product.name}, ${formatCurrency(product.salePrice)}, estoque ${product.stock}`}
                          className="col-start-1 row-start-1 flex min-w-0 items-center gap-3 text-left focus-visible:outline-offset-4 disabled:cursor-not-allowed"
                        >
                          <ProductPhoto src={product.image} name={product.name} className="h-10 w-10 lg:h-12 lg:w-12" />
                          <span className="min-w-0">
                            <span className="line-clamp-2 font-semibold leading-snug text-ink">
                              {product.name}
                              {product.plusSized === true ? (
                                <span className="ml-1.5 inline-block bg-ink px-1 align-[2px] font-tag text-[11px] font-bold uppercase leading-4 tracking-[0.06em] text-white">
                                  Plus
                                </span>
                              ) : null}
                            </span>
                            <span className="block text-xs font-medium tracking-[0.04em] text-ink-3">
                              {product.sku}
                              {soldOut ? " · esgotado" : !hasSizes ? ` · ${product.stock} em estoque` : ""}
                            </span>
                          </span>
                        </button>
                        <div className="col-span-2 row-start-2 xl:col-span-1 xl:col-start-2 xl:row-start-1">
                          {hasSizes ? (
                            <SizeGrid
                              sizes={product.sizes}
                              productName={product.name}
                              selected={cartSizesFor(product.id)}
                              onPick={(size) => addToCart(product, size)}
                              size="responsive"
                            />
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={soldOut}
                              onClick={() => addToCart(product, "")}
                            >
                              <Plus className="h-4 w-4" aria-hidden="true" />
                              Adicionar
                            </Button>
                          )}
                        </div>
                        <PriceTag
                          value={product.salePrice}
                          className="col-start-2 row-start-1 justify-self-end text-[26px] xl:col-start-3 xl:text-[30px]"
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <aside
          className="hidden min-h-0 flex-col border-l-[1.5px] border-dashed border-rule-strong bg-paper lg:flex"
          aria-label="Venda atual"
        >
          {renderStub()}
        </aside>
      </div>

      {/* Phones and tablets: the stub folds into a bar, and opens as a sheet. */}
      <div className="flex items-center gap-3 border-t-2 border-ink bg-paper px-3 py-2.5 sm:px-4 lg:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink-3">
            {totalItems} {totalItems === 1 ? "peça" : "peças"}
          </p>
          <PriceTag value={total} className="text-[28px]" />
        </div>
        <Button variant="outline" onClick={() => setShowMobileCart(true)}>
          Ver venda
        </Button>
        <Button onClick={openPaymentModal} disabled={processing || cart.length === 0}>
          Finalizar
        </Button>
      </div>
      {showMobileCart ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-paper animate-in slide-in-from-bottom-4 fade-in-0 duration-200 lg:hidden" role="dialog" aria-modal="true" aria-label="Venda atual">
          <div className="flex h-14 flex-shrink-0 items-center justify-end border-b border-rule px-2">
            <button
              type="button"
              onClick={() => setShowMobileCart(false)}
              className="inline-flex h-10 items-center gap-1.5 px-3 text-sm font-semibold text-ink hover:bg-sub"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Voltar aos produtos
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{renderStub()}</div>
        </div>
      ) : null}

      {/* Payment Method Dialog */}
      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Pagamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="border-b-[1.5px] border-dashed border-rule-strong pb-3">
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between text-ink-2">
                  <dt>Subtotal · {totalItems} {totalItems === 1 ? "peça" : "peças"}</dt>
                  <dd className="tabular-nums">{formatCurrency(subtotal)}</dd>
                </div>
                {autoDiscountDetails.map((d, i) => (
                  <div key={i} className="flex justify-between gap-3 font-medium text-verde">
                    <dt>{d.label}</dt>
                    <dd className="whitespace-nowrap tabular-nums">−{formatCurrency(d.value)}</dd>
                  </div>
                ))}
                {pixDiscount > 0 && (
                  <div className="flex justify-between gap-3 font-medium text-verde">
                    <dt>Desconto PIX ({storeSettings.discounts.pixDiscountPercent}%)</dt>
                    <dd className="whitespace-nowrap tabular-nums">−{formatCurrency(pixDiscount)}</dd>
                  </div>
                )}
                {discount > 0 && (
                  <div className="flex justify-between gap-3 font-medium text-verde">
                    <dt>Desconto manual</dt>
                    <dd className="whitespace-nowrap tabular-nums">−{formatCurrency(discount)}</dd>
                  </div>
                )}
              </dl>
              <div className="mt-2 flex items-end justify-between gap-3">
                <span className="pb-1 font-tag text-lg font-extrabold uppercase tracking-[0.06em]">Total</span>
                <PriceTag value={total} className="text-[44px]" />
              </div>
            </div>

            {storeSettings.discounts.pixDiscountEnabled && !payments.some(p => p.method === "PIX") && (
              <p className="flex items-center gap-2 text-sm font-medium text-verde">
                <BadgePercent className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                Pagando com PIX, a venda ganha {storeSettings.discounts.pixDiscountPercent}% de desconto.
              </p>
            )}

            {canApplyDiscount && (
              <div className="space-y-2">
                <Label htmlFor="discount-input">
                  Desconto adicional (R$)
                  {userData?.role === "CASHIER" && (
                    <span className="ml-2 text-xs font-normal text-ink-3">
                      até {formatCurrency(maxCashierDiscount)} sem autorização
                    </span>
                  )}
                </Label>
                <Input
                  id="discount-input"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  max={subtotal - totalAutoDiscount}
                  value={discount || ""}
                  onChange={(e) => handleDiscountChange(Math.min(subtotal - totalAutoDiscount, parseFloat(e.target.value) || 0))}
                  placeholder="0,00"
                  className="text-right tabular-nums"
                />
                {userData?.role === "CASHIER" && discount > maxCashierDiscount && (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-vermelho" aria-hidden="true" />
                    Desconto acima de 10% precisa da senha de um administrador.
                  </p>
                )}
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-semibold text-ink">Forma de pagamento</p>
              <div className="grid grid-cols-4 gap-2">
                {([
                  { method: "DINHEIRO", label: "Dinheiro", icon: Banknote },
                  { method: "DEBITO", label: "Débito", icon: CreditCard },
                  { method: "CREDITO", label: "Crédito", icon: CreditCard },
                  { method: "PIX", label: "PIX", icon: Smartphone },
                ] as const).map(({ method, label, icon: Icon }) => {
                  const added = payments.some(p => p.method === method);
                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => addPaymentMethod(method)}
                      disabled={added}
                      className={cn(
                        "flex h-16 flex-col items-center justify-center gap-1 border-[1.5px] text-sm font-semibold transition-colors",
                        added
                          ? "cursor-default border-ink bg-ink text-white"
                          : "border-ink bg-paper text-ink hover:bg-denim hover:text-white hover:border-denim"
                      )}
                    >
                      <Icon className="h-5 w-5" aria-hidden="true" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {payments.length > 0 && (
              <div className="space-y-2">
                {payments.map((payment) => {
                  const methodLabel =
                    payment.method === "DINHEIRO" ? "Dinheiro" :
                    payment.method === "DEBITO" ? "Débito" :
                    payment.method === "CREDITO" ? "Crédito" : "PIX";
                  return (
                  <div key={payment.method} className="flex items-center gap-2 border border-rule bg-sub py-1.5 pl-3 pr-1.5">
                    <span className="flex-1 text-sm font-semibold">{methodLabel}</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      aria-label={`Valor em ${methodLabel}`}
                      value={payment.amount || ""}
                      onChange={(e) => updatePaymentAmount(payment.method, parseFloat(e.target.value) || 0)}
                      className="h-9 w-32 text-right tabular-nums"
                      placeholder="0,00"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-vermelho hover:bg-vermelho-tint"
                      aria-label={`Remover ${methodLabel}`}
                      onClick={() => removePaymentMethod(payment.method)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  );
                })}
                <dl className="flex items-baseline justify-between border-t border-rule pt-2 text-sm">
                  <div className="flex gap-2 text-ink-2">
                    <dt>Pago</dt>
                    <dd className="font-semibold tabular-nums text-ink">{formatCurrency(totalPaid)}</dd>
                  </div>
                  <div className={cn("flex items-baseline gap-2", remaining > 0.01 ? "text-vermelho" : "text-verde")}>
                    <dt className="font-semibold">{remaining > 0.01 ? "Falta" : "Troco"}</dt>
                    <dd className="font-tag text-2xl font-extrabold tabular-nums">{formatCurrency(Math.abs(remaining))}</dd>
                  </div>
                </dl>
              </div>
            )}

            {payments.length === 0 && !showPayLater && (
              <p className="text-sm text-ink-3">Escolha a forma de pagamento. Dá para dividir a venda em mais de uma.</p>
            )}

            {canUsePayLater && (
              <div className="border-t border-rule pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">Vender fiado</p>
                    <p className="text-xs text-ink-3">Paga depois: o valor fica na conta do cliente.</p>
                  </div>
                  <Button
                    variant={showPayLater ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setShowPayLater(!showPayLater)}
                  >
                    {showPayLater ? "Cancelar fiado" : "Vender fiado"}
                  </Button>
                </div>

                {showPayLater && (
                  <div className="mt-3 space-y-2">
                    <Label htmlFor="fiado-client">Cliente</Label>
                    <select
                      id="fiado-client"
                      className="h-10 w-full border border-input bg-paper px-3 text-sm text-ink focus-visible:border-denim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-denim"
                      value={selectedClientId}
                      onChange={(e) => setSelectedClientId(e.target.value)}
                    >
                      <option value="">Selecione o cliente…</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name} {client.balance > 0 ? `(deve ${formatCurrency(client.balance)})` : ""}
                        </option>
                      ))}
                    </select>
                    {clients.length === 0 && (
                      <p className="text-xs text-ink-3">Nenhum cliente cadastrado. Cadastre em Clientes e fiado.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setShowPaymentModal(false)}>
                Voltar
              </Button>
              {showPayLater ? (
                <Button
                  className="flex-1"
                  onClick={handlePayLater}
                  disabled={processing || !selectedClientId}
                >
                  {processing ? "Registrando…" : "Confirmar fiado"}
                </Button>
              ) : (
                <Button
                  className="flex-1"
                  onClick={handleCheckout}
                  disabled={processing || remaining > 0.01 || payments.length === 0}
                >
                  {processing ? "Registrando…" : "Confirmar venda"}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Admin Password Verification Modal */}
      <Dialog open={showAdminPasswordModal} onOpenChange={setShowAdminPasswordModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Autorização do administrador</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-ink-2">
              Descontos acima de 10% precisam da senha de um administrador.
            </p>
            <div className="space-y-2">
              <Label htmlFor="admin-password">Senha do administrador</Label>
              <Input
                id="admin-password"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowAdminPasswordModal(false);
                  setAdminPassword("");
                  setDiscount(0); // Reset discount if cancelled
                }}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1"
                onClick={handleAdminVerification}
                disabled={verifyingAdmin}
              >
                {verifyingAdmin ? "Verificando…" : "Autorizar desconto"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCashAdjustmentModal} onOpenChange={setShowCashAdjustmentModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{cashAdjustmentType === "supply" ? "Adicionar troco" : "Registrar sangria"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cash-adjustment-amount">Valor (R$)</Label>
              <Input
                id="cash-adjustment-amount"
                type="number"
                min="0"
                step="0.01"
                value={cashAdjustmentAmount}
                onChange={(e) => setCashAdjustmentAmount(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cash-adjustment-note">Observação (opcional)</Label>
              <Input
                id="cash-adjustment-note"
                value={cashAdjustmentNote}
                onChange={(e) => setCashAdjustmentNote(e.target.value)}
                placeholder="Ex.: Troco para início do turno"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowCashAdjustmentModal(false)} disabled={processingCashAdjustment}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={handleCashAdjustment} disabled={processingCashAdjustment}>
                {processingCashAdjustment ? "Registrando…" : cashAdjustmentType === "supply" ? "Adicionar troco" : "Registrar sangria"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Size Selection Dialog: opened by a scan or a click on the product itself */}
      <Dialog open={!!selectedProduct} onOpenChange={() => setSelectedProduct(null)}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-4xl">
          {selectedProduct && (
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="flex items-center justify-center bg-sub p-6">
                <ProductPhoto
                  src={selectedProduct.image}
                  name={selectedProduct.name}
                  className="aspect-square h-auto w-full max-w-[360px]"
                />
              </div>
              <div className="flex flex-col p-6">
                <DialogHeader className="mb-1">
                  <DialogTitle className="font-sans text-xl font-bold normal-case tracking-normal">
                    {selectedProduct.name}
                  </DialogTitle>
                  <p className="text-sm text-ink-3">{selectedProduct.sku}</p>
                </DialogHeader>
                <PriceTag value={selectedProduct.salePrice} className="mt-2 text-[40px]" />
                <p className="mb-2 mt-6 font-tag text-sm font-bold uppercase tracking-[0.1em] text-ink-2">
                  Escolha o tamanho
                </p>
                <div className="grid grid-cols-3 border-l-[1.5px] border-t-[1.5px] border-ink">
                  {selectedProduct.sizes?.map((sizeData) => {
                    const out = sizeData.stock === 0;
                    return (
                      <button
                        key={sizeData.size}
                        type="button"
                        disabled={out}
                        onClick={() => addToCart(selectedProduct, sizeData.size)}
                        className={cn(
                          "flex h-[72px] flex-col items-center justify-center border-b-[1.5px] border-r-[1.5px] border-ink transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-denim",
                          out ? "cursor-not-allowed bg-sub text-ink-3/60" : "bg-paper text-ink hover:bg-denim hover:text-white"
                        )}
                      >
                        <span className="font-tag text-2xl font-bold leading-none">{sizeData.size}</span>
                        <span className={cn("mt-1 text-xs font-semibold", !out && sizeData.stock <= 1 ? "text-vermelho" : "opacity-70")}>
                          {out ? "esgotado" : `${sizeData.stock} em estoque`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Open Register Dialog */}
      <Dialog open={showOpenRegisterModal} onOpenChange={setShowOpenRegisterModal}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Abrir caixa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Contagem por cédulas e moedas</Label>
              <div className="max-h-[50dvh] space-y-4 overflow-y-auto border border-rule p-3">
                {CASH_DENOMINATION_GROUPS.map((group) => (
                  <div key={`open-group-${group.label}`} className="space-y-2">
                    <p className="font-tag text-xs font-bold uppercase tracking-[0.1em] text-ink-2">{group.label}</p>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                      {group.values.map((denomination) => (
                        <div key={`open-${denomination}`} className="min-w-0 space-y-1 border border-rule bg-paper p-2">
                          <div className="font-tag text-base font-bold tabular-nums">{formatCurrency(denomination)}</div>
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={openingDenominations[denomination.toString()] || ""}
                            onChange={(e) => handleDenominationQuantityChange("open", denomination, e.target.value)}
                            placeholder="0"
                            className="h-9 text-right tabular-nums"
                          />
                          <div className="text-xs text-ink-3 text-right">
                            {formatCurrency((openingDenominations[denomination.toString()] || 0) * denomination)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-end justify-between border-t-2 border-ink pt-3">
              <span className="pb-1 text-sm font-semibold text-ink-2">Saldo inicial contado</span>
              <PriceTag value={openingBalance} className="text-[36px]" />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowOpenRegisterModal(false);
                  setOpeningDenominations(createEmptyDenominationCounts());
                  setOpeningBalance(0);
                  pendingCheckoutAction.current = null;
                }}
              >
                Cancelar
              </Button>
              <Button className="flex-1" onClick={handleOpenRegister} disabled={openingRegister}>
                <Unlock className="h-4 w-4" aria-hidden="true" />
                {openingRegister ? "Abrindo…" : "Abrir caixa"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Close Register Dialog */}
      <Dialog open={showCloseRegisterModal} onOpenChange={setShowCloseRegisterModal}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Fechar caixa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {cashRegister && (
              <div className="space-y-1.5 border border-rule bg-sub p-4 text-sm tabular-nums">
                <div className="flex justify-between">
                  <span className="text-ink-2">Saldo inicial</span>
                  <span className="font-medium">{formatCurrency(cashRegister.openingBalance)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-2">Total em vendas</span>
                  <span className="font-medium">{formatCurrency(cashRegister.totalSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-2">Diferença de troca (entrada)</span>
                  <span className="font-medium">{formatCurrency(cashRegister.totalExchangeDifferenceIn || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-2">Dinheiro recebido</span>
                  <span className="font-medium">{formatCurrency(cashRegister.totalCash)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-2">Troco adicionado</span>
                  <span className="font-medium text-verde">{formatCurrency(cashRegister.totalCashSupply || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-2">Sangrias</span>
                  <span className="font-medium text-vermelho">−{formatCurrency(cashRegister.totalCashWithdrawal || 0)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-base font-bold">
                  <span>Saldo esperado em dinheiro</span>
                  <span>
                    {formatCurrency(
                      cashRegister.openingBalance +
                        cashRegister.totalCash +
                        (cashRegister.totalCashSupply || 0) -
                        (cashRegister.totalCashWithdrawal || 0)
                    )}
                  </span>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Contagem por cédulas e moedas</Label>
              <div className="max-h-[50dvh] space-y-4 overflow-y-auto border border-rule p-3">
                {CASH_DENOMINATION_GROUPS.map((group) => (
                  <div key={`close-group-${group.label}`} className="space-y-2">
                    <p className="font-tag text-xs font-bold uppercase tracking-[0.1em] text-ink-2">{group.label}</p>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                      {group.values.map((denomination) => (
                        <div key={`close-${denomination}`} className="min-w-0 space-y-1 border border-rule bg-paper p-2">
                          <div className="font-tag text-base font-bold tabular-nums">{formatCurrency(denomination)}</div>
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={closingDenominations[denomination.toString()] || ""}
                            onChange={(e) => handleDenominationQuantityChange("close", denomination, e.target.value)}
                            placeholder="0"
                            className="h-9 text-right tabular-nums"
                          />
                          <div className="text-xs text-ink-3 text-right">
                            {formatCurrency((closingDenominations[denomination.toString()] || 0) * denomination)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-end justify-between border-t-2 border-ink pt-3">
              <span className="pb-1 text-sm font-semibold text-ink-2">Saldo final contado</span>
              <PriceTag value={closingBalance} className="text-[36px]" />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowCloseRegisterModal(false);
                  setClosingDenominations(createEmptyDenominationCounts());
                  setClosingBalance(0);
                }}
              >
                Cancelar
              </Button>
              <Button variant="destructive" className="flex-1" onClick={handleCloseRegister} disabled={closingRegister}>
                <Lock className="h-4 w-4" aria-hidden="true" />
                {closingRegister ? "Fechando…" : "Fechar caixa"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Closing Report Dialog */}
      <Dialog open={showClosingReport} onOpenChange={setShowClosingReport}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Fechamento de caixa</DialogTitle>
          </DialogHeader>
          {closingReportData && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b-[1.5px] border-dashed border-rule-strong pb-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-ink-3">Operador</dt>
                  <dd className="font-semibold">{closingReportData.register.userName}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-ink-3">Período</dt>
                  <dd className="font-semibold">
                    {new Date(closingReportData.register.openedAt).toLocaleString("pt-BR")} até{" "}
                    {closingReportData.register.closedAt ? new Date(closingReportData.register.closedAt).toLocaleString("pt-BR") : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">Total em vendas</dt>
                  <dd><PriceTag value={closingReportData.register.totalSales} className="text-2xl" /></dd>
                </div>
                <div>
                  <dt className="text-ink-3">Vendas</dt>
                  <dd className="font-tag text-2xl font-extrabold tabular-nums">{closingReportData.register.salesCount}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Diferença de troca</dt>
                  <dd><PriceTag value={closingReportData.register.totalExchangeDifferenceIn || 0} className="text-2xl" /></dd>
                </div>
                <div>
                  <dt className="text-ink-3">Saldo inicial</dt>
                  <dd className="font-semibold tabular-nums">{formatCurrency(closingReportData.register.openingBalance)}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Saldo final</dt>
                  <dd className="font-semibold tabular-nums">{formatCurrency(closingReportData.register.closingBalance || 0)}</dd>
                </div>
              </dl>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Formas de pagamento</CardTitle>
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
                    <span className="font-medium text-vermelho">Fiado</span>
                    <span className="font-medium text-vermelho">
                      {formatCurrency(closingReportData.orders.filter(o => o.isPaidLater).reduce((sum, o) => sum + o.totalAmount, 0))}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Conferência do caixa</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Esperado (inicial + dinheiro + troco − sangria)</span>
                    <span className="font-medium">
                      {formatCurrency(
                        closingReportData.register.openingBalance +
                          closingReportData.register.totalCash +
                          (closingReportData.register.totalCashSupply || 0) -
                          (closingReportData.register.totalCashWithdrawal || 0)
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Contado no fechamento</span>
                    <span className="font-medium">{formatCurrency(closingReportData.register.closingBalance || 0)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-sm font-bold">
                    <span>Diferença</span>
                    <span
                      className={
                        (closingReportData.register.closingBalance || 0) -
                          (closingReportData.register.openingBalance +
                            closingReportData.register.totalCash +
                            (closingReportData.register.totalCashSupply || 0) -
                            (closingReportData.register.totalCashWithdrawal || 0)) <
                        0
                          ? "text-vermelho"
                          : "text-verde"
                      }
                    >
                      {formatCurrency(
                        (closingReportData.register.closingBalance || 0) -
                          (closingReportData.register.openingBalance +
                            closingReportData.register.totalCash +
                            (closingReportData.register.totalCashSupply || 0) -
                            (closingReportData.register.totalCashWithdrawal || 0))
                      )}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {closingReportData.orders.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Vendas do caixa · {closingReportData.orders.length}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-48 overflow-y-auto space-y-2">
                      {closingReportData.orders.map((order, index) => (
                        <div key={order.id} className="flex items-center justify-between border-b border-rule py-2 text-sm last:border-b-0">
                          <div>
                            <span className="font-medium">#{index + 1}</span>
                            <span className="text-ink-3 ml-2">{new Date(order.createdAt).toLocaleTimeString("pt-BR")}</span>
                            {order.clientName && (
                              <span className="text-denim ml-2 text-xs">({order.clientName})</span>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="font-medium">{formatCurrency(order.totalAmount)}</span>
                            <span className={`ml-2 text-xs ${order.isPaidLater ? 'font-semibold text-vermelho' : 'text-ink-3'}`}>
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
                  <FileText className="h-4 w-4" aria-hidden="true" />
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

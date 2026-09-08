import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  BarChart3,
  Settings,
  Store,
  ClipboardList,
  Boxes,
  UserCheck,
  Barcode,
  Receipt,
  Truck,
  FileText,
  Percent,
  Tags,
  type LucideIcon,
} from "lucide-react";

export type AppRole = "ADMIN" | "CASHIER";

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  roles: AppRole[];
}

/**
 * Single source of truth for which roles may see/enter each dashboard route. Consumed by the
 * sidebar (to filter links) and by the dashboard layout (to gate direct URL navigation), so a
 * cashier can't reach an admin-only screen by typing its path.
 */
export const NAVIGATION: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["ADMIN", "CASHIER"] },
  { name: "PDV", href: "/pos", icon: ShoppingCart, roles: ["ADMIN", "CASHIER"] },
  { name: "Produtos", href: "/products", icon: Package, roles: ["ADMIN"] },
  { name: "Categorias", href: "/products/categories", icon: Tags, roles: ["ADMIN"] },
  { name: "Vendas", href: "/sales", icon: ClipboardList, roles: ["ADMIN", "CASHIER"] },
  { name: "Vendas Mensais", href: "/sales-month", icon: BarChart3, roles: ["ADMIN"] },
  { name: "Comissão", href: "/comission", icon: Percent, roles: ["ADMIN", "CASHIER"] },
  { name: "Trocas", href: "/exchanges", icon: ClipboardList, roles: ["ADMIN", "CASHIER"] },
  { name: "Estoque", href: "/inventory", icon: Boxes, roles: ["ADMIN"] },
  { name: "Entradas de Estoque", href: "/stock-entries", icon: Boxes, roles: ["ADMIN"] },
  { name: "Clientes", href: "/clients", icon: UserCheck, roles: ["ADMIN"] },
  { name: "Fornecedores", href: "/suppliers", icon: Truck, roles: ["ADMIN"] },
  { name: "Contas", href: "/bills", icon: Receipt, roles: ["ADMIN"] },
  { name: "Relatórios", href: "/reports", icon: BarChart3, roles: ["ADMIN"] },
  { name: "Correções de Débito", href: "/debt-corrections", icon: FileText, roles: ["ADMIN"] },
  { name: "Códigos de Barras", href: "/barcodes", icon: Barcode, roles: ["ADMIN"] },
  { name: "Usuários", href: "/users", icon: Store, roles: ["ADMIN"] },
  { name: "Configurações", href: "/settings", icon: Settings, roles: ["ADMIN"] },
];

/**
 * Returns true when `role` is allowed to view `pathname`. Unknown paths (e.g. a future page not
 * yet in NAVIGATION) default to allowed — the API routes behind them remain the real
 * enforcement boundary; this is a UX guard, not the security boundary.
 */
export function canAccessPath(pathname: string, role: AppRole): boolean {
  const match = NAVIGATION.filter(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  ).sort((a, b) => b.href.length - a.href.length)[0];
  if (!match) return true;
  return match.roles.includes(role);
}

import {
  ArrowLeftRight,
  Barcode,
  BarChart3,
  Boxes,
  CalendarDays,
  Contact,
  FilePen,
  Home,
  Package,
  PackagePlus,
  Percent,
  Receipt,
  ScrollText,
  Settings,
  ShoppingCart,
  Tags,
  Truck,
  UserCog,
} from "lucide-react";

export type Role = "ADMIN" | "CASHIER";

export interface NavItem {
  name: string;
  href: string;
  icon: typeof Home;
  roles: Role[];
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

const BOTH: Role[] = ["ADMIN", "CASHIER"];
const ADMIN: Role[] = ["ADMIN"];

/** Every screen, who may open it, and where it sits in the menu. */
export const navigation: NavGroup[] = [
  {
    items: [{ name: "Início", href: "/dashboard", icon: Home, roles: BOTH }],
  },
  {
    label: "Balcão",
    items: [
      { name: "PDV", href: "/pos", icon: ShoppingCart, roles: BOTH },
      { name: "Vendas", href: "/sales", icon: ScrollText, roles: BOTH },
      { name: "Trocas", href: "/exchanges", icon: ArrowLeftRight, roles: BOTH },
      { name: "Clientes e fiado", href: "/clients", icon: Contact, roles: BOTH },
      { name: "Códigos de barras", href: "/barcodes", icon: Barcode, roles: BOTH },
    ],
  },
  {
    label: "Estoque",
    items: [
      { name: "Produtos", href: "/products", icon: Package, roles: ADMIN },
      { name: "Categorias", href: "/products/categories", icon: Tags, roles: ADMIN },
      { name: "Estoque", href: "/inventory", icon: Boxes, roles: ADMIN },
      { name: "Entradas de estoque", href: "/stock-entries", icon: PackagePlus, roles: ADMIN },
    ],
  },
  {
    label: "Financeiro",
    items: [
      { name: "Vendas mensais", href: "/sales-month", icon: CalendarDays, roles: ADMIN },
      { name: "Comissão", href: "/comission", icon: Percent, roles: BOTH },
      { name: "Contas", href: "/bills", icon: Receipt, roles: ADMIN },
      { name: "Fornecedores", href: "/suppliers", icon: Truck, roles: ADMIN },
      { name: "Relatórios", href: "/reports", icon: BarChart3, roles: ADMIN },
      { name: "Correções de débito", href: "/debt-corrections", icon: FilePen, roles: ADMIN },
    ],
  },
  {
    label: "Sistema",
    items: [
      { name: "Usuários", href: "/users", icon: UserCog, roles: ADMIN },
      { name: "Configurações", href: "/settings", icon: Settings, roles: ADMIN },
    ],
  },
];

export const allNavHrefs = navigation.flatMap((group) => group.items.map((item) => item.href));

/**
 * Who may open a path: the most specific menu entry that contains it decides
 * (/products/categories is its own entry, not /products). Paths outside the menu are open.
 */
export function rolesForPath(pathname: string): Role[] | null {
  let best: NavItem | null = null;
  for (const group of navigation) {
    for (const item of group.items) {
      const matches = pathname === item.href || pathname.startsWith(item.href + "/");
      if (matches && (!best || item.href.length > best.href.length)) best = item;
    }
  }
  return best ? best.roles : null;
}

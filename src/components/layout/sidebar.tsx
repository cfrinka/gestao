"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import {
  ArrowLeftRight,
  Barcode,
  BarChart3,
  Boxes,
  CalendarDays,
  Contact,
  FilePen,
  Home,
  LogOut,
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
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

interface SidebarProps {
  mobile?: boolean;
  onNavigate?: () => void;
}

type Role = "ADMIN" | "CASHIER";

interface NavItem {
  name: string;
  href: string;
  icon: typeof Home;
  roles: Role[];
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const BOTH: Role[] = ["ADMIN", "CASHIER"];
const ADMIN: Role[] = ["ADMIN"];

const navigation: NavGroup[] = [
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

const allHrefs = navigation.flatMap((g) => g.items.map((i) => i.href));

export function Sidebar({ mobile = false, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { userData, signOut } = useAuth();
  const userRole: Role = userData?.role || "CASHIER";

  const groups = navigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.roles.includes(userRole)),
    }))
    .filter((group) => group.items.length > 0);

  const isActive = (href: string) => {
    const hasChildRoute = allHrefs.some((other) => other !== href && other.startsWith(href + "/"));
    return hasChildRoute
      ? pathname === href
      : pathname === href || pathname.startsWith(href + "/");
  };

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <div
      className={cn(
        mobile ? "flex h-full w-[264px] flex-col" : "hidden md:flex md:w-[220px] md:flex-shrink-0 md:flex-col"
      )}
    >
      <div className="flex h-full min-h-0 flex-grow flex-col border-r border-rule bg-paper">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className={cn("mx-5 mb-1 block flex-shrink-0 focus-visible:outline-offset-4", mobile ? "mt-4 w-[104px]" : "mt-3 w-[84px]")}
        >
          <Logo variant="color" className="w-full" />
        </Link>

        <nav className="min-h-0 flex-1 overflow-y-auto pb-3" aria-label="Navegação principal">
          {groups.map((group, gi) => (
            <div key={group.label ?? `g${gi}`} className={cn(group.label ? (mobile ? "mt-3" : "mt-2") : "mt-1.5")}>
              {group.label ? (
                <h2 className="px-5 pb-1 font-tag text-xs font-bold uppercase tracking-[0.14em] text-ink-3">
                  {group.label}
                </h2>
              ) : null}
              <ul>
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group flex items-center gap-2.5 px-5 text-[14px] transition-colors duration-100", mobile ? "h-10" : "h-7",
                          active
                            ? "bg-ink font-semibold text-white"
                            : "text-ink hover:bg-sub"
                        )}
                      >
                        <item.icon
                          className={cn(
                            "h-4 w-4 flex-shrink-0",
                            active ? "text-white" : "text-ink-3 group-hover:text-ink"
                          )}
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                        <span className="truncate">{item.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex flex-shrink-0 items-center gap-2 border-t border-rule py-2.5 pl-5 pr-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink" title={userData?.email || undefined}>
              {userData?.name || "Usuário"}
            </p>
            <p className="truncate text-xs text-ink-3">{userData?.role === "ADMIN" ? "Administrador" : "Caixa"}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 border-[1.5px] border-ink px-2 text-sm font-semibold text-ink transition-colors hover:bg-sub"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}

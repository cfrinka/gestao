"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  BarChart3,
  Settings,
  Store,
  ClipboardList,
  Boxes,
  UserCheck,
  Barcode,
  Receipt,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["ADMIN", "CASHIER"] },
  { name: "PDV", href: "/pos", icon: ShoppingCart, roles: ["ADMIN", "CASHIER"] },
  { name: "Produtos", href: "/products", icon: Package, roles: ["ADMIN"] },
  { name: "Vendas", href: "/sales", icon: ClipboardList, roles: ["ADMIN", "CASHIER"] },
  { name: "Estoque", href: "/inventory", icon: Boxes, roles: ["ADMIN"] },
  { name: "Clientes", href: "/clients", icon: UserCheck, roles: ["ADMIN"] },
  { name: "Fornecedores", href: "/suppliers", icon: Truck, roles: ["ADMIN"] },
  { name: "Contas", href: "/bills", icon: Receipt, roles: ["ADMIN"] },
  { name: "Relatórios", href: "/reports", icon: BarChart3, roles: ["ADMIN"] },
  { name: "Códigos de Barras", href: "/barcodes", icon: Barcode, roles: ["ADMIN"] },
  { name: "Usuários", href: "/users", icon: Store, roles: ["ADMIN"] },
  { name: "Configurações", href: "/settings", icon: Settings, roles: ["ADMIN"] },
];

export function Sidebar() {
  const pathname = usePathname();
  const { userData } = useAuth();
  const userRole = userData?.role || "CASHIER";

  const filteredNavigation = navigation.filter((item) =>
    item.roles.includes(userRole)
  );

  return (
    <div className="hidden md:flex md:w-64 md:flex-col">
      <div className="flex flex-col flex-grow pt-5 bg-[#2A5473] overflow-y-auto">
        <div className="flex items-center flex-shrink-0 px-4 gap-2">
          <Store className="h-8 w-8 text-white" />
          <span className="text-white text-xl font-bold">Gestão Loja</span>
        </div>
        <div className="mt-8 flex-grow flex flex-col">
          <nav className="flex-1 px-2 space-y-1">
            {filteredNavigation.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    isActive
                      ? "bg-[#355444] text-white"
                      : "text-white/80 hover:bg-[#355444]/70 hover:text-white",
                    "group flex items-center px-2 py-2 text-sm font-medium rounded-md transition-colors"
                  )}
                >
                  <item.icon
                    className={cn(
                      isActive ? "text-[#7ED957]" : "text-white/70 group-hover:text-white",
                      "mr-3 flex-shrink-0 h-5 w-5"
                    )}
                    aria-hidden="true"
                  />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}

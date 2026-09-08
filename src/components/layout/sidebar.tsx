"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAVIGATION, type AppRole } from "@/lib/navigation";

interface SidebarProps {
  mobile?: boolean;
  onNavigate?: () => void;
}

export function Sidebar({ mobile = false, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const { userData } = useAuth();
  const userRole: AppRole = userData?.role === "ADMIN" ? "ADMIN" : "CASHIER";

  const filteredNavigation = NAVIGATION.filter((item) =>
    item.roles.includes(userRole)
  );

  const wrapperClassName = mobile ? "flex w-64 flex-col h-full" : "hidden md:flex md:w-64 md:flex-col";

  return (
    <div className={wrapperClassName}>
      <div className="flex flex-col flex-grow pt-5 bg-[#2A5473] overflow-y-auto">
        <div className="flex items-center flex-shrink-0 px-4 gap-2">
          <Store className="h-8 w-8 text-white" />
          <span className="text-white text-xl font-bold">Gestão Loja</span>
        </div>
        <div className="mt-8 flex-grow flex flex-col">
          <nav className="flex-1 px-2 space-y-1">
            {filteredNavigation.map((item) => {
              const hasChildRoute = filteredNavigation.some(
                (other) => other.href !== item.href && other.href.startsWith(item.href + "/")
              );
              const isActive = hasChildRoute
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={onNavigate}
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

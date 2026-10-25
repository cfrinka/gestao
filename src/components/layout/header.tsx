"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { Logo } from "@/components/brand/logo";

interface HeaderProps {
  onOpenMobileMenu?: () => void;
}

/** Phone and small-tablet bar: menu and logo. Desktop keeps the rail instead. */
export function Header({ onOpenMobileMenu }: HeaderProps) {
  return (
    <header className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-rule bg-paper px-2 md:hidden">
      <button
        type="button"
        onClick={onOpenMobileMenu}
        aria-label="Abrir menu"
        className="flex h-10 w-10 items-center justify-center text-ink transition-colors hover:bg-sub"
      >
        <Menu className="h-5 w-5" />
      </button>
      <Link href="/dashboard" className="block w-[64px]">
        <Logo variant="color" className="w-full" />
      </Link>
    </header>
  );
}

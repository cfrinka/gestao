"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api-client";
import { ArrowLeftRight, ArrowRight, Contact, Package, ShoppingCart } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { PriceTag } from "@/components/etiqueta/price-tag";

interface DashboardStats {
  totalProducts: number;
  totalOrders: number;
  totalRevenue: number | null;
  totalProfit: number | null;
}

interface RecentOrder {
  id: string;
  createdAt: string;
  totalAmount: number;
  itemCount: number;
}

function dayLabel(date: Date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Hoje";
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return date.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
}

export default function DashboardPage() {
  const { userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    totalProducts: 0,
    totalOrders: 0,
    totalRevenue: null,
    totalProfit: null,
  });
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);

  useEffect(() => {
    async function fetchData() {
      try {
        // Reports are admin-only; cashiers see the counts without the money totals.
        // Counts and the last few sales only — this screen used to download every sale ever made.
        const [summary, report] = await Promise.all([
          apiGet("/api/orders/summary"),
          apiGet("/api/reports").catch(() => null),
        ]);

        setStats({
          totalProducts: Number(summary?.productsCount || 0),
          totalOrders: Number(summary?.ordersCount || 0),
          totalRevenue: report ? report.revenue || 0 : null,
          totalProfit: report ? report.profit || 0 : null,
        });

        setRecentOrders(Array.isArray(summary?.recent) ? summary.recent : []);
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      } finally {
        setLoading(false);
      }
    }

    if (userData) {
      fetchData();
    }
  }, [userData]);

  const isAdmin = userData?.role === "ADMIN";
  const firstName = userData?.name?.split(" ")[0] || "";

  const shortcuts = [
    { href: "/pos", label: "Abrir o PDV", hint: "Vender e cuidar do caixa", icon: ShoppingCart },
    { href: "/exchanges", label: "Fazer uma troca", hint: "Peça que volta, peça que sai", icon: ArrowLeftRight },
    { href: "/clients", label: "Clientes e fiado", hint: "Receber e consultar débitos", icon: Contact },
    ...(isAdmin
      ? [{ href: "/products", label: "Produtos", hint: "Cadastro, preços e tamanhos", icon: Package }]
      : []),
  ];

  // Group recent sales by day, newest first.
  const groups: { label: string; orders: RecentOrder[] }[] = [];
  for (const order of recentOrders) {
    const label = dayLabel(new Date(order.createdAt));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.orders.push(order);
    else groups.push({ label, orders: [order] });
  }

  return (
    <div>
      <PageHeader
        title="Início"
        meta={
          <span>
            {firstName ? `Olá, ${firstName}` : "Olá"} · {isAdmin ? "Administrador" : "Caixa"}
          </span>
        }
      />

      <div className="grid gap-4 md:gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="border border-rule bg-paper" aria-labelledby="recent-title">
          <div className="flex items-baseline justify-between gap-3 border-b border-rule px-4 py-3 md:px-5">
            <h2 id="recent-title" className="font-tag text-lg font-bold uppercase tracking-[0.04em]">
              Vendas recentes
            </h2>
            <Link href="/sales" className="inline-flex items-center gap-1 text-sm font-semibold text-denim hover:underline">
              Ver todas <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

          {loading ? (
            <ul aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="flex items-center justify-between border-b border-rule px-4 py-4 md:px-5">
                  <div className="h-3 w-32 animate-pulse bg-sub" />
                  <div className="h-4 w-20 animate-pulse bg-sub" />
                </li>
              ))}
            </ul>
          ) : recentOrders.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <p className="font-semibold text-ink">Nenhuma venda registrada ainda</p>
              <p className="mt-1 text-sm text-ink-3">As vendas feitas no PDV aparecem aqui, da mais nova para a mais antiga.</p>
              <Link
                href="/pos"
                className="mt-4 inline-flex h-10 items-center gap-2 bg-denim px-4 text-sm font-semibold text-white hover:bg-denim-hover"
              >
                Abrir o PDV
              </Link>
            </div>
          ) : (
            <div>
              {groups.map((group) => (
                <div key={group.label}>
                  <h3 className="bg-sub px-4 py-1.5 font-tag text-xs font-bold uppercase tracking-[0.1em] text-ink-2 md:px-5">
                    {group.label}
                  </h3>
                  <ul>
                    {group.orders.map((order) => (
                      <li
                        key={order.id}
                        className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 border-b border-rule px-4 py-3 last:border-b-0 md:px-5"
                      >
                        <span className="text-sm font-semibold tabular-nums text-ink-2">
                          {new Date(order.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold text-ink">
                            Pedido #{order.id.slice(-6).toUpperCase()}
                          </span>
                          <span className="text-sm text-ink-3">
                            {order.itemCount} {order.itemCount === 1 ? "item" : "itens"}
                          </span>
                        </span>
                        <PriceTag value={order.totalAmount} className="text-xl" />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-4 md:space-y-6">
          <section className="border border-rule bg-paper" aria-labelledby="totals-title">
            <h2 id="totals-title" className="border-b border-rule px-4 py-3 font-tag text-lg font-bold uppercase tracking-[0.04em] md:px-5">
              Totais
            </h2>
            <dl className="divide-y divide-rule px-4 md:px-5">
              {stats.totalRevenue !== null ? (
                <div className="flex items-baseline justify-between gap-3 py-3">
                  <dt className="text-sm text-ink-2">Receita · 30 dias</dt>
                  <dd>{loading ? <span className="block h-5 w-24 animate-pulse bg-sub" /> : <PriceTag value={stats.totalRevenue} className="text-2xl" />}</dd>
                </div>
              ) : null}
              {stats.totalProfit !== null ? (
                <div className="flex items-baseline justify-between gap-3 py-3">
                  <dt className="text-sm text-ink-2">Lucro · 30 dias</dt>
                  <dd className="text-verde">{loading ? <span className="block h-5 w-24 animate-pulse bg-sub" /> : <PriceTag value={stats.totalProfit} className="text-2xl" />}</dd>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between gap-3 py-3">
                <dt className="text-sm text-ink-2">Vendas registradas</dt>
                <dd className="font-tag text-2xl font-extrabold tabular-nums">{loading ? "…" : stats.totalOrders}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-3">
                <dt className="text-sm text-ink-2">Produtos cadastrados</dt>
                <dd className="font-tag text-2xl font-extrabold tabular-nums">{loading ? "…" : stats.totalProducts}</dd>
              </div>
            </dl>
          </section>

          <nav className="border border-rule bg-paper" aria-label="Atalhos">
            <h2 className="border-b border-rule px-4 py-3 font-tag text-lg font-bold uppercase tracking-[0.04em] md:px-5">
              Atalhos
            </h2>
            <ul>
              {shortcuts.map((s) => (
                <li key={s.href}>
                  <Link
                    href={s.href}
                    className="group flex items-center gap-3 border-b border-rule px-4 py-3 transition-colors last:border-b-0 hover:bg-sub md:px-5"
                  >
                    <s.icon className="h-5 w-5 flex-shrink-0 text-ink-2" strokeWidth={1.75} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">{s.label}</span>
                      <span className="block text-sm text-ink-3">{s.hint}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </div>
  );
}

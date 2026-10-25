"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";
import { toast } from "@/components/ui/use-toast";

// Product categories always come from the database (via /api/categories), never from a
// list in the code.
export function useProductCategories(): string[] {
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiGet("/api/categories")
      .then((data) => {
        if (!cancelled && Array.isArray(data?.categories)) setCategories(data.categories);
      })
      .catch(() => {
        if (!cancelled) toast({ title: "Erro ao carregar categorias", variant: "destructive" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return categories;
}

// Keeps a product's saved category selectable even if it was removed from the list, so a
// select never silently shows "Sem categoria" for it.
export function withCurrentCategory(categories: string[], current: string | undefined): string[] {
  return current && !categories.includes(current) ? [...categories, current] : categories;
}

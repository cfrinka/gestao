const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
// Data-hora com fuso explícito ("Z" ou "-03:00"), como Date.toISOString() produz.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Converte o startDate/endDate da query de /api/orders num limite de busca.
 *
 * - Instante com fuso: usado exatamente como veio. É o que a tela de vendas manda — o
 *   navegador calcula 00:00 e 23:59 no fuso da loja, porque o servidor (em geral em UTC)
 *   não sabe onde a loja fica: em UTC, "hoje" começaria às 21h de ontem no Brasil.
 * - "yyyy-mm-dd" ou outro formato: início/fim do dia no fuso do servidor (comportamento
 *   antigo, mantido para quem chama a API com só a data).
 */
export function parseOrderDateFilter(value: string | null | undefined, boundary: "start" | "end"): Date | undefined {
  if (!value) return undefined;

  if (ISO_INSTANT.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  if (ISO_DAY.test(value)) {
    const isoValue = boundary === "start" ? `${value}T00:00:00.000` : `${value}T23:59:59.999`;
    const parsed = new Date(isoValue);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;

  if (boundary === "start") {
    parsed.setHours(0, 0, 0, 0);
  } else {
    parsed.setHours(23, 59, 59, 999);
  }

  return parsed;
}

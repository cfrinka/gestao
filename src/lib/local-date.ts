/**
 * Datas no fuso de quem está usando o sistema (o navegador da loja).
 *
 * `date.toISOString().split("T")[0]` devolve o dia em UTC: no Brasil, depois das 21h,
 * isso já é o dia seguinte. Use estas funções para tudo que significa "dia da loja".
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Dia local no formato do <input type="date">: "2026-11-15". */
export function toLocalIsoDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseIsoDay(isoDay: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  return match ? [Number(match[1]), Number(match[2]) - 1, Number(match[3])] : null;
}

/** 00:00:00.000 do dia, no fuso local. */
export function localDayStart(isoDay: string): Date | null {
  const parts = parseIsoDay(isoDay);
  return parts ? new Date(parts[0], parts[1], parts[2], 0, 0, 0, 0) : null;
}

/** 23:59:59.999 do dia, no fuso local. */
export function localDayEnd(isoDay: string): Date | null {
  const parts = parseIsoDay(isoDay);
  return parts ? new Date(parts[0], parts[1], parts[2], 23, 59, 59, 999) : null;
}

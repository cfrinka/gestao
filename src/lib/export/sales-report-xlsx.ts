import ExcelJS from "exceljs";
import {
  isFiadoReceipt,
  salePaymentLabel,
  salePieceCount,
  saleStatus,
  summarizeSales,
  type SaleStatus,
  type SummarizableSale,
} from "@/domains/orders/sales-summary";
import { storeDateParts, toStoreISODate } from "@/lib/dates";

/**
 * Relatório de vendas em .xlsx, com cabeçalho da loja (logo, nome, contato),
 * resumo do período e a lista de vendas formatada. Este módulo carrega o ExcelJS
 * (~1 MB), então a tela o importa sob demanda, só quando o usuário clica em exportar.
 */

export interface SalesReportSale extends SummarizableSale {
  clientName?: string;
}

export interface SalesReportStore {
  storeName: string;
  address?: string;
  phone?: string;
  cnpj?: string;
  /** PNG em data URL (ver store-logo-schema). */
  logoDataUrl?: string;
}

export interface SalesReportPeriod {
  /** yyyy-mm-dd, como vem do <input type="date">. */
  startDate?: string;
  endDate?: string;
}

export interface SalesReportInput {
  sales: SalesReportSale[];
  store: SalesReportStore;
  period: SalesReportPeriod;
  generatedAt?: Date;
}

const COLOR = {
  brand: "FF2A5473",
  brandSoft: "FFE8EFF5",
  text: "FF1F2937",
  muted: "FF6B7280",
  faint: "FF9CA3AF",
  zebra: "FFF6F8FA",
  border: "FFD9E1E8",
  white: "FFFFFFFF",
  red: "FFBE1622",
  orange: "FFC2410C",
  green: "FF355444",
} as const;

const CURRENCY_FORMAT = '"R$" #,##0.00';

// headerAlign separado porque a seta do filtro (canto direito do título) cobriria um
// título alinhado à direita.
const COLUMNS = [
  { header: "Data", width: 12, align: "center", headerAlign: "center" },
  { header: "Hora", width: 9, align: "center", headerAlign: "center" },
  { header: "Cliente", width: 28, align: "left", headerAlign: "left" },
  { header: "Pagamento", width: 22, align: "left", headerAlign: "left" },
  { header: "Peças", width: 10, align: "center", headerAlign: "center" },
  { header: "Situação", width: 17, align: "left", headerAlign: "left" },
  { header: "Valor", width: 16, align: "right", headerAlign: "center" },
] as const;

const LAST_COL = COLUMNS.length;
const STATUS_COL = 6;
const AMOUNT_COL = 7;

const STATUS_COLOR: Record<SaleStatus, string> = {
  Paga: COLOR.green,
  "Fiado pendente": COLOR.orange,
  "Fiado quitado": COLOR.green,
  Cancelada: COLOR.red,
};

// Linhas fixas do layout.
const ROW = {
  title: 6,
  period: 7,
  summaryLabel: 9,
  summaryValue: 10,
  tableHeader: 12,
} as const;

const LOGO_BOX = { width: 140, height: 88 };

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-05" -> "05/11/2026" sem passar por Date (evita deslocar o dia pelo fuso). */
function formatIsoDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export function formatPeriodLabel({ startDate, endDate }: SalesReportPeriod): string {
  if (startDate && endDate) {
    return startDate === endDate
      ? formatIsoDay(startDate)
      : `${formatIsoDay(startDate)} a ${formatIsoDay(endDate)}`;
  }
  if (startDate) return `A partir de ${formatIsoDay(startDate)}`;
  if (endDate) return `Até ${formatIsoDay(endDate)}`;
  return "Todo o período";
}

export function salesReportFilename(period: SalesReportPeriod, now: Date = new Date()): string {
  const today = toStoreISODate(now);
  const { startDate, endDate } = period;
  if (startDate && endDate) {
    return startDate === endDate ? `vendas_${startDate}.xlsx` : `vendas_${startDate}_a_${endDate}.xlsx`;
  }
  if (startDate) return `vendas_desde_${startDate}.xlsx`;
  if (endDate) return `vendas_ate_${endDate}.xlsx`;
  return `vendas_todo-periodo_${today}.xlsx`;
}

/**
 * O Excel não tem fuso: guarda "data/hora de parede". O ExcelJS converte um Date usando
 * UTC, então uma venda às 14:30 no Brasil apareceria como 17:30. Reescrevemos os campos
 * no horário da loja (lib/dates) como se fossem UTC, seja qual for o fuso do navegador.
 */
function toExcelWallClock(date: Date): Date {
  const p = storeDateParts(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}

/** Largura/altura lidas do cabeçalho IHDR de um PNG em data URL. */
export function readPngSize(dataUrl: string): { width: number; height: number } | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  let bytes: string;
  try {
    bytes = atob(dataUrl.slice(comma + 1, comma + 1 + 32)); // 32 chars base64 = 24 bytes
  } catch {
    return null;
  }
  if (bytes.length < 24 || bytes.slice(1, 4) !== "PNG" || bytes.slice(12, 16) !== "IHDR") return null;
  const u32 = (o: number) =>
    ((bytes.charCodeAt(o) << 24) | (bytes.charCodeAt(o + 1) << 16) | (bytes.charCodeAt(o + 2) << 8) | bytes.charCodeAt(o + 3)) >>> 0;
  const width = u32(16);
  const height = u32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function fitInto(size: { width: number; height: number }, box: { width: number; height: number }) {
  const scale = Math.min(1, box.width / size.width, box.height / size.height);
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

/** No rodapé de impressão do Excel "&" é código de controle; "&&" imprime um "&". */
const escapeHeaderFooter = (text: string) => text.replace(/&/g, "&&");

export function buildSalesReportWorkbook(input: SalesReportInput): ExcelJS.Workbook {
  const { store, period } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const storeName = store.storeName?.trim() || "Minha Loja";
  const entries = [...input.sales].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const summary = summarizeSales(entries);
  // A lista da tela mistura vendas e recebimentos de fiado. Na planilha, a tabela principal
  // (e a fórmula de "Total vendido") fica só com vendas; os recebimentos vão numa seção própria.
  const sales = entries.filter((entry) => !isFiadoReceipt(entry));
  const fiadoReceipts = entries.filter((entry) => isFiadoReceipt(entry) && !entry.isCancelled);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = storeName;
  workbook.created = generatedAt;
  workbook.title = `Relatório de Vendas — ${storeName}`;

  const sheet = workbook.addWorksheet("Vendas", {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
      printTitlesRow: `${ROW.tableHeader}:${ROW.tableHeader}`,
    },
    headerFooter: {
      oddFooter: `&L&8${escapeHeaderFooter(storeName)} — Relatório de Vendas&R&8Página &P de &N`,
    },
  });

  COLUMNS.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });

  const merge = (row: number, fromCol: number, toCol: number) => {
    if (toCol > fromCol) sheet.mergeCells(row, fromCol, row, toCol);
    return sheet.getCell(row, fromCol);
  };

  // ── Cabeçalho da loja ──────────────────────────────────────────────────────
  const logoSize = store.logoDataUrl ? readPngSize(store.logoDataUrl) : null;
  const textCol = logoSize ? 3 : 1;

  const contactLines = [
    store.address?.trim(),
    [store.phone?.trim() && `Tel: ${store.phone.trim()}`, store.cnpj?.trim() && `CNPJ: ${store.cnpj.trim()}`]
      .filter(Boolean)
      .join("   •   "),
  ].filter((line): line is string => Boolean(line));

  // Linhas 2–3 só ocupam espaço se tiverem contato ou se a logo precisar da altura.
  sheet.getRow(1).height = 30;
  [2, 3].forEach((row, i) => (sheet.getRow(row).height = logoSize || i < contactLines.length ? 17 : 4));
  sheet.getRow(4).height = 10;

  if (logoSize && store.logoDataUrl) {
    const imageId = workbook.addImage({ base64: store.logoDataUrl, extension: "png" });
    const fitted = fitInto(logoSize, LOGO_BOX);
    sheet.addImage(imageId, {
      tl: { col: 0.08, row: 0.15 },
      ext: fitted,
      editAs: "oneCell",
    });
  }

  const nameCell = merge(1, textCol, LAST_COL);
  nameCell.value = storeName;
  nameCell.font = { name: "Calibri", size: 18, bold: true, color: { argb: COLOR.brand } };
  nameCell.alignment = { vertical: "bottom" };

  contactLines.forEach((line, i) => {
    const cell = merge(2 + i, textCol, LAST_COL);
    cell.value = line;
    cell.font = { name: "Calibri", size: 10, color: { argb: COLOR.muted } };
    cell.alignment = { vertical: "middle" };
  });

  for (let col = 1; col <= LAST_COL; col++) {
    sheet.getCell(4, col).border = { bottom: { style: "medium", color: { argb: COLOR.brand } } };
  }
  sheet.getRow(5).height = 10;

  // ── Título e período ───────────────────────────────────────────────────────
  sheet.getRow(ROW.title).height = 24;
  const titleCell = merge(ROW.title, 1, LAST_COL);
  titleCell.value = "Relatório de Vendas";
  titleCell.font = { name: "Calibri", size: 15, bold: true, color: { argb: COLOR.text } };
  titleCell.alignment = { vertical: "middle" };

  const periodCell = merge(ROW.period, 1, 4);
  periodCell.value = `Período: ${formatPeriodLabel(period)}`;
  periodCell.font = { name: "Calibri", size: 10, color: { argb: COLOR.muted } };

  const generatedCell = merge(ROW.period, 5, LAST_COL);
  const generated = storeDateParts(generatedAt);
  generatedCell.value =
    `Gerado em ${pad(generated.day)}/${pad(generated.month)}/${generated.year} ` +
    `às ${pad(generated.hour)}:${pad(generated.minute)}`;
  generatedCell.font = { name: "Calibri", size: 10, color: { argb: COLOR.muted } };
  generatedCell.alignment = { horizontal: "right" };

  sheet.getRow(8).height = 10;

  // ── Resumo ─────────────────────────────────────────────────────────────────
  const cards: { from: number; to: number; label: string; value: number; format: string; highlight?: boolean }[] = [
    { from: 1, to: 2, label: "VENDAS", value: summary.saleCount, format: "0" },
    { from: 3, to: 3, label: "TOTAL VENDIDO", value: summary.totalSold, format: CURRENCY_FORMAT, highlight: true },
    { from: 4, to: 4, label: "RECEBIDO", value: summary.totalReceived, format: CURRENCY_FORMAT },
    { from: 5, to: 6, label: "FIADO PENDENTE", value: summary.fiadoOutstanding, format: CURRENCY_FORMAT },
    { from: 7, to: 7, label: "TICKET MÉDIO", value: summary.averageTicket, format: CURRENCY_FORMAT },
  ];

  sheet.getRow(ROW.summaryLabel).height = 18;
  sheet.getRow(ROW.summaryValue).height = 26;

  for (const card of cards) {
    const fill: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: card.highlight ? COLOR.brand : COLOR.brandSoft },
    };
    const gap: ExcelJS.Border = { style: "thick", color: { argb: COLOR.white } };

    for (const row of [ROW.summaryLabel, ROW.summaryValue]) {
      for (let col = card.from; col <= card.to; col++) {
        const cell = sheet.getCell(row, col);
        cell.fill = fill;
        cell.border = {
          ...(col === card.from ? { left: gap } : {}),
          ...(col === card.to ? { right: gap } : {}),
        };
      }
    }

    const label = merge(ROW.summaryLabel, card.from, card.to);
    label.value = card.label;
    label.font = { name: "Calibri", size: 8, bold: true, color: { argb: card.highlight ? COLOR.white : COLOR.muted } };
    label.alignment = { horizontal: "center", vertical: "bottom" };

    const value = merge(ROW.summaryValue, card.from, card.to);
    value.value = card.value;
    value.numFmt = card.format;
    value.font = { name: "Calibri", size: 13, bold: true, color: { argb: card.highlight ? COLOR.white : COLOR.brand } };
    value.alignment = { horizontal: "center", vertical: "middle" };
  }

  sheet.getRow(11).height = 12;

  // ── Tabela de vendas ───────────────────────────────────────────────────────
  const headerRow = sheet.getRow(ROW.tableHeader);
  headerRow.height = 22;
  COLUMNS.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { name: "Calibri", size: 10.5, bold: true, color: { argb: COLOR.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.brand } };
    cell.alignment = { horizontal: column.headerAlign, vertical: "middle", indent: column.headerAlign === "left" ? 1 : 0 };
  });

  const firstDataRow = ROW.tableHeader + 1;
  sales.forEach((sale, index) => {
    const rowNumber = firstDataRow + index;
    const row = sheet.getRow(rowNumber);
    const status = saleStatus(sale);
    const cancelled = status === "Cancelada";
    const when = toExcelWallClock(new Date(sale.createdAt));

    row.values = [
      when,
      when,
      sale.clientName?.trim() || "—",
      salePaymentLabel(sale),
      salePieceCount(sale),
      status,
      typeof sale.totalAmount === "number" ? sale.totalAmount : 0,
    ];
    row.height = 18;

    const zebra: ExcelJS.Fill | undefined =
      index % 2 === 1 ? { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.zebra } } : undefined;

    COLUMNS.forEach((column, colIndex) => {
      const col = colIndex + 1;
      const cell = row.getCell(col);
      const isEmptyClient = col === 3 && !sale.clientName?.trim();
      cell.font = {
        name: "Calibri",
        size: 10,
        color: { argb: cancelled || isEmptyClient ? COLOR.faint : COLOR.text },
        strike: cancelled && col === AMOUNT_COL,
      };
      cell.alignment = { horizontal: column.align, vertical: "middle", indent: column.align === "left" ? 1 : 0 };
      cell.border = { bottom: { style: "thin", color: { argb: COLOR.border } } };
      if (zebra) cell.fill = zebra;
    });

    row.getCell(1).numFmt = "dd/mm/yyyy";
    row.getCell(2).numFmt = "hh:mm";
    row.getCell(AMOUNT_COL).numFmt = CURRENCY_FORMAT;
    row.getCell(STATUS_COL).font = {
      name: "Calibri",
      size: 10,
      bold: status !== "Paga",
      color: { argb: STATUS_COLOR[status] },
    };
  });

  const lastDataRow = firstDataRow + sales.length - 1;

  // ── Total ──────────────────────────────────────────────────────────────────
  const totalRowNumber = lastDataRow + 1;
  const totalRow = sheet.getRow(totalRowNumber);
  totalRow.height = 24;
  for (let col = 1; col <= LAST_COL; col++) {
    const cell = totalRow.getCell(col);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.brandSoft } };
    cell.border = { top: { style: "medium", color: { argb: COLOR.brand } } };
  }

  const totalLabel = merge(totalRowNumber, 1, LAST_COL - 1);
  totalLabel.value = "Total vendido";
  totalLabel.font = { name: "Calibri", size: 11, bold: true, color: { argb: COLOR.brand } };
  totalLabel.alignment = { horizontal: "right", vertical: "middle" };

  const totalCell = totalRow.getCell(AMOUNT_COL);
  const statusColLetter = sheet.getColumn(STATUS_COL).letter;
  const amountColLetter = sheet.getColumn(AMOUNT_COL).letter;
  totalCell.value =
    sales.length > 0
      ? {
          // Fórmula viva: se alguém editar um valor na planilha, o total acompanha.
          formula: `SUMIF(${statusColLetter}${firstDataRow}:${statusColLetter}${lastDataRow},"<>Cancelada",${amountColLetter}${firstDataRow}:${amountColLetter}${lastDataRow})`,
          result: summary.totalSold,
        }
      : 0;
  totalCell.numFmt = CURRENCY_FORMAT;
  totalCell.font = { name: "Calibri", size: 12, bold: true, color: { argb: COLOR.brand } };
  totalCell.alignment = { horizontal: "right", vertical: "middle" };

  let nextFreeRow = totalRowNumber + 1;
  if (summary.cancelledCount > 0) {
    const note = merge(totalRowNumber + 1, 1, LAST_COL);
    note.value =
      summary.cancelledCount === 1
        ? "1 venda cancelada aparece riscada e não entra nos totais."
        : `${summary.cancelledCount} vendas canceladas aparecem riscadas e não entram nos totais.`;
    note.font = { name: "Calibri", size: 9, italic: true, color: { argb: COLOR.muted } };
    note.alignment = { horizontal: "right" };
    nextFreeRow += 1;
  }

  // ── Recebimentos de fiado ──────────────────────────────────────────────────
  // Dinheiro de vendas fiado antigas que entrou no período: compõe o card "Recebido",
  // mas não é venda do período, então não entra em "Total vendido".
  if (fiadoReceipts.length > 0) {
    const titleRow = nextFreeRow + 1;
    sheet.getRow(titleRow).height = 22;
    const sectionTitle = merge(titleRow, 1, LAST_COL);
    sectionTitle.value = "Recebimentos de fiado no período";
    sectionTitle.font = { name: "Calibri", size: 12, bold: true, color: { argb: COLOR.text } };
    sectionTitle.alignment = { vertical: "bottom" };

    const receiptHeaderRow = sheet.getRow(titleRow + 1);
    receiptHeaderRow.height = 20;
    const receiptHeaders = ["Data", "Hora", "Cliente", "Pagamento", "", "", "Valor"];
    receiptHeaders.forEach((header, index) => {
      const column = COLUMNS[index];
      const cell = receiptHeaderRow.getCell(index + 1);
      cell.value = header;
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: COLOR.brand } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.brandSoft } };
      cell.alignment = { horizontal: column.headerAlign, vertical: "middle", indent: column.headerAlign === "left" ? 1 : 0 };
    });

    const firstReceiptRow = titleRow + 2;
    fiadoReceipts.forEach((receipt, index) => {
      const row = sheet.getRow(firstReceiptRow + index);
      const when = toExcelWallClock(new Date(receipt.createdAt));
      row.values = [
        when,
        when,
        receipt.clientName?.trim() || "—",
        salePaymentLabel(receipt),
        null,
        null,
        typeof receipt.totalAmount === "number" ? receipt.totalAmount : 0,
      ];
      row.height = 18;
      COLUMNS.forEach((column, colIndex) => {
        const cell = row.getCell(colIndex + 1);
        cell.font = { name: "Calibri", size: 10, color: { argb: COLOR.text } };
        cell.alignment = { horizontal: column.align, vertical: "middle", indent: column.align === "left" ? 1 : 0 };
        cell.border = { bottom: { style: "thin", color: { argb: COLOR.border } } };
      });
      row.getCell(1).numFmt = "dd/mm/yyyy";
      row.getCell(2).numFmt = "hh:mm";
      row.getCell(AMOUNT_COL).numFmt = CURRENCY_FORMAT;
    });

    const lastReceiptRow = firstReceiptRow + fiadoReceipts.length - 1;
    const receiptTotalRowNumber = lastReceiptRow + 1;
    sheet.getRow(receiptTotalRowNumber).height = 22;
    for (let col = 1; col <= LAST_COL; col++) {
      sheet.getCell(receiptTotalRowNumber, col).border = { top: { style: "thin", color: { argb: COLOR.brand } } };
    }
    const receiptTotalLabel = merge(receiptTotalRowNumber, 1, LAST_COL - 1);
    receiptTotalLabel.value = "Total recebido de fiado";
    receiptTotalLabel.font = { name: "Calibri", size: 10.5, bold: true, color: { argb: COLOR.brand } };
    receiptTotalLabel.alignment = { horizontal: "right", vertical: "middle" };

    const receiptTotalCell = sheet.getCell(receiptTotalRowNumber, AMOUNT_COL);
    const amountLetter = sheet.getColumn(AMOUNT_COL).letter;
    receiptTotalCell.value = {
      formula: `SUM(${amountLetter}${firstReceiptRow}:${amountLetter}${lastReceiptRow})`,
      result: summary.fiadoReceived,
    };
    receiptTotalCell.numFmt = CURRENCY_FORMAT;
    receiptTotalCell.font = { name: "Calibri", size: 11, bold: true, color: { argb: COLOR.brand } };
    receiptTotalCell.alignment = { horizontal: "right", vertical: "middle" };
  }

  if (sales.length > 0) {
    sheet.autoFilter = {
      from: { row: ROW.tableHeader, column: 1 },
      to: { row: lastDataRow, column: LAST_COL },
    };
  }

  return workbook;
}

export async function downloadSalesReportXlsx(input: SalesReportInput): Promise<void> {
  const workbook = buildSalesReportWorkbook(input);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = salesReportFilename(input.period, input.generatedAt);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

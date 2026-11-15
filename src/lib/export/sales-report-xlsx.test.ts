import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  buildSalesReportWorkbook,
  formatPeriodLabel,
  readPngSize,
  salesReportFilename,
  type SalesReportInput,
  type SalesReportSale,
} from "./sales-report-xlsx";

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Só o cabeçalho de um PNG (assinatura + IHDR) — suficiente para readPngSize. */
function pngHeaderDataUrl(width: number, height: number): string {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

// Datas locais (sem "Z"): o relatório tem que mostrar o horário da loja.
const sales: SalesReportSale[] = [
  {
    createdAt: new Date(2026, 10, 12, 18, 5).toISOString(),
    totalAmount: 150,
    items: [{ quantity: 1 }],
    isPaidLater: true,
    amountPaid: 50,
    remainingAmount: 100,
    clientName: "Maria Souza",
  },
  {
    createdAt: new Date(2026, 10, 10, 9, 30).toISOString(),
    totalAmount: 249.9,
    items: [{ quantity: 2 }, { quantity: 1 }],
    payments: [
      { method: "PIX", amount: 200 },
      { method: "DINHEIRO", amount: 49.9 },
    ],
  },
  {
    createdAt: new Date(2026, 10, 11, 14, 0).toISOString(),
    totalAmount: 80,
    items: [{ quantity: 1 }],
    payments: [{ method: "DEBITO", amount: 80 }],
    isCancelled: true,
  },
];

const baseInput: SalesReportInput = {
  sales,
  store: { storeName: "Boutique & Cia", address: "Rua A, 10", phone: "(11) 9999-0000", cnpj: "00.000.000/0001-00" },
  period: { startDate: "2026-11-01", endDate: "2026-11-15" },
  generatedAt: new Date(2026, 10, 15, 16, 42),
};

async function roundTrip(input: SalesReportInput) {
  const buffer = await buildSalesReportWorkbook(input).xlsx.writeBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ArrayBuffer);
  const sheet = workbook.getWorksheet("Vendas");
  if (!sheet) throw new Error("sheet 'Vendas' missing");
  return sheet;
}

const HEADER_ROW = 12;

describe("buildSalesReportWorkbook", () => {
  it("has date and value columns and no sale ID column", async () => {
    const sheet = await roundTrip(baseInput);
    const headers = (sheet.getRow(HEADER_ROW).values as unknown[]).slice(1);
    expect(headers).toEqual(["Data", "Hora", "Cliente", "Pagamento", "Peças", "Situação", "Valor"]);
    expect(headers).not.toContain("ID");
  });

  it("lists sales oldest first with real dates in the store's local time and numeric values", async () => {
    const sheet = await roundTrip(baseInput);
    const rows = [13, 14, 15].map((n) => sheet.getRow(n));

    const first = rows[0];
    const date = first.getCell(1).value as Date;
    expect(date).toBeInstanceOf(Date);
    // Excel guarda hora "de parede": os campos UTC lidos de volta são os locais da venda.
    expect([date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()]).toEqual([
      2026, 10, 10, 9, 30,
    ]);
    expect(first.getCell(1).numFmt).toBe("dd/mm/yyyy");
    expect(first.getCell(2).numFmt).toBe("hh:mm");
    expect(first.getCell(3).value).toBe("—");
    expect(first.getCell(4).value).toBe("PIX + Dinheiro");
    expect(first.getCell(5).value).toBe(3);
    expect(first.getCell(6).value).toBe("Paga");
    expect(first.getCell(7).value).toBe(249.9);
    expect(first.getCell(7).numFmt).toBe('"R$" #,##0.00');

    expect(rows[1].getCell(6).value).toBe("Cancelada");
    expect(rows[1].getCell(7).font?.strike).toBe(true);

    expect(rows[2].getCell(3).value).toBe("Maria Souza");
    expect(rows[2].getCell(4).value).toBe("Fiado");
    expect(rows[2].getCell(6).value).toBe("Fiado pendente");
  });

  it("totals with a live formula that excludes cancelled sales", async () => {
    const sheet = await roundTrip(baseInput);
    const total = sheet.getRow(16).getCell(7).value as ExcelJS.CellFormulaValue;
    expect(total.formula).toBe('SUMIF(F13:F15,"<>Cancelada",G13:G15)');
    expect(total.result).toBeCloseTo(399.9);
    expect(sheet.getRow(17).getCell(1).value).toMatch(/1 venda cancelada/);
  });

  it("summarises the period in the header cards", async () => {
    const sheet = await roundTrip(baseInput);
    expect(sheet.getCell("A10").value).toBe(2); // vendas (sem a cancelada)
    expect(sheet.getCell("C10").value).toBeCloseTo(399.9); // total vendido
    expect(sheet.getCell("D10").value).toBeCloseTo(299.9); // recebido
    expect(sheet.getCell("E10").value).toBe(100); // fiado pendente
    expect(sheet.getCell("G10").value).toBeCloseTo(199.95); // ticket médio
  });

  it("puts the store identity and period at the top", async () => {
    const sheet = await roundTrip(baseInput);
    expect(sheet.getCell("A1").value).toBe("Boutique & Cia");
    expect(sheet.getCell("A2").value).toBe("Rua A, 10");
    expect(sheet.getCell("A3").value).toBe("Tel: (11) 9999-0000   •   CNPJ: 00.000.000/0001-00");
    expect(sheet.getCell("A6").value).toBe("Relatório de Vendas");
    expect(sheet.getCell("A7").value).toBe("Período: 01/11/2026 a 15/11/2026");
    expect(sheet.getCell("E7").value).toBe("Gerado em 15/11/2026 às 16:42");
    expect(sheet.headerFooter.oddFooter).toContain("Boutique && Cia");
    expect(sheet.getImages()).toHaveLength(0);
  });

  it("embeds the logo and shifts the store text to its right", async () => {
    const sheet = await roundTrip({ ...baseInput, store: { ...baseInput.store, logoDataUrl: ONE_PIXEL_PNG } });
    expect(sheet.getImages()).toHaveLength(1);
    expect(sheet.getCell("A1").value).toBeNull();
    expect(sheet.getCell("C1").value).toBe("Boutique & Cia");
  });

  it("ignores a logo it cannot read instead of failing the export", async () => {
    const sheet = await roundTrip({ ...baseInput, store: { ...baseInput.store, logoDataUrl: "data:image/png;base64,AAAA" } });
    expect(sheet.getImages()).toHaveLength(0);
    expect(sheet.getCell("A1").value).toBe("Boutique & Cia");
  });

  it("omits the cancelled note when nothing was cancelled", async () => {
    const sheet = await roundTrip({ ...baseInput, sales: sales.filter((s) => !s.isCancelled) });
    expect(sheet.getRow(15).getCell(1).value).toBe("Total vendido");
    expect(sheet.getRow(16).getCell(1).value).toBeNull();
  });
});

describe("readPngSize", () => {
  it("reads width and height from the PNG header", () => {
    expect(readPngSize(pngHeaderDataUrl(600, 240))).toEqual({ width: 600, height: 240 });
    expect(readPngSize(ONE_PIXEL_PNG)).toEqual({ width: 1, height: 1 });
  });

  it("returns null for anything that is not a PNG", () => {
    expect(readPngSize("not a data url")).toBeNull();
    expect(readPngSize("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYE")).toBeNull();
    expect(readPngSize("data:image/png;base64,!!!")).toBeNull();
  });
});

describe("formatPeriodLabel / salesReportFilename", () => {
  it("describes each kind of period", () => {
    expect(formatPeriodLabel({ startDate: "2026-11-01", endDate: "2026-11-15" })).toBe("01/11/2026 a 15/11/2026");
    expect(formatPeriodLabel({ startDate: "2026-11-15", endDate: "2026-11-15" })).toBe("15/11/2026");
    expect(formatPeriodLabel({ startDate: "2026-11-01" })).toBe("A partir de 01/11/2026");
    expect(formatPeriodLabel({ endDate: "2026-11-15" })).toBe("Até 15/11/2026");
    expect(formatPeriodLabel({})).toBe("Todo o período");
  });

  it("names the file after the period", () => {
    const now = new Date(2026, 10, 15, 23, 30);
    expect(salesReportFilename({ startDate: "2026-11-01", endDate: "2026-11-15" }, now)).toBe("vendas_2026-11-01_a_2026-11-15.xlsx");
    expect(salesReportFilename({ startDate: "2026-11-15", endDate: "2026-11-15" }, now)).toBe("vendas_2026-11-15.xlsx");
    expect(salesReportFilename({ startDate: "2026-11-01" }, now)).toBe("vendas_desde_2026-11-01.xlsx");
    expect(salesReportFilename({ endDate: "2026-11-15" }, now)).toBe("vendas_ate_2026-11-15.xlsx");
    // Data local, não UTC: às 23:30 no Brasil ainda é dia 15.
    expect(salesReportFilename({}, now)).toBe("vendas_todo-periodo_2026-11-15.xlsx");
  });
});

/**
 * The PDF library is ~300 KB and only needed when someone exports a report, so screens load it
 * on that click instead of shipping it with the page.
 */
export async function loadPdf() {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  return { jsPDF, autoTable };
}

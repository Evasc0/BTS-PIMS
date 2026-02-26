import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import type { Employee, Product, ReturnRecord } from './types';

type ReportColumn = {
  key: string;
  header: string;
  align: 'left' | 'right' | 'center';
  pdfWidth: number;
  excelWidth: number;
  format?: 'currency' | 'number';
};

type ReportRow = Record<string, string | number | null | undefined>;
export type InventoryReportFilter = 'HV' | 'LV' | 'PPEIR';
export type ReturnSubmitterFilter = 'employee' | 'system_admin';
export type ReturnPurposeFilter = 'for_disposal' | 'need_repair' | 'functional' | 'others';

export const RETURN_SUBMITTER_OPTIONS: Array<{ value: ReturnSubmitterFilter; label: string }> = [
  { value: 'employee', label: 'Employee' },
  { value: 'system_admin', label: 'Admin' }
];

export const RETURN_PURPOSE_OPTIONS: Array<{ value: ReturnPurposeFilter; label: string }> = [
  { value: 'for_disposal', label: 'For Disposal' },
  { value: 'need_repair', label: 'Need Repair' },
  { value: 'functional', label: 'Functional' },
  { value: 'others', label: 'Others' }
];

export const getReturnPurposeFromCondition = (condition: ReturnRecord['condition']): ReturnPurposeFilter => {
  if (condition === 'for disposal' || condition === 'destroyed') return 'for_disposal';
  if (condition === 'need repair' || condition === 'damaged') return 'need_repair';
  if (condition === 'functional') return 'functional';
  return 'others';
};

const getComparableTimestamp = (value: string | undefined): number => {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const toSafeFileToken = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');

const getReturnPurposeCheckboxText = (selectedPurpose: ReturnPurposeFilter): string => {
  return RETURN_PURPOSE_OPTIONS.map((option) => `[${option.value === selectedPurpose ? 'X' : ' '}] ${option.label}`).join('   ');
};

const PDF_MARGINS = { top: 56, left: 14, right: 14, bottom: 24 };
const PDF_TITLE_Y = 32;
const PDF_FONT_SIZE = 9;
const PDF_HEADER_FONT_SIZE = 9;
const PDF_PAGE_NUMBER_FONT_SIZE = 8;
const LONG_BOND_WIDTH_PT = 13 * 72;
const LONG_BOND_HEIGHT_PT = 8.5 * 72;
// Excel supports Folio (8.5x13) as code 14, but this exceljs version does not include it in PaperSize enum.
const EXCEL_LONG_BOND_PAPER_SIZE = 14 as unknown as ExcelJS.PaperSize;
const EXCEL_HEADER_FILL = 'FFE6E6E6';
const EXCEL_DEFAULT_ROW_HEIGHT = 20;
const EXCEL_HEADER_ROW_HEIGHT = 24;
const EXCEL_HEADING_ROW_HEIGHT = 20;
const EXCEL_TARGET_TOTAL_COLUMN_WIDTH = 165;
const EXCEL_PAGE_MARGINS = {
  left: 0.15,
  right: 0.15,
  top: 0.45,
  bottom: 0.45,
  header: 0.2,
  footer: 0.2
};
const EXCEL_GRID_BORDER = {
  top: { style: 'thin', color: { argb: 'FFBDBDBD' } },
  left: { style: 'thin', color: { argb: 'FFBDBDBD' } },
  bottom: { style: 'thin', color: { argb: 'FFBDBDBD' } },
  right: { style: 'thin', color: { argb: 'FFBDBDBD' } }
} as const;
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const EXPORT_CURRENCY_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const EXPORT_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric'
});

const formatExportDate = (value: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return EXPORT_DATE_FORMAT.format(date);
};

const getInventoryColumns = (inventoryFilter: InventoryReportFilter): ReportColumn[] => {
  const controlHeader = inventoryFilter === 'PPEIR' ? 'ICS CONTROL NO.' : 'PAR CONTROL NO.';
  const assetHeader = inventoryFilter === 'PPEIR' ? 'INVENTORY NO.' : 'PROPERTY NO.';

  return [
    { key: 'article', header: 'ARTICLE', align: 'left', pdfWidth: 56, excelWidth: 10 },
    { key: 'description', header: 'DESCRIPTION', align: 'left', pdfWidth: 132, excelWidth: 24 },
    { key: 'dateAcquired', header: 'DATE ACQUIRED', align: 'center', pdfWidth: 62, excelWidth: 12 },
    { key: 'controlNumber', header: controlHeader, align: 'left', pdfWidth: 72, excelWidth: 14 },
    { key: 'assetNumber', header: assetHeader, align: 'left', pdfWidth: 72, excelWidth: 14 },
    { key: 'uom', header: 'UOM', align: 'left', pdfWidth: 36, excelWidth: 7 },
    { key: 'unitCost', header: 'UNIT COST', align: 'right', pdfWidth: 58, excelWidth: 11, format: 'currency' },
    { key: 'qty', header: 'QTY', align: 'right', pdfWidth: 38, excelWidth: 7, format: 'number' },
    { key: 'totalAmount', header: 'TOTAL AMOUNT', align: 'right', pdfWidth: 64, excelWidth: 12, format: 'currency' },
    { key: 'location', header: 'LOCATION', align: 'left', pdfWidth: 58, excelWidth: 10 },
    { key: 'actualUser', header: 'ACTUAL USER', align: 'left', pdfWidth: 76, excelWidth: 14 },
    { key: 'remarks', header: 'REMARKS', align: 'left', pdfWidth: 72, excelWidth: 14 }
  ];
};

const returnsColumns: ReportColumn[] = [
  { key: 'no', header: 'NO.', align: 'center', pdfWidth: 36, excelWidth: 6, format: 'number' },
  { key: 'qty', header: 'QTY.', align: 'right', pdfWidth: 44, excelWidth: 7, format: 'number' },
  { key: 'unit', header: 'UNIT', align: 'left', pdfWidth: 48, excelWidth: 8 },
  { key: 'description', header: 'DESCRIPTION', align: 'left', pdfWidth: 200, excelWidth: 24 },
  { key: 'propertyOrIcs', header: 'PROPERTY No./ICS CONTROL No.', align: 'left', pdfWidth: 130, excelWidth: 18 },
  { key: 'dateAcquired', header: 'Date Acquired', align: 'center', pdfWidth: 82, excelWidth: 12 },
  { key: 'actualUser', header: 'Actual User', align: 'left', pdfWidth: 118, excelWidth: 16 },
  { key: 'unitValue', header: 'UNIT VALUE', align: 'right', pdfWidth: 84, excelWidth: 12, format: 'currency' },
  { key: 'totalValue', header: 'TOTAL VALUE', align: 'right', pdfWidth: 84, excelWidth: 12, format: 'currency' }
];

const formatPdfValue = (value: ReportRow[string], column: ReportColumn): string => {
  if (value === null || value === undefined) return '';
  if (column.format === 'currency' && typeof value === 'number') {
    return EXPORT_CURRENCY_FORMAT.format(value);
  }
  if (column.format === 'number' && typeof value === 'number') {
    return NUMBER_FORMAT.format(value);
  }
  return String(value);
};

const buildPdfColumnStyles = (
  columns: ReportColumn[],
  maxTableWidth: number
): Record<number, { cellWidth: number; halign: 'left' | 'right' | 'center' }> => {
  const totalRequestedWidth = columns.reduce((sum, column) => sum + column.pdfWidth, 0);
  const fitRatio = totalRequestedWidth > 0 ? maxTableWidth / totalRequestedWidth : 1;

  return columns.reduce<Record<number, { cellWidth: number; halign: 'left' | 'right' | 'center' }>>(
    (styles, column, index) => {
      styles[index] = {
        cellWidth: Number((column.pdfWidth * fitRatio).toFixed(2)),
        halign: column.align
      };
      return styles;
    },
    {}
  );
};

const fitExcelColumnsToPage = (
  columns: ReportColumn[],
  targetTotalWidth: number = EXCEL_TARGET_TOTAL_COLUMN_WIDTH
): ReportColumn[] => {
  const baseTotalWidth = columns.reduce((sum, column) => sum + column.excelWidth, 0);
  if (baseTotalWidth <= 0) return columns;

  const ratio = targetTotalWidth / baseTotalWidth;
  return columns.map((column) => ({
    ...column,
    excelWidth: Number((column.excelWidth * ratio).toFixed(2))
  }));
};

const configureExcelPageSetup = (sheet: ExcelJS.Worksheet): void => {
  sheet.pageSetup = {
    orientation: 'landscape',
    paperSize: EXCEL_LONG_BOND_PAPER_SIZE,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: EXCEL_PAGE_MARGINS
  };
  sheet.properties.defaultRowHeight = EXCEL_DEFAULT_ROW_HEIGHT;
};

const getExcelColumnLetter = (columnNumber: number): string => {
  let current = columnNumber;
  let columnLabel = '';

  while (current > 0) {
    const remainder = (current - 1) % 26;
    columnLabel = String.fromCharCode(65 + remainder) + columnLabel;
    current = Math.floor((current - 1) / 26);
  }

  return columnLabel || 'A';
};

const applyExcelBorders = (
  sheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  columnCount: number
): void => {
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      sheet.getCell(rowNumber, columnNumber).border = EXCEL_GRID_BORDER;
    }
  }
};

const applyExcelPrintLayout = (
  sheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  columnCount: number,
  repeatingHeaderRow: number
): void => {
  const lastColumnLabel = getExcelColumnLetter(columnCount);
  sheet.pageSetup.printArea = `A${startRow}:${lastColumnLabel}${endRow}`;
  sheet.pageSetup.printTitlesRow = `${repeatingHeaderRow}:${repeatingHeaderRow}`;
};

const buildPdfDocument = (title: string, columns: ReportColumn[], rows: ReportRow[]): jsPDF => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: [LONG_BOND_HEIGHT_PT, LONG_BOND_WIDTH_PT]
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const availableTableWidth = pageWidth - PDF_MARGINS.left - PDF_MARGINS.right;
  const columnStyles = buildPdfColumnStyles(columns, availableTableWidth);

  autoTable(doc, {
    startY: PDF_MARGINS.top,
    margin: PDF_MARGINS,
    head: [columns.map((column) => column.header)],
    body: rows.map((row) => columns.map((column) => formatPdfValue(row[column.key], column))),
    theme: 'grid',
    tableWidth: availableTableWidth,
    styles: {
      fontSize: PDF_FONT_SIZE,
      cellPadding: 3,
      overflow: 'linebreak',
      valign: 'middle',
      lineColor: [120, 120, 120],
      lineWidth: 0.6
    },
    headStyles: {
      fontStyle: 'bold',
      fontSize: PDF_HEADER_FONT_SIZE,
      fillColor: [235, 235, 235],
      textColor: 20,
      halign: 'center',
      lineColor: [120, 120, 120],
      lineWidth: 0.6
    },
    columnStyles,
    showHead: 'everyPage',
    didDrawPage: (data) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(title, pageWidth / 2, PDF_TITLE_Y, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(PDF_PAGE_NUMBER_FONT_SIZE);
      doc.text(`Page ${data.pageNumber}`, pageWidth - PDF_MARGINS.right, pageHeight - 12, { align: 'right' });
    }
  });

  return doc;
};

const buildReturnsPdfDocument = (
  title: string,
  rows: ReportRow[],
  submitterFilter: ReturnSubmitterFilter,
  purposeFilter: ReturnPurposeFilter
): jsPDF => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: [LONG_BOND_HEIGHT_PT, LONG_BOND_WIDTH_PT]
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const availableTableWidth = pageWidth - PDF_MARGINS.left - PDF_MARGINS.right;
  const columnStyles = buildPdfColumnStyles(returnsColumns, availableTableWidth);

  const rrspNumbers = Array.from(
    new Set(
      rows
        .map((row) => String(row.rrspNumber || '').trim())
        .filter((value) => value.length > 0)
    )
  );
  const rrspLabel = rrspNumbers.length > 0 ? rrspNumbers.join(', ') : 'N/A';

  autoTable(doc, {
    startY: submitterFilter === 'system_admin' ? 104 : 88,
    margin: PDF_MARGINS,
    head: [returnsColumns.map((column) => column.header)],
    body: rows.map((row) => returnsColumns.map((column) => formatPdfValue(row[column.key], column))),
    theme: 'grid',
    tableWidth: availableTableWidth,
    styles: {
      fontSize: 8.5,
      cellPadding: 3,
      overflow: 'linebreak',
      valign: 'middle',
      lineColor: [120, 120, 120],
      lineWidth: 0.6
    },
    headStyles: {
      fontStyle: 'bold',
      fontSize: 8.5,
      fillColor: [235, 235, 235],
      textColor: 20,
      halign: 'center',
      lineColor: [120, 120, 120],
      lineWidth: 0.6
    },
    columnStyles,
    showHead: 'everyPage',
    didDrawPage: (data) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(title, pageWidth / 2, 24, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text('Section/Dept.: PGO-BTS', PDF_MARGINS.left, 42);
      if (submitterFilter === 'system_admin') {
        doc.text(`RRSP No.: ${rrspLabel}`, PDF_MARGINS.left, 58);
      }
      doc.text(
        `PURPOSE: ${getReturnPurposeCheckboxText(purposeFilter)}`,
        PDF_MARGINS.left,
        submitterFilter === 'system_admin' ? 74 : 58
      );

      doc.setFontSize(PDF_PAGE_NUMBER_FONT_SIZE);
      doc.text(`Page ${data.pageNumber}`, pageWidth - PDF_MARGINS.right, pageHeight - 12, { align: 'right' });
    }
  });

  return doc;
};

const formatFileDate = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildExcelBlob = async (title: string, columns: ReportColumn[], rows: ReportRow[]): Promise<Blob> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BTS Inventory Management System';
  workbook.created = new Date();

  const printableColumns = fitExcelColumnsToPage(columns);
  const sheet = workbook.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 1 }] });
  configureExcelPageSetup(sheet);

  sheet.columns = printableColumns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.excelWidth
  }));

  rows.forEach((row) => {
    sheet.addRow(row);
  });

  printableColumns.forEach((column, index) => {
    const excelColumn = sheet.getColumn(index + 1);
    excelColumn.alignment = { vertical: 'top', horizontal: column.align, wrapText: true };
    if (column.format === 'currency') {
      excelColumn.numFmt = '#,##0.00';
    }
    if (column.format === 'number') {
      excelColumn.numFmt = '#,##0';
    }
  });

  const headerRow = sheet.getRow(1);
  headerRow.height = EXCEL_HEADER_ROW_HEIGHT;
  headerRow.font = { bold: true };
  headerRow.eachCell((cell, colNumber) => {
    const column = printableColumns[colNumber - 1];
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });

  const lastRowNumber = Math.max(sheet.lastRow?.number || 1, 1);
  for (let rowNumber = 2; rowNumber <= lastRowNumber; rowNumber += 1) {
    sheet.getRow(rowNumber).height = EXCEL_DEFAULT_ROW_HEIGHT;
  }
  applyExcelBorders(sheet, 1, lastRowNumber, printableColumns.length);
  applyExcelPrintLayout(sheet, 1, lastRowNumber, printableColumns.length, 1);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
};

const buildReturnsExcelBlob = async (
  title: string,
  rows: ReportRow[],
  submitterFilter: ReturnSubmitterFilter,
  purposeFilter: ReturnPurposeFilter
): Promise<Blob> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BTS Inventory Management System';
  workbook.created = new Date();

  const printableColumns = fitExcelColumnsToPage(returnsColumns);
  const ySplit = submitterFilter === 'system_admin' ? 6 : 5;
  const sheet = workbook.addWorksheet(title, { views: [{ state: 'frozen', ySplit }] });
  configureExcelPageSetup(sheet);
  sheet.columns = printableColumns.map((column) => ({
    key: column.key,
    width: column.excelWidth
  }));

  const rrspNumbers = Array.from(
    new Set(
      rows
        .map((row) => String(row.rrspNumber || '').trim())
        .filter((value) => value.length > 0)
    )
  );
  const rrspLabel = rrspNumbers.length > 0 ? rrspNumbers.join(', ') : 'N/A';

  sheet.mergeCells('A1:I1');
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = { bold: true, size: 12 };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = EXCEL_HEADING_ROW_HEIGHT;

  sheet.mergeCells('A2:I2');
  sheet.getCell('A2').value = 'Section/Dept.: PGO-BTS';
  sheet.getCell('A2').font = { bold: true };
  sheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(2).height = EXCEL_HEADING_ROW_HEIGHT;

  let tableHeaderRowNumber = 5;
  if (submitterFilter === 'system_admin') {
    sheet.mergeCells('A3:I3');
    sheet.getCell('A3').value = `RRSP No.: ${rrspLabel}`;
    sheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'left' };
    sheet.getRow(3).height = EXCEL_HEADING_ROW_HEIGHT;
    sheet.mergeCells('A4:I4');
    sheet.getCell('A4').value = `PURPOSE: ${getReturnPurposeCheckboxText(purposeFilter)}`;
    sheet.getCell('A4').alignment = { vertical: 'middle', horizontal: 'left' };
    sheet.getRow(4).height = EXCEL_HEADING_ROW_HEIGHT;
    tableHeaderRowNumber = 6;
  } else {
    sheet.mergeCells('A3:I3');
    sheet.getCell('A3').value = `PURPOSE: ${getReturnPurposeCheckboxText(purposeFilter)}`;
    sheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'left' };
    sheet.getRow(3).height = EXCEL_HEADING_ROW_HEIGHT;
  }

  for (let current = 4; current < tableHeaderRowNumber; current += 1) {
    if (submitterFilter === 'system_admin' && current === 4) continue;
    sheet.mergeCells(`A${current}:I${current}`);
    sheet.getCell(`A${current}`).value = '';
    sheet.getRow(current).height = 10;
  }

  const headerValues = printableColumns.map((column) => column.header);
  const headerRow = sheet.insertRow(tableHeaderRowNumber, headerValues);
  rows.forEach((row) => {
    sheet.addRow(row);
  });

  printableColumns.forEach((column, index) => {
    const excelColumn = sheet.getColumn(index + 1);
    excelColumn.alignment = {
      vertical: 'top',
      horizontal: column.align,
      wrapText: true
    };
    if (column.format === 'currency') {
      excelColumn.numFmt = '#,##0.00';
    }
    if (column.format === 'number') {
      excelColumn.numFmt = '#,##0';
    }
  });

  // Re-apply merged heading alignment after column alignment so headers stay left-aligned.
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left' };
  if (submitterFilter === 'system_admin') {
    sheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'left' };
    sheet.getCell('A4').alignment = { vertical: 'middle', horizontal: 'left' };
  } else {
    sheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'left' };
  }

  headerRow.font = { bold: true };
  headerRow.height = EXCEL_HEADER_ROW_HEIGHT;
  headerRow.eachCell((cell, colNumber) => {
    const column = printableColumns[colNumber - 1];
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });

  const lastRow = sheet.lastRow?.number || tableHeaderRowNumber;
  for (let rowNumber = tableHeaderRowNumber + 1; rowNumber <= lastRow; rowNumber += 1) {
    sheet.getRow(rowNumber).height = EXCEL_DEFAULT_ROW_HEIGHT;
  }
  applyExcelBorders(sheet, tableHeaderRowNumber, lastRow, printableColumns.length);
  applyExcelPrintLayout(sheet, 1, lastRow, printableColumns.length, tableHeaderRowNumber);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
};

export const buildInventoryReportRows = (products: Product[], employees: Employee[]): ReportRow[] => {
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee.fullName]));
  return products.map((product) => ({
    article: product.article,
    description: product.description,
    dateAcquired: formatExportDate(product.date),
    controlNumber: product.parControlNumber,
    assetNumber: product.propertyNumber,
    uom: product.unit,
    unitCost: product.unitValue,
    qty: product.onHandPerCount,
    totalAmount: product.total,
    location: product.location,
    actualUser: product.assignedToEmployeeId ? employeeMap.get(product.assignedToEmployeeId) || 'Unknown' : 'Unassigned',
    remarks: product.remarks
  }));
};

export const buildReturnReportRows = (
  returns: ReturnRecord[],
  products: Product[],
  employees: Employee[],
  submitterFilter: ReturnSubmitterFilter,
  purposeFilter: ReturnPurposeFilter,
  allReturns: ReturnRecord[] = returns
): ReportRow[] => {
  const productMap = new Map(products.map((product) => [product.id, product]));
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  const employeeReturnsByProduct = new Map<string, ReturnRecord[]>();

  allReturns
    .filter((record) => record.returnedByPosition === 'employee')
    .forEach((record) => {
      const list = employeeReturnsByProduct.get(record.productId) || [];
      list.push(record);
      employeeReturnsByProduct.set(record.productId, list);
    });

  employeeReturnsByProduct.forEach((records) => {
    records.sort(
      (a, b) =>
        getComparableTimestamp(b.createdAt || b.returnDate) -
        getComparableTimestamp(a.createdAt || a.returnDate)
    );
  });

  const pickBestSourceRecord = (records: ReturnRecord[]): ReturnRecord | undefined => {
    return (
      records.find((candidate) => candidate.status === 'approved') ||
      records.find((candidate) => candidate.status !== 'rejected') ||
      records[0]
    );
  };

  const resolveActualUserId = (record: ReturnRecord): string => {
    if (record.returnedByPosition !== 'system_admin') return record.returnedByEmployeeId;

    const candidates = employeeReturnsByProduct.get(record.productId) || [];
    if (!candidates.length) return record.returnedByEmployeeId;

    const adminRecordTs = getComparableTimestamp(record.createdAt || record.returnDate);
    const beforeOrSameTs = candidates.filter(
      (candidate) =>
        getComparableTimestamp(candidate.createdAt || candidate.returnDate) <= adminRecordTs
    );
    const matchedBeforeOrSame = pickBestSourceRecord(beforeOrSameTs);
    if (matchedBeforeOrSame?.returnedByEmployeeId) return matchedBeforeOrSame.returnedByEmployeeId;

    const fallback = pickBestSourceRecord(candidates);
    return fallback?.returnedByEmployeeId || record.returnedByEmployeeId;
  };

  return returns
    .filter((record) => record.returnedByPosition === submitterFilter)
    .filter((record) => getReturnPurposeFromCondition(record.condition) === purposeFilter)
    .map((record, index) => {
      const product = productMap.get(record.productId);
      const article = (product?.article || '').trim();
      const descriptionText = (product?.description || '').trim();
      const qty = Number(product?.onHandPerCount || 0);
      const unitValue = Number(product?.unitValue || 0);
      const totalValue = qty * unitValue;
      const propertyOrIcs = (product?.propertyNumber || '').trim() || (product?.parControlNumber || '').trim();

      return {
        no: index + 1,
        qty,
        unit: product?.unit || '',
        description: [article, descriptionText].filter(Boolean).join('\n'),
        propertyOrIcs,
        dateAcquired: product?.date ? formatExportDate(product.date) : '',
        actualUser: employeeMap.get(resolveActualUserId(record))?.fullName || '',
        unitValue,
        totalValue,
        rrspNumber: record.rrspNumber,
        article,
        descriptionText
      };
    });
};

const getInventoryReportTitle = (inventoryFilter: InventoryReportFilter): string => `Inventory Report - ${inventoryFilter}`;

export const exportInventoryToPDF = (
  rows: ReportRow[],
  inventoryFilter: InventoryReportFilter,
  reportDate: Date = new Date()
): void => {
  const title = getInventoryReportTitle(inventoryFilter);
  const fileDate = formatFileDate(reportDate);
  const doc = buildPdfDocument(title, getInventoryColumns(inventoryFilter), rows);
  doc.save(`Inventory_Report_${inventoryFilter}_${fileDate}.pdf`);
};

export const exportReturnsToPDF = (
  rows: ReportRow[],
  submitterFilter: ReturnSubmitterFilter,
  purposeFilter: ReturnPurposeFilter,
  reportDate: Date = new Date(),
  rrspNumber?: string
): void => {
  const title = submitterFilter === 'system_admin' ? 'Returns Report - Admin' : 'Returns Report - Employee';
  const fileDate = formatFileDate(reportDate);
  const doc = buildReturnsPdfDocument(title, rows, submitterFilter, purposeFilter);
  const rrspToken = submitterFilter === 'system_admin' && rrspNumber ? toSafeFileToken(rrspNumber.trim()) : '';
  const fileTag = rrspToken ? `${submitterFilter}_${rrspToken}` : submitterFilter;
  doc.save(`Returns_Report_${fileTag}_${fileDate}.pdf`);
};

export const createInventoryExcelBlob = async (
  rows: ReportRow[],
  inventoryFilter: InventoryReportFilter,
  title = getInventoryReportTitle(inventoryFilter)
): Promise<Blob> => {
  return buildExcelBlob(title, getInventoryColumns(inventoryFilter), rows);
};

export const createReturnsExcelBlob = async (
  rows: ReportRow[],
  submitterFilter: ReturnSubmitterFilter,
  purposeFilter: ReturnPurposeFilter,
  title = submitterFilter === 'system_admin' ? 'Returns Report - Admin' : 'Returns Report - Employee'
): Promise<Blob> => {
  return buildReturnsExcelBlob(title, rows, submitterFilter, purposeFilter);
};

export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

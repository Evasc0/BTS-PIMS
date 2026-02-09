import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import type { Employee, Product, ReturnRecord } from './types';
import { formatCurrency, formatDate } from './utils';

type ReportColumn = {
  key: string;
  header: string;
  align: 'left' | 'right' | 'center';
  pdfWidth: number;
  excelWidth: number;
  format?: 'currency' | 'number';
};

type ReportRow = Record<string, string | number | null | undefined>;

const PDF_MARGINS = { top: 56, left: 24, right: 24, bottom: 24 };
const PDF_TITLE_Y = 32;
const PDF_FONT_SIZE = 9;
const PDF_HEADER_FONT_SIZE = 9;
const PDF_PAGE_NUMBER_FONT_SIZE = 8;
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

const inventoryColumns: ReportColumn[] = [
  { key: 'article', header: 'Article', align: 'left', pdfWidth: 60, excelWidth: 16 },
  { key: 'description', header: 'Description', align: 'left', pdfWidth: 170, excelWidth: 40 },
  { key: 'date', header: 'Date', align: 'center', pdfWidth: 60, excelWidth: 14 },
  { key: 'parControlNumber', header: 'PAR Control Number', align: 'left', pdfWidth: 85, excelWidth: 22 },
  { key: 'propertyNumber', header: 'Property Number', align: 'left', pdfWidth: 85, excelWidth: 22 },
  { key: 'unit', header: 'UOM', align: 'left', pdfWidth: 40, excelWidth: 10 },
  { key: 'unitValue', header: 'Unit Value', align: 'right', pdfWidth: 65, excelWidth: 16, format: 'currency' },
  { key: 'balance', header: 'QTY', align: 'right', pdfWidth: 50, excelWidth: 12, format: 'number' },
  { key: 'total', header: 'Total', align: 'right', pdfWidth: 65, excelWidth: 16, format: 'currency' },
  { key: 'location', header: 'Location', align: 'left', pdfWidth: 65, excelWidth: 18 },
  { key: 'remarks', header: 'Remarks', align: 'left', pdfWidth: 64, excelWidth: 40 }
];

const returnsColumns: ReportColumn[] = [
  { key: 'rrspNumber', header: 'RRSP Number', align: 'left', pdfWidth: 100, excelWidth: 18 },
  { key: 'returnDate', header: 'Return Date', align: 'center', pdfWidth: 80, excelWidth: 14 },
  { key: 'quantity', header: 'Quantity', align: 'right', pdfWidth: 60, excelWidth: 10, format: 'number' },
  { key: 'condition', header: 'Condition', align: 'left', pdfWidth: 100, excelWidth: 16 },
  { key: 'returnedBy', header: 'Returned By', align: 'left', pdfWidth: 120, excelWidth: 22 },
  { key: 'product', header: 'Product', align: 'left', pdfWidth: 120, excelWidth: 22 },
  { key: 'location', header: 'Location', align: 'left', pdfWidth: 110, excelWidth: 18 },
  { key: 'status', header: 'Status', align: 'left', pdfWidth: 104, excelWidth: 12 }
];

const formatPdfValue = (value: ReportRow[string], column: ReportColumn): string => {
  if (value === null || value === undefined) return '';
  if (column.format === 'currency' && typeof value === 'number') {
    return formatCurrency(value);
  }
  if (column.format === 'number' && typeof value === 'number') {
    return NUMBER_FORMAT.format(value);
  }
  return String(value);
};

const buildPdfDocument = (title: string, columns: ReportColumn[], rows: ReportRow[]): jsPDF => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const columnStyles: Record<number, { cellWidth: number; halign: 'left' | 'right' | 'center' }> = {};

  columns.forEach((column, index) => {
    columnStyles[index] = {
      cellWidth: column.pdfWidth,
      halign: column.align
    };
  });

  autoTable(doc, {
    startY: PDF_MARGINS.top,
    margin: PDF_MARGINS,
    head: [columns.map((column) => column.header)],
    body: rows.map((row) => columns.map((column) => formatPdfValue(row[column.key], column))),
    theme: 'grid',
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

  const sheet = workbook.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.pageSetup = { orientation: 'landscape' };

  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.excelWidth
  }));

  rows.forEach((row) => {
    sheet.addRow(row);
  });

  const borderStyle = {
    top: { style: 'thin', color: { argb: 'FFBDBDBD' } },
    left: { style: 'thin', color: { argb: 'FFBDBDBD' } },
    bottom: { style: 'thin', color: { argb: 'FFBDBDBD' } },
    right: { style: 'thin', color: { argb: 'FFBDBDBD' } }
  } as const;

  columns.forEach((column, index) => {
    const excelColumn = sheet.getColumn(index + 1);
    excelColumn.alignment = { vertical: 'top', horizontal: column.align, wrapText: true };
    if (column.format === 'currency') {
      excelColumn.numFmt = '"PHP" #,##0.00';
    }
    if (column.format === 'number') {
      excelColumn.numFmt = '#,##0';
    }
  });

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell, colNumber) => {
    const column = columns[colNumber - 1];
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6E6E6' } };
    cell.alignment = { vertical: 'middle', horizontal: column.align, wrapText: true };
    cell.border = borderStyle;
  });

  sheet.eachRow((row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = borderStyle;
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
};

export const buildInventoryReportRows = (products: Product[]): ReportRow[] => {
  return products.map((product) => {
    return {
      article: product.article,
      description: product.description,
      date: formatDate(product.date),
      parControlNumber: product.parControlNumber,
      propertyNumber: product.propertyNumber,
      unit: product.unit,
      unitValue: product.unitValue,
      balance: product.balancePerCard,
      onHand: product.onHandPerCount,
      total: product.total,
      location: product.location,
      assignedTo: product.assignedToEmployeeId || null,
      remarks: product.remarks
    };
  });
};

export const buildReturnReportRows = (
  returns: ReturnRecord[],
  products: Product[],
  employees: Employee[]
): ReportRow[] => {
  const productMap = new Map(products.map((product) => [product.id, product]));
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  return returns.map((record) => ({
    rrspNumber: record.rrspNumber,
    returnDate: formatDate(record.returnDate),
    quantity: record.quantity,
    condition: record.condition,
    returnedBy: employeeMap.get(record.returnedByEmployeeId)?.fullName || '',
    product: productMap.get(record.productId)?.article || '',
    location: record.location,
    status: record.status
  }));
};

export const exportToPDF = (rows: ReportRow[], reportDate: Date = new Date()): void => {
  const title = 'Inventory Report';
  const fileDate = formatFileDate(reportDate);
  const doc = buildPdfDocument(title, inventoryColumns, rows);
  doc.save(`Inventory_Report_${fileDate}.pdf`);
};

export const exportReturnsToPDF = (rows: ReportRow[], reportDate: Date = new Date()): void => {
  const title = 'Returns Report';
  const fileDate = formatFileDate(reportDate);
  const doc = buildPdfDocument(title, returnsColumns, rows);
  doc.save(`Returns_Report_${fileDate}.pdf`);
};

export const createInventoryExcelBlob = async (
  rows: ReportRow[],
  title = 'Inventory Report'
): Promise<Blob> => {
  return buildExcelBlob(title, inventoryColumns, rows);
};

export const createReturnsExcelBlob = async (
  rows: ReportRow[],
  title = 'Returns Report'
): Promise<Blob> => {
  return buildExcelBlob(title, returnsColumns, rows);
};

export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

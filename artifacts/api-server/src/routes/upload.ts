import { Router, Request, Response } from "express";
import multer from "multer";
import xlsx from "xlsx";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const router = Router();

export interface ParsedPartItem {
  name: string;
  partNumber: string;
  price: number;
  quantity: number;
}

export interface ParsedQuoteSection {
  customerName: string;
  serialNumber: string;
  facilityName: string;
  shortFacility: string;
  address: string;
  contractType: string;
  parts: ParsedPartItem[];
}

export interface ParsedUploadResult {
  quoteType: string;
  serviceQuote: ParsedQuoteSection;
  partsQuote: ParsedQuoteSection;
  sheets: string[];
}

function str(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function num(val: unknown): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function parsePartBlock(
  data: unknown[][],
  startRow: number,
  colIdx: number
): ParsedPartItem | null {
  const partName = str(data[startRow + 1]?.[colIdx]);
  const partNumber = str(data[startRow + 2]?.[colIdx]);
  const price = num(data[startRow + 3]?.[colIdx]);
  const quantity = num(data[startRow + 4]?.[colIdx]) || 1;
  const altName = str(data[startRow + 5]?.[colIdx]);
  const altPartNumber = str(data[startRow + 6]?.[colIdx]);
  const altPrice = num(data[startRow + 7]?.[colIdx]);

  const finalName = (partName || altName).trim();
  const finalPartNumber = (partNumber || altPartNumber).trim();
  const finalPrice = price || altPrice;

  if (!finalName && !finalPartNumber) return null;

  return {
    name: finalName,
    partNumber: finalPartNumber,
    price: finalPrice,
    quantity: Math.max(1, quantity),
  };
}

function parseFSEInput(data: unknown[][]): {
  serviceQuote: ParsedQuoteSection;
  partsQuote: ParsedQuoteSection;
  quoteType: string;
} {
  const quoteType = str(data[1]?.[0]) || "Service and Parts";

  // Service section uses col B (index 1)
  const serviceQuote: ParsedQuoteSection = {
    customerName: str(data[7]?.[1]),
    serialNumber: str(data[8]?.[1]),
    facilityName: str(data[9]?.[1]),
    shortFacility: str(data[10]?.[1]),
    address: str(data[11]?.[1]),
    contractType: str(data[12]?.[1]),
    parts: [],
  };

  // Parts section uses col E (index 4)
  const partsQuote: ParsedQuoteSection = {
    customerName: str(data[7]?.[4]),
    serialNumber: str(data[8]?.[4]),
    facilityName: str(data[9]?.[4]),
    shortFacility: str(data[10]?.[4]),
    address: str(data[11]?.[4]),
    contractType: str(data[12]?.[4]),
    parts: [],
  };

  // Parse up to 10 part blocks per section (each block = 8 rows, starting at row index 15)
  for (let i = 0; i < 10; i++) {
    const startRow = 15 + i * 8;
    if (startRow >= data.length) break;

    const servicePart = parsePartBlock(data, startRow, 1);
    if (servicePart) serviceQuote.parts.push(servicePart);

    const partsPart = parsePartBlock(data, startRow, 4);
    if (partsPart) partsQuote.parts.push(partsPart);
  }

  return { serviceQuote, partsQuote, quoteType };
}

router.post(
  "/parse-upload",
  upload.single("file"),
  (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const ext = req.file.originalname.toLowerCase();
    if (!ext.endsWith(".xlsx") && !ext.endsWith(".xls")) {
      res.status(400).json({ error: "Please upload an Excel file (.xlsx or .xls)" });
      return;
    }

    let wb: xlsx.WorkBook;
    try {
      wb = xlsx.read(req.file.buffer, { type: "buffer" });
    } catch {
      res.status(400).json({ error: "Could not read Excel file. Make sure it is a valid .xlsx file." });
      return;
    }

    const sheets = wb.SheetNames;

    // Try to find the FSE Input sheet (handle trailing spaces)
    const fseSheetName = sheets.find(
      (s) => s.trim().toLowerCase() === "fse input"
    );

    if (!fseSheetName) {
      res.status(400).json({
        error: `Could not find the 'FSE Input' sheet. Found sheets: ${sheets.join(", ")}`,
      });
      return;
    }

    const fseSheet = wb.Sheets[fseSheetName];
    const data = xlsx.utils.sheet_to_json(fseSheet, {
      header: 1,
      defval: "",
    }) as unknown[][];

    const { serviceQuote, partsQuote, quoteType } = parseFSEInput(data);

    const result: ParsedUploadResult = {
      quoteType,
      serviceQuote,
      partsQuote,
      sheets,
    };

    res.json(result);
  }
);

export default router;

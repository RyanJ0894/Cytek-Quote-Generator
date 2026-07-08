import { Router, type Request, type Response, type NextFunction } from "express";
import multer, { MulterError } from "multer";
import xlsx from "xlsx";
import {
  findFseSheetName,
  parseFSEInput,
  type ParsedUploadResult,
} from "../lib/fseUploadParser.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const router = Router();

router.post(
  "/parse-upload",
  (req: Request, res: Response, next: NextFunction) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err instanceof MulterError) {
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? `File is too large. Maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`
            : `Upload failed: ${err.message}`;
        res.status(400).json({ error: message });
        return;
      }
      if (err) {
        next(err);
        return;
      }
      next();
    });
  },
  (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    if (!req.file.buffer || req.file.buffer.length === 0) {
      res.status(400).json({ error: "The uploaded file is empty." });
      return;
    }

    const name = req.file.originalname.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
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
    const fseSheetName = findFseSheetName(sheets);

    if (!fseSheetName) {
      res.status(400).json({
        error: `Could not find the 'FSE Input' sheet. Found sheets: ${sheets.join(", ")}`,
      });
      return;
    }

    try {
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
    } catch (err) {
      console.error("Error parsing 'FSE Input' sheet:", err);
      res.status(400).json({
        error: "The 'FSE Input' sheet is not in the expected format. Please check the file and try again.",
      });
    }
  }
);

export default router;

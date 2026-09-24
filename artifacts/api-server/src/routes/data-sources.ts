import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer, { MulterError } from "multer";
import { DataSourceError, getDataSourceService, getStorageDiagnostics, reportStorageError } from "../data-sources/service.js";
import { logoBuffer, quoteProfileStatus } from "../data-sources/quote-profile.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

const router: IRouter = Router();

/** Express 5 types route params as string | string[]; these routes have a single :id. */
function paramId(req: Request): string {
  const id = (req.params as Record<string, string | string[]>)["id"];
  return Array.isArray(id) ? id[0] : id;
}

/** Errors thrown by the pg driver (connection refused, auth, TLS, DNS) rather than by the app. */
function isDatabaseError(err: unknown): err is Error {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code ?? "";
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|28P01|28000|3D000|08\d{3}|SELF_SIGNED|CERT_|DEPTH_ZERO/.test(code) ||
    /password authentication|no pg_hba|SSL|ssl|timeout|getaddrinfo|connect ECONN|database .* does not exist/i.test(err.message);
}

function handle(err: unknown, res: Response, what: string) {
  if (err instanceof DataSourceError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (isDatabaseError(err)) {
    reportStorageError(err);
    console.error(`Database error ${what}:`, err);
    res.status(503).json({ error: `Database connection failed: ${err.message}`, storage: getStorageDiagnostics() });
    return;
  }
  console.error(`Error ${what}:`, err);
  res.status(500).json({ error: `Failed ${what}` });
}

function workbookUpload(req: Request, res: Response, next: NextFunction) {
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
    if (!req.file || !req.file.buffer?.length) {
      res.status(400).json({ error: "Please choose an Excel workbook (.xlsx or .xls) to upload." });
      return;
    }
    const name = req.file.originalname.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
      res.status(400).json({ error: "Please upload an Excel file (.xlsx or .xls)" });
      return;
    }
    next();
  });
}

/** List every data source (built-in and uploaded) plus which one is the default. */
router.get("/", async (_req, res) => {
  try {
    res.json(await getDataSourceService().list());
  } catch (err) {
    handle(err, res, "listing data sources");
  }
});

/** Add a data source: multipart form with `name` and `file` (a Cytek-format workbook). */
router.post("/", workbookUpload, async (req, res) => {
  try {
    const raw = (req.body as Record<string, unknown> | undefined)?.name;
    const name = typeof raw === "string" ? raw : Array.isArray(raw) && typeof raw[0] === "string" ? raw[0] : "";
    const summary = await getDataSourceService().importFromWorkbook(name, {
      buffer: req.file!.buffer,
      fileName: req.file!.originalname,
    });
    res.status(201).json(summary);
  } catch (err) {
    handle(err, res, "importing the data source");
  }
});

/** Replace a data source's data from a newer workbook (id and name are kept). */
router.post("/:id/replace", workbookUpload, async (req, res) => {
  try {
    const summary = await getDataSourceService().replaceWorkbook(paramId(req), {
      buffer: req.file!.buffer,
      fileName: req.file!.originalname,
    });
    res.json(summary);
  } catch (err) {
    handle(err, res, "replacing the data source");
  }
});

/** The seller identity/branding for a source (null until set up) plus what is still missing. */
router.get("/:id/profile", async (req, res) => {
  try {
    const profile = await getDataSourceService().getProfile(paramId(req));
    res.json({ profile, ...quoteProfileStatus(profile) });
  } catch (err) {
    handle(err, res, "loading the quote profile");
  }
});

router.put("/:id/profile", async (req, res) => {
  try {
    const profile = await getDataSourceService().setProfile(paramId(req), req.body);
    res.json({ profile, ...quoteProfileStatus(profile) });
  } catch (err) {
    handle(err, res, "saving the quote profile");
  }
});

/** The profile's logo as an image, for previews. */
router.get("/:id/logo", async (req, res) => {
  try {
    const profile = await getDataSourceService().getProfile(paramId(req));
    if (!profile?.logo) {
      res.status(404).json({ error: "This data source has no logo." });
      return;
    }
    const mime = profile.logo.dataUrl.slice(5, profile.logo.dataUrl.indexOf(";"));
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "no-cache");
    res.send(logoBuffer(profile.logo));
  } catch (err) {
    handle(err, res, "loading the logo");
  }
});

router.post("/:id/default", async (req, res) => {
  try {
    const defaultId = await getDataSourceService().setDefault(paramId(req));
    res.json({ defaultId });
  } catch (err) {
    handle(err, res, "setting the default data source");
  }
});

/** Edit a data source's management fields (currently: name). */
router.patch("/:id", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.name !== "string") {
      res.status(400).json({ error: "Provide the new name as { name }." });
      return;
    }
    res.json(await getDataSourceService().rename(paramId(req), body.name));
  } catch (err) {
    handle(err, res, "renaming the data source");
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await getDataSourceService().delete(paramId(req));
    res.status(204).end();
  } catch (err) {
    handle(err, res, "deleting the data source");
  }
});

export default router;

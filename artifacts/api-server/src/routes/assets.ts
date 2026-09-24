import { Router, type IRouter } from "express";
import { DataSourceError, getDataSourceService } from "../data-sources/service.js";

const router: IRouter = Router();

function dataSourceId(q: unknown): string | undefined {
  return typeof q === "string" && q.trim() ? q.trim() : undefined;
}

router.get("/serials", async (req, res) => {
  try {
    const ds = await getDataSourceService().resolve(dataSourceId(req.query.dataSource));
    res.json({ serials: ds.listSerials() });
  } catch (err) {
    if (err instanceof DataSourceError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error("Error fetching serials:", err);
    res.status(500).json({ error: "Failed to load serial numbers" });
  }
});

router.get("/lookup", async (req, res) => {
  const serial = req.query.serial as string;
  if (!serial) {
    res.status(400).json({ error: "serial query parameter is required" });
    return;
  }

  try {
    const ds = await getDataSourceService().resolve(dataSourceId(req.query.dataSource));
    const asset = ds.lookupAsset(serial);
    if (!asset) {
      res.status(404).json({ error: `No asset found for serial: ${serial}` });
      return;
    }
    res.json({ asset });
  } catch (err) {
    if (err instanceof DataSourceError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error("Error looking up asset:", err);
    res.status(500).json({ error: "Failed to look up asset" });
  }
});

export default router;

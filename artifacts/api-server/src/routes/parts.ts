import { Router, type IRouter } from "express";
import { DataSourceError, getDataSourceService } from "../data-sources/service.js";

const router: IRouter = Router();

/** All products — parts and services, priced or not — from the requested (or default) data source. */
router.get("/", async (req, res) => {
  try {
    const id = typeof req.query.dataSource === "string" && req.query.dataSource.trim() ? req.query.dataSource.trim() : undefined;
    const ds = await getDataSourceService().resolve(id);
    res.json({ parts: ds.listProducts() });
  } catch (err) {
    if (err instanceof DataSourceError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error("Error fetching parts:", err);
    res.status(500).json({ error: "Failed to load parts" });
  }
});

export default router;

import { Router, type IRouter } from "express";
import { getDataSourceService } from "../data-sources/service.js";

const router: IRouter = Router();

/** Describes the default data source (kept for compatibility; see /data-sources for the full list). */
router.get("/", async (_req, res) => {
  try {
    res.json(await getDataSourceService().summary());
  } catch (err) {
    console.error("Error describing data source:", err);
    res.status(500).json({ error: "Failed to describe data source" });
  }
});

export default router;

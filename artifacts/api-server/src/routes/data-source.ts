import { Router, type IRouter } from "express";
import { getDefaultDataSource, summarize } from "../data-sources/registry.js";

const router: IRouter = Router();

/** Describes the data source Manual Mode is currently looking up against. */
router.get("/", (_req, res) => {
  try {
    res.json(summarize(getDefaultDataSource()));
  } catch (err) {
    console.error("Error describing data source:", err);
    res.status(500).json({ error: "Failed to describe data source" });
  }
});

export default router;

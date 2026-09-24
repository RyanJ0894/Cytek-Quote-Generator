import { Router, type IRouter } from "express";
import { getDefaultDataSource } from "../data-sources/registry.js";

const router: IRouter = Router();

/** All priced products — parts and services — from the default data source. */
router.get("/", (_req, res) => {
  try {
    const parts = getDefaultDataSource().listProducts();
    res.json({ parts });
  } catch (err) {
    console.error("Error fetching parts:", err);
    res.status(500).json({ error: "Failed to load parts" });
  }
});

export default router;

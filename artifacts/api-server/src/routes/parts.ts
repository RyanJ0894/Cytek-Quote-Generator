import { Router, type IRouter } from "express";
import { getParts } from "../lib/excelParser.js";

const router: IRouter = Router();

router.get("/", (_req, res) => {
  try {
    const parts = getParts();
    res.json({ parts });
  } catch (err) {
    console.error("Error fetching parts:", err);
    res.status(500).json({ error: "Failed to load parts" });
  }
});

export default router;

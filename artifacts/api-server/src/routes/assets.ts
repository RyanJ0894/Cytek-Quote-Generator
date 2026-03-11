import { Router, type IRouter } from "express";
import {
  getAllSerials,
  lookupAssetBySerial,
} from "../lib/excelParser.js";

const router: IRouter = Router();

router.get("/serials", (_req, res) => {
  try {
    const serials = getAllSerials();
    res.json({ serials });
  } catch (err) {
    console.error("Error fetching serials:", err);
    res.status(500).json({ error: "Failed to load serial numbers" });
  }
});

router.get("/lookup", (req, res) => {
  const serial = req.query.serial as string;
  if (!serial) {
    res.status(400).json({ error: "serial query parameter is required" });
    return;
  }

  try {
    const asset = lookupAssetBySerial(serial);
    if (!asset) {
      res.status(404).json({ error: `No asset found for serial: ${serial}` });
      return;
    }
    res.json({ asset });
  } catch (err) {
    console.error("Error looking up asset:", err);
    res.status(500).json({ error: "Failed to look up asset" });
  }
});

export default router;

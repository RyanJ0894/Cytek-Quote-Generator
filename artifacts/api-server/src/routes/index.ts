import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import assetsRouter from "./assets.js";
import partsRouter from "./parts.js";
import quotesRouter from "./quotes.js";
import uploadRouter from "./upload.js";
import dataSourcesRouter from "./data-sources.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/assets", assetsRouter);
router.use("/parts", partsRouter);
router.use("/quotes", quotesRouter);
router.use("/quotes", uploadRouter);
router.use("/data-sources", dataSourcesRouter);

export default router;

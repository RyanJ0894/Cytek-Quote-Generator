import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import assetsRouter from "./assets.js";
import partsRouter from "./parts.js";
import quotesRouter from "./quotes.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/assets", assetsRouter);
router.use("/parts", partsRouter);
router.use("/quotes", quotesRouter);

export default router;

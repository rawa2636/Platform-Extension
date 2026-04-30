import { Router, type IRouter } from "express";
import healthRouter from "./health";
import modelsRouter from "./models";
import runsRouter from "./runs";
import harvestRouter from "./harvest";
import routeRouter from "./router";
import statsRouter from "./stats";
import traderRouter from "./trader";

const router: IRouter = Router();

router.use(healthRouter);
router.use(modelsRouter);
router.use(runsRouter);
router.use(harvestRouter);
router.use(routeRouter);
router.use(statsRouter);
router.use(traderRouter);

export default router;

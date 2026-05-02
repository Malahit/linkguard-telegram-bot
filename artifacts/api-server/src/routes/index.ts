import { Router, type IRouter } from "express";
import healthRouter from "./health";
import linksRouter from "./links";
import usersRouter from "./users";

const router: IRouter = Router();

router.use(healthRouter);
router.use(linksRouter);
router.use(usersRouter);

export default router;

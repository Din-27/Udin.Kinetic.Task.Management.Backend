import { Router, Request, Response } from "express";
import { checkNeonConnection } from "../lib/data-service.js";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  const status = await checkNeonConnection();
  res.json(status);
});

export default router;

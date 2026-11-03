import { Router, Request, Response } from "express";
import { getIO } from "../socket.js";

const router = Router();

/**
 * Endpoint inisialisasi / cek kesiapan Socket.IO server:
 * GET & POST /api/socket-init
 */
const handleSocketInit = (_req: Request, res: Response) => {
  const io = getIO();
  const isReady = !!io;

  return res.status(200).json({
    ok: true,
    status: isReady ? "ready" : "initializing",
    message: isReady
      ? "Socket.IO server is active and running"
      : "Socket.IO server instance not yet attached",
    path: "/api/socket/io",
    connectedClients: io ? io.engine?.clientsCount ?? 0 : 0,
    timestamp: new Date().toISOString(),
  });
};

router.get("/", handleSocketInit);
router.post("/", handleSocketInit);

export default router;

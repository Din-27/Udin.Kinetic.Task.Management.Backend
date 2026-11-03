import { Router, Request, Response } from "express";
import { WhiteboardService } from "../services/whiteboard.service.js";

const router = Router();

// Re-export types for compatibility
export type {
  WhiteboardElement,
  WhiteboardComment,
  WhiteboardData,
} from "../services/whiteboard.service.js";

// 1. GET /api/whiteboard?workspaceId=...&userId=...
router.get("/", async (req: Request, res: Response) => {
  try {
    const workspaceId = (req.query.workspaceId as string) || "default";
    const userId = req.query.userId as string | undefined;

    const whiteboards = await WhiteboardService.getWhiteboards(workspaceId, userId);
    return res.json(whiteboards);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/whiteboard/:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const whiteboard = await WhiteboardService.getWhiteboardById(req.params.id);
    if (!whiteboard) {
      return res.status(404).json({ error: "Papan tulis tidak ditemukan" });
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    return res.json(whiteboard);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/whiteboard - Simpan atau perbarui papan tulis
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const saved = await WhiteboardService.saveWhiteboard({
      id: body.id,
      workspaceId: body.workspaceId,
      userId: body.userId,
      creatorName: body.creatorName,
      title: body.title,
      description: body.description,
      elements: body.elements,
      comments: body.comments,
    });

    return res.status(201).json(saved);
  } catch (err: any) {
    if (err.message === "FORBIDDEN_USER") {
      return res.status(403).json({ error: "Hanya pembuat yang dapat mengedit papan tulis ini." });
    }
    return res.status(500).json({ error: err.message });
  }
});

// 4. POST /api/whiteboard/:id/comments - Tambahkan pertanyaan / komentar
router.post("/:id/comments", async (req: Request, res: Response) => {
  try {
    const comment = await WhiteboardService.addComment(req.params.id, req.body || {});
    return res.status(201).json(comment);
  } catch (err: any) {
    if (err.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Papan tulis tidak ditemukan" });
    }
    return res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /api/whiteboard/:id
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string | undefined;
    await WhiteboardService.deleteWhiteboard(req.params.id, userId);
    return res.json({ success: true, message: "Papan tulis berhasil dihapus" });
  } catch (err: any) {
    if (err.message === "FORBIDDEN_USER") {
      return res.status(403).json({ error: "Hanya pembuat yang dapat menghapus papan tulis ini." });
    }
    return res.status(500).json({ error: err.message });
  }
});

export default router;

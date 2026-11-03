import { Router, Request, Response } from "express";
import { FlowchartService } from "../services/flowchart.service.js";

const router = Router();

// Re-export types for compatibility
export type {
  FlowchartNode,
  FlowchartEdge,
  FlowchartComment,
  FlowchartDiagram,
  FlowchartNodeType,
} from "../services/flowchart.service.js";

// 1. GET /api/flowchart?workspaceId=...&userId=...
router.get("/", async (req: Request, res: Response) => {
  try {
    const workspaceId = (req.query.workspaceId as string) || "default";
    const userId = req.query.userId as string | undefined;

    const diagrams = await FlowchartService.getFlowcharts(workspaceId, userId);
    return res.json(diagrams);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/flowchart/:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const diagram = await FlowchartService.getFlowchartById(req.params.id);
    if (!diagram) {
      return res.status(404).json({ error: "Diagram flowchart tidak ditemukan" });
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    return res.json(diagram);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/flowchart - Simpan diagram
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const saved = await FlowchartService.saveFlowchart({
      id: body.id,
      workspaceId: body.workspaceId,
      userId: body.userId || body.creatorId,
      creatorName: body.creatorName,
      title: body.title,
      description: body.description,
      prompt: body.prompt,
      nodes: body.nodes,
      edges: body.edges,
      comments: body.comments,
    });

    return res.status(201).json(saved);
  } catch (err: any) {
    if (err.message === "FORBIDDEN_USER") {
      return res.status(403).json({ error: "Hanya user pembuat yang dapat mengedit diagram flowchart ini." });
    }
    return res.status(500).json({ error: err.message });
  }
});

// 3b. POST /api/flowchart/:id/comments - Tambah komentar ke diagram
router.post("/:id/comments", async (req: Request, res: Response) => {
  try {
    const comment = await FlowchartService.addComment(req.params.id, req.body || {});
    return res.status(201).json(comment);
  } catch (err: any) {
    if (err.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Diagram flowchart tidak ditemukan" });
    }
    return res.status(500).json({ error: err.message });
  }
});

// 4. DELETE /api/flowchart/:id
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string | undefined;
    await FlowchartService.deleteFlowchart(req.params.id, userId);
    return res.json({ success: true, id: req.params.id });
  } catch (err: any) {
    if (err.message === "FORBIDDEN_USER") {
      return res.status(403).json({ error: "Hanya user pembuat yang dapat menghapus diagram flowchart ini." });
    }
    return res.status(500).json({ error: err.message });
  }
});

// 5. POST /api/flowchart/generate - Generate Flowchart dari Prompt AI
router.post("/generate", async (req: Request, res: Response) => {
  try {
    const { prompt, workspaceId = "default", userId, creatorId, creatorName } = req.body;

    if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
      return res.status(400).json({ error: "Prompt proses wajib diisi" });
    }

    const result = await FlowchartService.generateFlowchart(
      prompt,
      workspaceId,
      userId || creatorId,
      creatorName
    );

    return res.json(result);
  } catch (err: any) {
    console.error("Error generating flowchart:", err);
    return res.status(500).json({ error: err.message || "Gagal membuat flowchart" });
  }
});

export default router;

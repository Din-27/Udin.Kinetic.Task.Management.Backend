import { Router, Request, Response } from "express";
import {
  getProjects,
  createProject,
  getProjectById,
  updateProject,
  deleteProject,
} from "../lib/data-service.js";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const workspaceId = (req.query.workspaceId as string) || undefined;
    const projects = await getProjects(workspaceId);
    return res.json(projects);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body.name || body.name.trim() === "") {
      return res.status(400).json({ error: "Nama project wajib diisi" });
    }
    const project = await createProject(body);
    return res.status(201).json(project);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const project = await getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: "Project tidak ditemukan" });
    }
    return res.json(project);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const updated = await updateProject(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: "Project tidak ditemukan" });
    }
    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const updated = await updateProject(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: "Project tidak ditemukan" });
    }
    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await deleteProject(req.params.id);
    return res.json({ success: true, message: "Project berhasil dihapus" });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;

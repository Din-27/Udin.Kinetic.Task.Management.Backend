import { Router, Request, Response } from "express";
import {
  getTasks,
  createTask,
  getTaskById,
  updateTask,
  deleteTask,
  addComment,
  addSubtask,
  toggleSubtask,
} from "../lib/data-service.js";
import { sendServerPushNotification } from "../lib/server-push.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const projectId = (req.query.projectId as string) || undefined;
    const workspaceId = (req.query.workspaceId as string) || undefined;
    const search = (req.query.search as string) || undefined;
    const status = (req.query.status as string) || undefined;

    const tasks = await getTasks(projectId, search, status, workspaceId);
    return res.json(tasks);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body.title || body.title.trim() === "") {
      return res.status(400).json({ error: "Judul task wajib diisi" });
    }
    if (!body.projectId) {
      return res.status(400).json({ error: "Project ID wajib disertakan" });
    }

    const task = await createTask(body);
    return res.status(201).json(task);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const task = await getTaskById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: "Task tidak ditemukan" });
    }
    return res.json(task);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const userId = body.currentUserId || "usr-1";
    const updated = await updateTask(req.params.id, body, userId);
    if (!updated) {
      return res.status(404).json({ error: "Task tidak ditemukan" });
    }
    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await deleteTask(req.params.id);
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Comments
router.get("/:id/comments", async (req: Request, res: Response) => {
  try {
    const task = await getTaskById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: "Task tidak ditemukan" });
    }
    return res.json(task.comments || []);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/:id/comments", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const content = body.content || "";
    const attachments = body.attachments || [];
    if (!content.trim() && attachments.length === 0) {
      return res.status(400).json({ error: "Isi komentar atau lampiran wajib diisi" });
    }
    const comment = await addComment(
      req.params.id,
      content,
      body.userId || "usr-1",
      attachments,
      body.id
    );

    // Kirim Web Push ke semua anggota workspace (pengirim dikecualikan secara otomatis)
    const task = await prisma.task
      .findUnique({
        where: { id: req.params.id },
        select: {
          title: true,
          project: {
            select: { workspaceId: true },
          },
        },
      })
      .catch(() => null);

    const taskTitle = task?.title || "Task";
    const senderName = comment.user?.name || "Anggota Tim";
    const wsId = body.workspaceId || task?.project?.workspaceId;

    sendServerPushNotification({
      title: `Komentar di "${taskTitle}"`,
      body: `${senderName}: ${content}`,
      url: `/?taskId=${req.params.id}${wsId ? `&workspaceId=${wsId}` : ""}`,
      excludeUserId: body.userId,
      excludeEndpoint: body.endpoint || body.clientEndpoint,
      workspaceId: wsId,
    }).catch((err) => {
      console.warn("Background web push notification failed in /api/tasks/:id/comments:", err);
    });

    return res.status(201).json(comment);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Subtasks
router.post("/:id/subtasks", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body.title || body.title.trim() === "") {
      return res.status(400).json({ error: "Judul subtask wajib diisi" });
    }
    const subtask = await addSubtask(req.params.id, body.title);
    return res.status(201).json(subtask);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch("/:id/subtasks", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body.subtaskId) {
      return res.status(400).json({ error: "subtaskId wajib disertakan" });
    }
    await toggleSubtask(body.subtaskId, body.completed);
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;

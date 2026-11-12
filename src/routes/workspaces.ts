import { Router, Request, Response } from "express";
import {
  getWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  getProjects,
  getTasks,
} from "../lib/data-service.js";
import { prisma } from "../lib/prisma.js";
import { User } from "../types/index.js";
import { authenticateRequest } from "./auth.js";

const router = Router();

// Endpoint agregasi (bundle) untuk memangkas over-request frontend saat load/switch workspace
router.get("/bundle", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspaceId as string;
    const userId = (req.query.userId as string) || "";

    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId wajib disertakan" });
    }

    // 1. Dapatkan detail workspace
    const ws: any = await prisma.workspace
      .findFirst({
        where: {
          OR: [{ id: workspaceId }, { slug: workspaceId }],
        },
      })
      .catch(() => null);

    const targetWsId = ws ? ws.id : workspaceId;

    // 2. Fetch parallel untuk members, projects, tasks, dan status unread chat
    const [dbMembers, projects, tasks, chatRecords] = await Promise.all([
      prisma.workspaceMember.findMany({
        where: { workspaceId: targetWsId },
        include: { user: true },
        orderBy: { joinedAt: "asc" },
      }),
      getProjects(targetWsId),
      getTasks(undefined, undefined, undefined, targetWsId),
      userId
        ? prisma.systemSetting.findMany({
            where: {
              key: {
                startsWith: `chat_read:${userId}:`,
              },
            },
          })
        : Promise.resolve([]),
    ]);

    // Format members
    const members: User[] = dbMembers.map((m: any) => {
      const isCreator =
        ws?.createdBy === m.user.id || (m.user.email && ws?.createdBy === m.user.email);
      const role = isCreator ? "ADMIN" : (m.role as any);
      return {
        id: m.user.id,
        name: m.user.name || "Member",
        email: m.user.email || "",
        avatar: m.user.avatar || m.user.image || "",
        role,
        title: role === "ADMIN" ? "Lead / Admin" : "Team Member",
      };
    });

    // Format unread chat timestamps
    const readTimestamps: Record<string, number> = {};
    if (userId && Array.isArray(chatRecords)) {
      const prefix = `chat_read:${userId}:`;
      for (const rec of chatRecords) {
        const chatKey = rec.key.replace(prefix, "");
        const ts = parseInt(rec.value, 10);
        if (!isNaN(ts)) {
          readTimestamps[chatKey] = ts;
        }
      }
    }

    return res.json({
      workspace: ws || null,
      members,
      projects,
      tasks,
      readTimestamps,
    });
  } catch (error: any) {
    console.error("Error in /api/workspaces/bundle:", error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || undefined;
    const email = (req.query.email as string) || undefined;
    const workspaces = await getWorkspaces(userId, email);
    return res.json(workspaces);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body.name || body.name.trim() === "") {
      return res.status(400).json({ error: "Nama workspace wajib diisi" });
    }
    const workspace = await createWorkspace({
      id: body.id,
      name: body.name,
      slug: body.slug,
      description: body.description,
      color: body.color,
      createdBy: body.createdBy || body.creator?.id,
      creator: body.creator,
    });
    return res.status(201).json(workspace);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body.id) {
      return res.status(400).json({ error: "ID workspace wajib disertakan" });
    }

    const authUser = await authenticateRequest(req);
    if (authUser) {
      const ws = await prisma.workspace.findFirst({
        where: { OR: [{ id: body.id }, { slug: body.id }] },
        include: { members: true },
      });
      if (ws) {
        const isOwner = ws.createdBy === authUser.id || ws.createdBy === authUser.email;
        const memberRec = ws.members.find((m) => m.userId === authUser.id);
        const isAdminMember = memberRec?.role === "ADMIN" || authUser.role === "ADMIN";
        if (!isOwner && !isAdminMember) {
          return res.status(403).json({ error: "Hanya pemilik atau admin yang dapat mengubah pengaturan workspace ini" });
        }
      }
    }

    const updated = await updateWorkspace(body.id, body.updates || {});
    if (!updated) {
      return res.status(404).json({ error: "Workspace tidak ditemukan" });
    }
    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete("/", async (req: Request, res: Response) => {
  try {
    const id = (req.query.id as string) || (req.body.id as string);
    if (!id) {
      return res.status(400).json({ error: "ID workspace wajib disertakan" });
    }

    const authUser = await authenticateRequest(req);
    if (authUser) {
      const ws = await prisma.workspace.findFirst({
        where: { OR: [{ id }, { slug: id }] },
        include: { members: true },
      });
      if (ws) {
        const isOwner = ws.createdBy === authUser.id || ws.createdBy === authUser.email;
        const memberRec = ws.members.find((m) => m.userId === authUser.id);
        const isAdminMember = memberRec?.role === "ADMIN" || authUser.role === "ADMIN";
        if (!isOwner && !isAdminMember) {
          return res.status(403).json({ error: "Hanya pemilik atau admin yang dapat menghapus workspace ini" });
        }
      }
    }

    const success = await deleteWorkspace(id);
    if (!success) {
      return res.status(404).json({ error: "Gagal menghapus workspace" });
    }
    return res.json({ success: true, id });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;

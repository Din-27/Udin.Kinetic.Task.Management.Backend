import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { WorkspaceInvitation } from "../types/index.js";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspaceId as string;
    const token = req.query.token as string;
    const email = ((req.query.email as string) || "").trim().toLowerCase();

    if (token) {
      const r = await prisma.workspaceInvitation.findFirst({
        where: { token, status: "PENDING" },
      });
      if (!r) {
        return res.status(404).json({ error: "Undangan tidak ditemukan atau sudah digunakan" });
      }
      return res.json({
        id: r.id,
        token: r.token,
        workspaceId: r.workspaceId,
        workspaceName: r.workspaceName,
        email: r.email,
        name: r.name,
        role: r.role,
        title: r.title,
        invitedBy: {
          id: r.invitedById || "admin",
          name: r.invitedByName || "Admin",
          email: r.invitedByEmail || "admin@company.com",
        },
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt || ""),
        status: r.status,
      });
    }

    const where: any = { status: "PENDING" };
    if (workspaceId) where.workspaceId = workspaceId;
    if (email) where.email = { equals: email, mode: "insensitive" as const };

    const records = await prisma.workspaceInvitation.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    const mapped: WorkspaceInvitation[] = records.map((r) => ({
      id: r.id,
      token: r.token,
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName,
      email: r.email,
      name: r.name,
      role: r.role as any,
      title: r.title,
      invitedBy: {
        id: r.invitedById || "admin",
        name: r.invitedByName || "Admin",
        email: r.invitedByEmail || "admin@company.com",
      },
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt || ""),
      status: r.status as any,
    }));

    return res.json(mapped);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body.workspaceId || !body.email) {
      return res.status(400).json({ error: "workspaceId dan email wajib diisi" });
    }

    const cleanEmail = body.email.trim().toLowerCase();
    const token = body.token || `inv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const newId = body.id || `inv-${Date.now()}`;
    const wsName = body.workspaceName || "Workspace";
    const name = body.name?.trim() || cleanEmail.split("@")[0];
    const role = body.role || "MEMBER";
    const title = body.title?.trim() || "Team Member";
    const invitedById = body.invitedBy?.id || "admin";
    const invitedByName = body.invitedBy?.name || "Admin";
    const invitedByEmail = body.invitedBy?.email || "admin@company.com";
    const createdAt = body.createdAt ? new Date(body.createdAt) : new Date();

    // Cabut undangan pending sebelumnya untuk email yang sama di workspace ini
    await prisma.workspaceInvitation.updateMany({
      where: {
        workspaceId: body.workspaceId,
        email: { equals: cleanEmail, mode: "insensitive" as const },
        status: "PENDING",
      },
      data: { status: "REVOKED" },
    });

    const created = await prisma.workspaceInvitation.create({
      data: {
        id: newId,
        token,
        workspaceId: body.workspaceId,
        workspaceName: wsName,
        email: cleanEmail,
        name,
        role,
        title,
        invitedById,
        invitedByName,
        invitedByEmail,
        status: "PENDING",
        createdAt,
      },
    });

    const newInvitation: WorkspaceInvitation = {
      id: created.id,
      token: created.token,
      workspaceId: created.workspaceId,
      workspaceName: created.workspaceName,
      email: created.email,
      name: created.name,
      role: created.role as any,
      title: created.title,
      invitedBy: {
        id: invitedById,
        name: invitedByName,
        email: invitedByEmail,
      },
      createdAt: created.createdAt.toISOString(),
      status: "PENDING",
    };

    return res.status(201).json(newInvitation);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch("/", async (req: Request, res: Response) => {
  try {
    const { token, id, status } = req.body;

    if ((!token && !id) || !status) {
      return res.status(400).json({ error: "token/id dan status wajib disertakan" });
    }

    const targetStatus = status === "ACCEPTED" ? "ACCEPTED" : "REVOKED";

    const where: any = token ? { token } : { id };
    const r = await prisma.workspaceInvitation.findFirst({ where });

    if (!r) {
      return res.status(404).json({ error: "Undangan tidak ditemukan" });
    }

    await prisma.workspaceInvitation.update({
      where: { id: r.id },
      data: { status: targetStatus },
    });

    // Jika status ACCEPTED, otomatis daftarkan user ke WorkspaceMember di DB
    if (targetStatus === "ACCEPTED" && r.workspaceId && r.email) {
      try {
        const existingWs = await prisma.workspace.findUnique({ where: { id: r.workspaceId } });
        if (!existingWs) {
          return res.status(404).json({
            error: "Workspace tujuan undangan tidak ditemukan atau telah dihapus.",
          });
        }

        const dbUser = await prisma.user.upsert({
          where: { email: r.email.toLowerCase() },
          update: {
            ...(r.name ? { name: r.name } : {}),
          },
          create: {
            email: r.email.toLowerCase(),
            name: r.name || "Member",
            role: r.role || "MEMBER",
          },
        });

        await prisma.workspaceMember.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: r.workspaceId,
              userId: dbUser.id,
            },
          },
          update: { role: (r.role === "ADMIN" ? "ADMIN" : "MEMBER") as any },
          create: {
            workspaceId: r.workspaceId,
            userId: dbUser.id,
            role: (r.role === "ADMIN" ? "ADMIN" : "MEMBER") as any,
          },
        });
      } catch (wsErr) {
        console.warn("Failed to automatically add accepted member to workspace in DB:", wsErr);
      }
    }

    return res.json({
      success: true,
      invitation: {
        id: r.id,
        token: r.token,
        status: targetStatus,
        workspaceId: r.workspaceId,
        workspaceName: r.workspaceName,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;

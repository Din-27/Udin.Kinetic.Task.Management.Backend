import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { User } from "../types/index.js";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspaceId as string;

    if (!workspaceId) {
      return res.json([]);
    }

    const ws: any = await prisma.workspace
      .findFirst({
        where: {
          OR: [{ id: workspaceId }, { slug: workspaceId }],
        },
        select: { id: true, createdBy: true },
      })
      .catch(() => null);

    const targetWsId = ws ? ws.id : workspaceId;

    const dbMembers = await prisma.workspaceMember.findMany({
      where: { workspaceId: targetWsId },
      include: { user: true },
      orderBy: { joinedAt: "asc" },
    });

    if (dbMembers.length > 0) {
      const mapped: User[] = dbMembers.map((m: any) => {
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
      return res.json(mapped);
    }

    return res.json([]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { workspaceId, member, members } = req.body;

    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId wajib disertakan" });
    }

    const memberList: User[] = Array.isArray(members)
      ? members
      : member
      ? [member]
      : [];

    const existingWs = await prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!existingWs) {
      return res.status(404).json({ error: "Workspace tidak ditemukan." });
    }

    for (const m of memberList) {
      if (!m.id && !m.email) continue;
      const role = m.role === "ADMIN" ? "ADMIN" : "MEMBER";

      try {
        let userId = m.id;
        if (m.email) {
          const user = await prisma.user.upsert({
            where: { email: m.email },
            update: {
              name: m.name,
              avatar: m.avatar,
            },
            create: {
              ...(m.id ? { id: m.id } : {}),
              email: m.email,
              name: m.name,
              avatar: m.avatar,
              role,
            },
          });
          userId = user.id;
        }

        if (userId) {
          await prisma.workspaceMember.upsert({
            where: {
              workspaceId_userId: {
                workspaceId,
                userId,
              },
            },
            update: { role: role as any },
            create: {
              workspaceId,
              userId,
              role: role as any,
            },
          });
        }
      } catch (itemErr) {
        console.warn("Failed to upsert workspace member in DB (graceful):", itemErr);
      }
    }

    const updatedDbMembers = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
    });

    const mapped: User[] = updatedDbMembers.map((m: any) => ({
      id: m.user.id,
      name: m.user.name || "Member",
      email: m.user.email || "",
      avatar: m.user.avatar || m.user.image || "",
      role: m.role as any,
      title: m.role === "ADMIN" ? "Lead / Admin" : "Team Member",
    }));

    return res.json({ success: true, members: mapped });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete("/", async (req: Request, res: Response) => {
  try {
    const workspaceId = (req.query.workspaceId as string) || req.body?.workspaceId;
    const userId = (req.query.userId as string) || req.body?.userId;
    const userEmail = (req.query.userEmail as string) || req.body?.userEmail;

    if (!workspaceId || (!userId && !userEmail)) {
      return res.status(400).json({
        error: "workspaceId dan userId atau userEmail wajib diisi",
      });
    }

    const ws = await prisma.workspace.findFirst({
      where: {
        OR: [{ id: workspaceId }, { slug: workspaceId }],
      },
    });
    const targetWsId = ws ? ws.id : workspaceId;

    const queryConditions: any[] = [];
    if (userId) {
      queryConditions.push({ id: userId });
      queryConditions.push({ email: userId });
    }
    if (userEmail) {
      queryConditions.push({ email: userEmail });
      queryConditions.push({ id: userEmail });
    }

    const matchedUsers = await prisma.user.findMany({
      where: { OR: queryConditions },
      select: { id: true, email: true },
    });

    const targetUserIds = Array.from(
      new Set([...(userId ? [userId] : []), ...matchedUsers.map((u) => u.id)])
    );
    const targetEmails = Array.from(
      new Set([
        ...(userEmail ? [userEmail.toLowerCase()] : []),
        ...(userId && userId.includes("@") ? [userId.toLowerCase()] : []),
        ...(matchedUsers.map((u) => u.email?.toLowerCase()).filter(Boolean) as string[]),
      ])
    );

    // 1. Hapus dari WorkspaceMember
    await prisma.workspaceMember.deleteMany({
      where: {
        workspaceId: targetWsId,
        OR: [
          { userId: { in: targetUserIds } },
          ...(targetEmails.length > 0 ? [{ user: { email: { in: targetEmails } } }] : []),
        ],
      },
    });

    // 2. Hapus JoinRequest terkait
    await prisma.joinRequest.deleteMany({
      where: {
        workspaceId: targetWsId,
        OR: [
          { userId: { in: targetUserIds } },
          ...(targetEmails.length > 0 ? [{ userEmail: { in: targetEmails } }] : []),
        ],
      },
    });

    // 3. Batalkan undangan email pending
    if (targetEmails.length > 0) {
      await prisma.workspaceInvitation.deleteMany({
        where: {
          workspaceId: targetWsId,
          email: { in: targetEmails },
        },
      });
    }

    // 4. Unassign task
    const wsProjects = await prisma.project.findMany({
      where: { workspaceId: targetWsId },
      select: { id: true },
    });
    const wsProjectIds = wsProjects.map((p) => p.id);
    if (wsProjectIds.length > 0 && targetUserIds.length > 0) {
      await prisma.task.updateMany({
        where: {
          projectId: { in: wsProjectIds },
          assigneeId: { in: targetUserIds },
        },
        data: {
          assigneeId: null,
        },
      });
    }

    const remaining = await prisma.workspaceMember.findMany({
      where: { workspaceId: targetWsId },
      include: { user: true },
      orderBy: { joinedAt: "asc" },
    });

    const mapped: User[] = remaining.map((m: any) => ({
      id: m.user.id,
      name: m.user.name || "Member",
      email: m.user.email || "",
      avatar: m.user.avatar || m.user.image || "",
      role: m.role as any,
      title: m.role === "ADMIN" ? "Lead / Admin" : "Team Member",
    }));

    return res.json({ success: true, members: mapped });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch("/", async (req: Request, res: Response) => {
  try {
    const { workspaceId, targetUserId, newRole, requesterId } = req.body;

    if (!workspaceId || !targetUserId || !newRole) {
      return res.status(400).json({
        error: "workspaceId, targetUserId, dan newRole wajib disertakan",
      });
    }

    if (requesterId) {
      const ws: any = await (prisma.workspace.findUnique as any)({
        where: { id: workspaceId },
        select: { createdBy: true },
      }).catch(() => null);

      const isCreator = ws?.createdBy === requesterId;

      const requesterMember = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: requesterId,
          },
        },
      });

      if (!isCreator && requesterMember?.role !== "ADMIN") {
        return res.status(403).json({
          error: "Akses ditolak: Hanya Admin yang dapat mengubah role anggota.",
        });
      }
    }

    const updated = await prisma.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: targetUserId,
        },
      },
      data: {
        role: (newRole === "ADMIN" ? "ADMIN" : newRole === "VIEWER" ? "VIEWER" : "MEMBER") as any,
      },
      include: { user: true },
    });

    const mapped: User = {
      id: updated.user.id,
      name: updated.user.name || "Member",
      email: updated.user.email || "",
      avatar: updated.user.avatar || updated.user.image || "",
      role: updated.role as any,
      title: updated.role === "ADMIN" ? "Lead / Admin" : "Team Member",
    };

    return res.json({ success: true, member: mapped });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;

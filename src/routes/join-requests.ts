import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { JoinRequest } from "../types/index.js";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspaceId as string;
    const userId = ((req.query.userId as string) || "").trim();
    const userEmail = ((req.query.userEmail as string) || "").trim().toLowerCase();

    const where: any = {};

    if (userId || userEmail) {
      const orConditions: any[] = [];
      if (userId) orConditions.push({ userId });
      if (userEmail)
        orConditions.push({ userEmail: { equals: userEmail, mode: "insensitive" } });
      where.OR = orConditions;
      if (workspaceId) where.workspaceId = workspaceId;
    } else if (workspaceId) {
      // Cari workspace terkait agar pencarian mencakup ID, slug, dan nama
      const targetWs = await prisma.workspace
        .findFirst({
          where: {
            OR: [{ id: workspaceId.trim() }, { slug: workspaceId.trim() }],
          },
        })
        .catch(() => null);

      const candidateKeys = Array.from(
        new Set(
          [
            workspaceId.trim(),
            targetWs?.id,
            targetWs?.slug,
            targetWs?.name,
          ].filter((k): k is string => Boolean(k && k.trim()))
        )
      );

      where.status = "PENDING";
      where.OR = [
        { workspaceId: { in: candidateKeys } },
        { workspaceName: { in: candidateKeys } },
      ];
    }

    const records = await prisma.joinRequest.findMany({
      where,
      orderBy: { requestedAt: "desc" },
    });

    const mapped: JoinRequest[] = records.map((r) => ({
      id: r.id,
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName,
      userId: r.userId,
      userName: r.userName,
      userEmail: r.userEmail,
      userAvatar: r.userAvatar || "",
      status: r.status as any,
      requestedAt:
        r.requestedAt instanceof Date
          ? r.requestedAt.toISOString()
          : String(r.requestedAt || ""),
    }));

    return res.json(mapped);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body.workspaceId || (!body.userEmail && !body.userId)) {
      return res
        .status(400)
        .json({ error: "workspaceId dan userEmail/userId wajib disertakan" });
    }

    const emailNorm = (body.userEmail || "").trim().toLowerCase();
    const userIdNorm = (body.userId || "").trim();
    const wsTarget = (body.workspaceId || "").trim();

    // Pastikan workspace ID merujuk ke record database yang valid (ID atau slug)
    const targetWs = await prisma.workspace
      .findFirst({
        where: {
          OR: [{ id: wsTarget }, { slug: wsTarget }],
        },
      })
      .catch(() => null);

    const resolvedWsId = targetWs ? targetWs.id : wsTarget;
    const resolvedWsName = targetWs ? targetWs.name : (body.workspaceName || "Workspace");

    // Cek apakah permintaan pending sudah ada di DB
    const existing = await prisma.joinRequest.findFirst({
      where: {
        status: "PENDING",
        OR: [
          { workspaceId: { equals: resolvedWsId, mode: "insensitive" as const } },
          { workspaceId: { equals: wsTarget, mode: "insensitive" as const } },
        ],
        AND: [
          {
            OR: [
              ...(userIdNorm ? [{ userId: userIdNorm }] : []),
              ...(emailNorm
                ? [{ userEmail: { equals: emailNorm, mode: "insensitive" as const } }]
                : []),
            ],
          },
        ],
      },
    });

    if (existing) {
      return res.json({
        id: existing.id,
        workspaceId: existing.workspaceId,
        workspaceName: existing.workspaceName,
        userId: existing.userId,
        userName: existing.userName,
        userEmail: existing.userEmail,
        userAvatar: existing.userAvatar || "",
        status: existing.status,
        requestedAt:
          existing.requestedAt instanceof Date
            ? existing.requestedAt.toISOString()
            : String(existing.requestedAt || ""),
      });
    }

    const newId = body.id || `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const wsName = resolvedWsName;
    const userName = body.userName || (emailNorm ? emailNorm.split("@")[0] : "User");
    const userAvatar = body.userAvatar || "";
    const requestedAt = body.requestedAt ? new Date(body.requestedAt) : new Date();

    const created = await prisma.joinRequest.upsert({
      where: { id: newId },
      update: {
        workspaceId: resolvedWsId,
        workspaceName: wsName,
        userName,
        userAvatar,
        status: "PENDING",
      },
      create: {
        id: newId,
        workspaceId: resolvedWsId,
        workspaceName: wsName,
        userId: userIdNorm || `usr-${Date.now()}`,
        userName,
        userEmail: emailNorm,
        userAvatar,
        status: "PENDING",
        requestedAt,
      },
    });

    const newRequest: JoinRequest = {
      id: created.id,
      workspaceId: created.workspaceId,
      workspaceName: created.workspaceName,
      userId: created.userId,
      userName: created.userName,
      userEmail: created.userEmail,
      userAvatar: created.userAvatar || "",
      requestedAt: created.requestedAt.toISOString(),
      status: "PENDING",
    };

    return res.status(201).json(newRequest);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch("/", async (req: Request, res: Response) => {
  try {
    const { requestId, status } = req.body;

    if (!requestId || !status) {
      return res.status(400).json({ error: "requestId dan status wajib diisi" });
    }

    const targetStatus =
      status === "APPROVED"
        ? "APPROVED"
        : status === "CONSUMED"
        ? "CONSUMED"
        : status === "CANCELLED"
        ? "CANCELLED"
        : "REJECTED";

    const r = await prisma.joinRequest.findUnique({
      where: { id: requestId },
    });

    if (!r) {
      return res.status(404).json({ error: "Permintaan bergabung tidak ditemukan" });
    }

    await prisma.joinRequest.update({
      where: { id: requestId },
      data: { status: targetStatus },
    });

    // Jika di-approve, langsung daftarkan user ke WorkspaceMember di DB
    if (targetStatus === "APPROVED" && r.workspaceId && (r.userId || r.userEmail)) {
      try {
        const existingWs = await prisma.workspace.findFirst({
          where: {
            OR: [{ id: r.workspaceId }, { slug: r.workspaceId }],
          },
        });
        if (!existingWs) {
          return res.status(404).json({
            error: "Workspace tujuan tidak ditemukan atau telah dihapus.",
          });
        }

        let dbUserId = r.userId;
        if (r.userEmail) {
          const dbUser = await prisma.user.upsert({
            where: { email: r.userEmail },
            update: {
              ...(r.userName ? { name: r.userName } : {}),
              ...(r.userAvatar ? { avatar: r.userAvatar } : {}),
            },
            create: {
              id: r.userId || undefined,
              email: r.userEmail,
              name: r.userName || "Member",
              avatar: r.userAvatar,
              role: "MEMBER",
            },
          });
          dbUserId = dbUser.id;
        }

        if (dbUserId) {
          await prisma.workspaceMember.upsert({
            where: {
              workspaceId_userId: {
                workspaceId: existingWs.id,
                userId: dbUserId,
              },
            },
            update: { role: "MEMBER" },
            create: {
              workspaceId: existingWs.id,
              userId: dbUserId,
              role: "MEMBER",
            },
          });
        }
      } catch (err) {
        console.warn("Failed to auto-insert approved member to DB:", err);
      }
    }

    const updatedReq: JoinRequest = {
      id: r.id,
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName,
      userId: r.userId,
      userName: r.userName,
      userEmail: r.userEmail,
      userAvatar: r.userAvatar || "",
      status: targetStatus as any,
      requestedAt:
        r.requestedAt instanceof Date
          ? r.requestedAt.toISOString()
          : String(r.requestedAt || ""),
    };

    return res.json({ success: true, request: updatedReq });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;

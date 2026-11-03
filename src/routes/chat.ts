import { Router, Request, Response } from "express";
import { getChatMessages, sendChatMessage } from "../lib/data-service.js";
import { sendServerPushNotification } from "../lib/server-push.js";

import { prisma } from "../lib/prisma.js";

const router = Router();

// Endpoint untuk mengambil status timestamp baca chat user dari Database
router.get("/read-status", async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || "";
    if (!userId) {
      return res.status(400).json({ error: "userId diperlukan" });
    }

    const records = await prisma.chatReadReceipt.findMany({
      where: {
        userId,
      },
    });

    const readTimestamps: Record<string, number> = {};
    for (const rec of records) {
      readTimestamps[rec.chatKey] = Number(rec.timestamp);
    }

    return res.json({ readTimestamps });
  } catch (error: any) {
    console.error("Error fetching chat read status:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk memperbarui timestamp baca chat user di Database
router.post("/read", async (req: Request, res: Response) => {
  try {
    const { userId, key, timestamp } = req.body;
    if (!userId || !key) {
      return res.status(400).json({ error: "userId dan key diperlukan" });
    }

    const readTime = timestamp ? BigInt(timestamp) : BigInt(Date.now());

    await prisma.chatReadReceipt.upsert({
      where: {
        userId_chatKey: {
          userId,
          chatKey: key,
        },
      },
      create: {
        userId,
        chatKey: key,
        timestamp: readTime,
      },
      update: {
        timestamp: readTime,
      },
    });

    return res.json({ success: true, key, timestamp: Number(readTime) });
  } catch (error: any) {
    console.error("Error updating chat read status:", error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const workspaceId = (req.query.workspaceId as string) || undefined;
    const projectId = (req.query.projectId as string) || undefined;
    const type = (req.query.type as string) || undefined;
    const messages = await getChatMessages(workspaceId, projectId, type);
    return res.json(messages);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body.content || body.content.trim() === "") {
      return res.status(400).json({ error: "Pesan tidak boleh kosong" });
    }
    const type = body.type || (body.projectId ? "PROJECT_CHAT" : "TEAM_DISCUSSION");
    const message = await sendChatMessage(
      body.content,
      body.senderId || "usr-1",
      body.projectId || null,
      body.workspaceId,
      body.id,
      type
    );

    // Kirim Web Push ke semua anggota workspace (pengirim dikecualikan secara otomatis)
    const senderName = message.sender?.name || "Anggota Tim";
    const pushTitle = type === "PROJECT_CHAT" ? "Obrolan Project" : "Diskusi Tim";
    sendServerPushNotification({
      title: pushTitle,
      body: `${senderName}: ${body.content}`,
      url: `/?tab=chat${body.workspaceId ? `&ws=${body.workspaceId}` : ""}${body.projectId ? `&project=${body.projectId}` : ""}`,
      excludeUserId: body.senderId,
      excludeEndpoint: body.endpoint || body.clientEndpoint,
      workspaceId: body.workspaceId,
    }).catch((err) => {
      console.warn("Background web push notification failed in /api/chat:", err);
    });

    return res.status(201).json(message);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;

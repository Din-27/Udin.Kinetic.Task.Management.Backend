import { Router, Request, Response } from "express";
import { QAService } from "../services/rag/qa.service.js";
import { FileIngestionService } from "../services/rag/file-ingestion.service.js";
import { ChatIngestionService } from "../services/rag/chat-ingestion.service.js";
import { RetrievalService } from "../services/rag/retrieval.service.js";
import { prisma } from "../lib/prisma.js";

const router = Router({ mergeParams: true });

async function ensureUserExists(userId: string, userName?: string) {
  if (!userId) return null;
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (existing) return existing;

  return await prisma.user.create({
    data: {
      id: userId,
      name: userName || "User",
      email: `${userId}@task-management.local`,
      role: "MEMBER",
    },
  });
}

function formatSession(session: any) {
  return {
    id: session.id,
    title: session.title,
    taskId: session.taskId || "",
    model: session.model || "gemini-3.6-flash",
    createdAt: session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt,
    updatedAt: session.updatedAt instanceof Date ? session.updatedAt.toISOString() : session.updatedAt,
    messages: (session.messages || []).map((m: any) => ({
      id: m.id,
      sender: m.sender as "user" | "ai",
      text: m.text,
      timestamp: new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      sources: m.sources || undefined,
    })),
  };
}

/**
 * GET /api/rag/sessions
 * Mengambil semua sesi chat user dari database
 */
router.get("/sessions", async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || (req.query.user_id as string);
    if (!userId) {
      return res.status(400).json({ error: "Query parameter 'userId' wajib diisi." });
    }

    const sessions = await prisma.aIAssistantSession.findMany({
      where: { userId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return res.json(sessions.map(formatSession));
  } catch (error: any) {
    console.error("Error in GET /api/rag/sessions:", error);
    return res.status(500).json({ error: error.message || "Gagal mengambil sesi chat." });
  }
});

/**
 * POST /api/rag/sessions
 * Membuat sesi chat baru di database
 */
router.post("/sessions", async (req: Request, res: Response) => {
  try {
    const { id, userId, userName, title, taskId, model, initialMessage } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId wajib diisi." });
    }

    await ensureUserExists(userId, userName);

    let validTaskId: string | null = null;
    if (taskId) {
      const taskObj = await prisma.task.findUnique({ where: { id: taskId } });
      if (taskObj) validTaskId = taskId;
    }

    const newSession = await prisma.aIAssistantSession.create({
      data: {
        ...(id ? { id } : {}),
        userId,
        title: title || "Obrolan Baru",
        taskId: validTaskId,
        model: model || "gemini-3.6-flash",
      },
      include: {
        messages: true,
      },
    });

    if (initialMessage && typeof initialMessage === "object") {
      await prisma.aIAssistantMessage.create({
        data: {
          sessionId: newSession.id,
          sender: initialMessage.sender || "ai",
          text: initialMessage.text || "Halo! Ada yang bisa saya bantu?",
        },
      });
    }

    const created = await prisma.aIAssistantSession.findUnique({
      where: { id: newSession.id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return res.status(201).json(formatSession(created));
  } catch (error: any) {
    console.error("Error in POST /api/rag/sessions:", error);
    return res.status(500).json({ error: error.message || "Gagal membuat sesi chat." });
  }
});

/**
 * PATCH /api/rag/sessions/:id
 * Memperbarui info sesi (title, taskId, model)
 */
router.patch("/sessions/:id", async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    const { title, taskId, model } = req.body;

    const dataToUpdate: any = {};
    if (typeof title === "string") dataToUpdate.title = title;
    if (typeof model === "string") dataToUpdate.model = model;
    if (taskId !== undefined) {
      if (taskId === null || taskId === "") {
        dataToUpdate.taskId = null;
      } else {
        const taskExists = await prisma.task.findUnique({ where: { id: taskId } });
        if (taskExists) {
          dataToUpdate.taskId = taskId;
        }
      }
    }

    const updated = await prisma.aIAssistantSession.update({
      where: { id: sessionId },
      data: dataToUpdate,
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return res.json(formatSession(updated));
  } catch (error: any) {
    console.error("Error in PATCH /api/rag/sessions/:id:", error);
    return res.status(500).json({ error: error.message || "Gagal memperbarui sesi chat." });
  }
});

/**
 * DELETE /api/rag/sessions/:id
 * Menghapus sesi chat beserta semua pesannya (cascade)
 */
router.delete("/sessions/:id", async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;

    await prisma.aIAssistantSession.delete({
      where: { id: sessionId },
    });

    return res.json({ success: true, message: "Sesi berhasil dihapus." });
  } catch (error: any) {
    console.error("Error in DELETE /api/rag/sessions/:id:", error);
    return res.status(500).json({ error: error.message || "Gagal menghapus sesi chat." });
  }
});

/**
 * POST /api/rag/sessions/:id/messages
 * Menambahkan pesan ke sesi chat
 */
router.post("/sessions/:id/messages", async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    const { sender, text, sources } = req.body;

    if (!sender || !text) {
      return res.status(400).json({ error: "sender dan text wajib diisi." });
    }

    const message = await prisma.aIAssistantMessage.create({
      data: {
        sessionId,
        sender,
        text,
        sources: sources || null,
      },
    });

    await prisma.aIAssistantSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });

    return res.status(201).json({
      id: message.id,
      sender: message.sender,
      text: message.text,
      timestamp: new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      sources: message.sources || undefined,
    });
  } catch (error: any) {
    console.error("Error in POST /api/rag/sessions/:id/messages:", error);
    return res.status(500).json({ error: error.message || "Gagal menyimpan pesan chat." });
  }
});

/**
 * POST /api/tasks/:id/ask
 * Endpoint RAG utama: Bertanya ke AI mengenai kartu Kanban berdasarkan konteks file lampiran & chat.
 * Otomatis menyimpan pertanyaan user dan jawaban AI ke database jika sessionId disediakan.
 */
router.post("/:id/ask", async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id;
    const { question, topK, model, sessionId, userId, userName } = req.body;

    if (!question || typeof question !== "string" || question.trim() === "") {
      return res.status(400).json({ error: "Pertanyaan (question) wajib diisi." });
    }

    // Jika ada sessionId, verifikasi dan simpan pertanyaan user
    let sessionRecord = null;
    console.log(sessionId);

    if (sessionId) {
      sessionRecord = await prisma.aIAssistantSession.findUnique({
        where: { id: sessionId },
      });

      if (!sessionRecord && userId) {
        await ensureUserExists(userId, userName);
        let validTaskId: string | null = null;
        if (taskId && taskId !== "undefined" && taskId !== "null") {
          const taskExists = await prisma.task.findUnique({ where: { id: taskId } });
          if (taskExists) validTaskId = taskId;
        }

        sessionRecord = await prisma.aIAssistantSession.create({
          data: {
            id: sessionId,
            userId,
            title: question.trim().length > 32 ? `${question.trim().slice(0, 32)}...` : question.trim(),
            taskId: validTaskId,
            model: typeof model === "string" ? model : "gemini-3.6-flash",
          },
        });
      }

      if (sessionRecord) {
        await prisma.aIAssistantMessage.create({
          data: {
            sessionId: sessionRecord.id,
            sender: "user",
            text: question.trim(),
          },
        });

        if (taskId && taskId !== "undefined" && taskId !== sessionRecord.taskId) {
          const taskExists = await prisma.task.findUnique({ where: { id: taskId } });
          if (taskExists) {
            await prisma.aIAssistantSession.update({
              where: { id: sessionRecord.id },
              data: { taskId },
            });
          }
        }
      }
    }

    const result = await QAService.answerTaskQuestion(
      taskId,
      question.trim(),
      topK ? parseInt(topK, 10) : 5,
      typeof model === "string" ? model : undefined
    );

    // Simpan pesan balasan AI ke database
    if (sessionRecord) {
      const aiMessage = await prisma.aIAssistantMessage.create({
        data: {
          sessionId: sessionRecord.id,
          sender: "ai",
          text: result.answer,
          sources: (result.sources as any) || [],
        },
      });

      await prisma.aIAssistantSession.update({
        where: { id: sessionRecord.id },
        data: { updatedAt: new Date() },
      });

      return res.json({
        ...result,
        sessionId: sessionRecord.id,
        savedToDb: true,
        aiMessageId: aiMessage.id,
      });
    }

    return res.json(result);
  } catch (error: any) {
    console.error("Error in POST /api/tasks/:id/ask:", error);
    return res.status(500).json({ error: error.message || "Gagal memproses pertanyaan RAG." });
  }
});


/**
 * POST /api/tasks/:id/ingest-file
 * Memicu pipeline ingestion file dokumen S3 ke pgvector secara asynchronous.
 */
router.post("/:id/ingest-file", async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id;
    const { s3Key, filename, mimetype, boardId } = req.body;

    if (!filename) {
      return res.status(400).json({ error: "filename wajib disertakan." });
    }

    let targetBoardId = boardId;
    if (!targetBoardId) {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { projectId: true },
      });
      targetBoardId = task?.projectId || "default-board";
    }

    const result = await FileIngestionService.ingestFile({
      taskId,
      boardId: targetBoardId,
      s3Key,
      filename,
      mimetype,
    });

    return res.status(201).json({
      success: true,
      message: `File "${filename}" berhasil diindeks ke pgvector.`,
      data: result,
    });
  } catch (error: any) {
    console.error("Error in POST /api/tasks/:id/ingest-file:", error);
    return res.status(500).json({ error: error.message || "Gagal mengindeks file dokumen." });
  }
});

/**
 * POST /api/tasks/:id/ingest-chat
 * Mengindeks riwayat chat thread kartu ke pgvector menggunakan sliding window.
 */
router.post("/:id/ingest-chat", async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id;
    const { batchSize } = req.body;

    // Ambil komentar task langsung dari database
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        comments: {
          include: {
            user: { select: { name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!task) {
      return res.status(404).json({ error: "Task tidak ditemukan." });
    }

    const messages = task.comments.map((c) => ({
      id: c.id,
      senderName: c.user?.name || "Member",
      content: c.content,
      createdAt: c.createdAt,
    }));

    if (messages.length === 0) {
      return res.json({
        success: true,
        message: "Tidak ada komentar chat untuk diindeks.",
        batchesIndexed: 0,
      });
    }

    const result = await ChatIngestionService.ingestChatThread({
      taskId,
      boardId: task.projectId,
      messages,
      batchSize: batchSize || 12,
    });

    return res.status(201).json({
      success: true,
      message: `Berhasil mengindeks ${result.batchesIndexed} batch chat dari total ${result.totalMessages} pesan.`,
      data: result,
    });
  } catch (error: any) {
    console.error("Error in POST /api/tasks/:id/ingest-chat:", error);
    return res.status(500).json({ error: error.message || "Gagal mengindeks chat thread." });
  }
});

/**
 * GET /api/tasks/:id/search
 * Endpoint pengujian retrieval semantik untuk melihat potongan chunk terdekat.
 */
router.get("/:id/search", async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id;
    const query = (req.query.q as string) || "";
    const topK = req.query.topK ? parseInt(req.query.topK as string, 10) : 5;

    if (!query) {
      return res.status(400).json({ error: "Query parameter 'q' wajib diisi." });
    }

    const results = await RetrievalService.retrieveContext({
      taskId,
      queryText: query,
      topK,
    });

    return res.json({ query, totalResults: results.length, results });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;

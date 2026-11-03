import { prisma } from "../lib/prisma.js";

export interface WhiteboardElement {
  id: string;
  type: "sticky" | "rect" | "circle" | "diamond" | "text" | "arrow" | "freehand";
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string;
  color?: string;
  textColor?: string;
  points?: Array<{ x: number; y: number }>;
  fontSize?: number;
  strokeWidth?: number;
  createdBy?: string;
  creatorName?: string;
  updatedAt?: string;
}

export interface WhiteboardComment {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  userColor?: string;
  text: string;
  createdAt: string;
  elementId?: string;
  elementLabel?: string;
}

export interface WhiteboardData {
  id: string;
  workspaceId: string;
  title: string;
  description?: string;
  elements: WhiteboardElement[];
  comments: WhiteboardComment[];
  createdAt: string;
  updatedAt: string;
  userId?: string;
  creatorName?: string;
}

export class WhiteboardService {
  /**
   * Mengambil semua whiteboard dalam suatu workspace
   */
  static async getWhiteboards(workspaceId: string = "default", userId?: string): Promise<WhiteboardData[]> {
    const records = await prisma.whiteboard.findMany({
      where: {
        workspaceId,
        ...(userId ? { OR: [{ userId }, { userId: null }] } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });

    return records.map((rec) => ({
      id: rec.id,
      workspaceId: rec.workspaceId,
      userId: rec.userId || undefined,
      creatorName: rec.creatorName || undefined,
      title: rec.title,
      description: rec.description || "",
      elements: (rec.elements as any) || [],
      comments: (rec.comments as any) || [],
      createdAt: rec.createdAt.toISOString(),
      updatedAt: rec.updatedAt.toISOString(),
    }));
  }

  /**
   * Mengambil satu whiteboard berdasarkan ID
   */
  static async getWhiteboardById(id: string): Promise<WhiteboardData | null> {
    let rec = await prisma.whiteboard.findUnique({
      where: { id },
    });

    if (!rec) {
      rec = await prisma.whiteboard.findFirst({
        where: { id: { contains: id } },
      });
    }

    if (!rec) return null;

    return {
      id: rec.id,
      workspaceId: rec.workspaceId,
      userId: rec.userId || undefined,
      creatorName: rec.creatorName || undefined,
      title: rec.title,
      description: rec.description || "",
      elements: (rec.elements as any) || [],
      comments: (rec.comments as any) || [],
      createdAt: rec.createdAt.toISOString(),
      updatedAt: rec.updatedAt.toISOString(),
    };
  }

  /**
   * Menyimpan / memperbarui whiteboard dengan validasi ID unik
   */
  static async saveWhiteboard(data: {
    id?: string;
    workspaceId?: string;
    userId?: string;
    creatorName?: string;
    title?: string;
    description?: string;
    elements?: WhiteboardElement[];
    comments?: WhiteboardComment[];
  }): Promise<WhiteboardData> {
    const rawId = data.id ? String(data.id).trim() : "";
    const isForbiddenDefault =
      !rawId ||
      rawId === "default" ||
      rawId === "wb-main" ||
      rawId === "wb-default" ||
      rawId.endsWith("-default");

    const id = !isForbiddenDefault
      ? rawId
      : `wb-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const workspaceId = data.workspaceId || "default";
    const userId = data.userId || undefined;
    const creatorName = data.creatorName || undefined;

    const existing = await prisma.whiteboard.findUnique({ where: { id } });
    if (existing && existing.userId && userId && existing.userId !== userId) {
      throw new Error("FORBIDDEN_USER");
    }

    const saved = await prisma.whiteboard.upsert({
      where: { id },
      create: {
        id,
        workspaceId,
        userId: userId || undefined,
        creatorName: creatorName || undefined,
        title: data.title || "Papan Tulis Kolaboratif",
        description: data.description || "",
        elements: Array.isArray(data.elements) ? (data.elements as any) : [],
        comments: Array.isArray(data.comments) ? (data.comments as any) : [],
      },
      update: {
        workspaceId,
        userId: userId || existing?.userId,
        creatorName: creatorName || existing?.creatorName,
        title: data.title || "Papan Tulis Kolaboratif",
        description: data.description || "",
        elements: Array.isArray(data.elements) ? (data.elements as any) : [],
        comments: Array.isArray(data.comments) ? (data.comments as any) : (existing?.comments as any) || [],
      },
    });

    return {
      id: saved.id,
      workspaceId: saved.workspaceId,
      userId: saved.userId || undefined,
      creatorName: saved.creatorName || undefined,
      title: saved.title,
      description: saved.description || "",
      elements: saved.elements as any,
      comments: saved.comments as any,
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  /**
   * Menambahkan komentar ke whiteboard
   */
  static async addComment(
    id: string,
    commentPayload: {
      id?: string;
      userId?: string;
      userName?: string;
      userAvatar?: string;
      userColor?: string;
      text?: string;
      createdAt?: string;
      elementId?: string;
      elementLabel?: string;
    }
  ): Promise<WhiteboardComment> {
    let rec = await prisma.whiteboard.findUnique({ where: { id } });
    if (!rec) {
      rec = await prisma.whiteboard.findFirst({
        where: { id: { contains: id } },
      });
    }

    if (!rec) {
      throw new Error("NOT_FOUND");
    }

    const comments: WhiteboardComment[] = Array.isArray(rec.comments) ? (rec.comments as any) : [];
    const newComment: WhiteboardComment = {
      id: commentPayload.id || `comment-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      userId: commentPayload.userId || "anonymous",
      userName: commentPayload.userName || "User",
      userAvatar: commentPayload.userAvatar,
      userColor: commentPayload.userColor || "#6366f1",
      text: commentPayload.text || "",
      createdAt: commentPayload.createdAt || new Date().toISOString(),
      elementId: commentPayload.elementId,
      elementLabel: commentPayload.elementLabel,
    };

    comments.push(newComment);

    await prisma.whiteboard.update({
      where: { id: rec.id },
      data: { comments: comments as any },
    });

    return newComment;
  }

  /**
   * Menghapus whiteboard
   */
  static async deleteWhiteboard(id: string, userId?: string): Promise<boolean> {
    const existing = await prisma.whiteboard.findUnique({ where: { id } });
    if (existing) {
      if (existing.userId && userId && existing.userId !== userId) {
        throw new Error("FORBIDDEN_USER");
      }
      await prisma.whiteboard.delete({ where: { id } });
      return true;
    }
    return false;
  }
}

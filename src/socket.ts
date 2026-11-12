import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { prisma } from "./lib/prisma.js";

let ioInstance: SocketIOServer | null = null;

export function setupSocketIO(httpServer: HttpServer, corsOrigin: string = "*"): SocketIOServer {
  const allowedOrigins =
    corsOrigin === "*"
      ? true
      : Array.from(
        new Set([
          ...corsOrigin.split(",").map((s) => s.trim()),
          "http://localhost:3000",
        ])
      );

  const io = new SocketIOServer(httpServer, {
    path: "/api/socket/io",
    addTrailingSlash: false,
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  ioInstance = io;

  io.on("connection", (socket) => {
    console.log(`[Socket.IO] Client terhubung: ${socket.id}`);

    // Client joins a workspace room
    socket.on("join-workspace", (workspaceId: string) => {
      if (workspaceId) {
        const room = `ws:${workspaceId}`;
        socket.join(room);
        console.log(`[Socket.IO] Socket ${socket.id} bergabung ke room: ${room}`);
      }
    });

    // Client leaves a workspace room
    socket.on("leave-workspace", (workspaceId: string) => {
      if (workspaceId) {
        socket.leave(`ws:${workspaceId}`);
      }
    });

    // Client joins a task discussion/comments room
    socket.on("join-task", (taskId: string) => {
      if (taskId) {
        const room = `task:${taskId}`;
        socket.join(room);
        console.log(`[Socket.IO] Socket ${socket.id} bergabung ke room: ${room}`);
      }
    });

    // Client leaves a task room
    socket.on("leave-task", (taskId: string) => {
      if (taskId) {
        socket.leave(`task:${taskId}`);
      }
    });

    // Client sends a new comment via Socket
    socket.on("new-comment", (payload: { taskId: string; workspaceId?: string; comment: any; taskTitle?: string }) => {
      if (payload?.taskId && payload?.comment) {
        if (payload.workspaceId) {
          socket.to(`ws:${payload.workspaceId}`).emit("comment-received", payload);
        } else {
          socket.to(`task:${payload.taskId}`).emit("comment-received", payload);
        }
      }
    });

    // Client sends a new chat/discussion message via Socket
    socket.on("new-chat-message", (payload: { workspaceId?: string; projectId?: string | null; message: any }) => {
      if (payload?.message && payload?.workspaceId) {
        socket.to(`ws:${payload.workspaceId}`).emit("chat-message-received", payload);
      }
    });

    // User typing indicators
    socket.on("typing", (payload: { roomId: string; user: { id: string; name: string } }) => {
      socket.to(payload.roomId).emit("user-typing", payload);
    });

    socket.on("stop-typing", (payload: { roomId: string; user: { id: string; name: string } }) => {
      socket.to(payload.roomId).emit("user-stop-typing", payload);
    });

    // User mention notification broadcast
    socket.on("user-mentioned", (payload: {
      workspaceId: string;
      targetUserId: string;
      senderName: string;
      source: "comment" | "chat";
      title: string;
      preview: string;
      taskId?: string;
    }) => {
      if (payload?.workspaceId && payload?.targetUserId) {
        socket.to(`ws:${payload.workspaceId}`).emit("user-mentioned-received", payload);
      }
    });

    // ============================================
    // Realtime Collaborative Flowchart (Figma Style)
    // ============================================

    // Client joins a flowchart room
    socket.on("join-flowchart", (payload: { diagramId: string; user?: { id: string; name: string; color?: string } }) => {
      if (payload?.diagramId) {
        const room = `flowchart:${payload.diagramId}`;
        socket.join(room);
        if (payload.user) {
          socket.to(room).emit("flowchart-user-joined", {
            diagramId: payload.diagramId,
            user: payload.user,
            socketId: socket.id,
          });
        }
      }
    });

    // Client leaves a flowchart room
    socket.on("leave-flowchart", (payload: { diagramId: string; userId?: string }) => {
      if (payload?.diagramId) {
        const room = `flowchart:${payload.diagramId}`;
        socket.leave(room);
        socket.to(room).emit("flowchart-user-left", {
          diagramId: payload.diagramId,
          userId: payload.userId,
          socketId: socket.id,
        });
      }
    });

    // Realtime Cursor Move (Figma multiplayer cursor)
    socket.on("flowchart-cursor-move", (payload: {
      diagramId: string;
      userId: string;
      userName: string;
      userColor?: string;
      x: number;
      y: number;
    }) => {
      if (payload?.diagramId) {
        const room = `flowchart:${payload.diagramId}`;
        socket.to(room).emit("flowchart-cursor-updated", {
          ...payload,
          socketId: socket.id,
        });
      }
    });

    // Realtime Live Changes (Drag shape, edit shape, add/delete nodes & edges)
    socket.on("flowchart-change", (payload: {
      diagramId: string;
      nodes: any[];
      edges: any[];
      senderId: string;
    }) => {
      if (payload?.diagramId) {
        const room = `flowchart:${payload.diagramId}`;
        socket.to(room).emit("flowchart-synced", payload);
      }
    });

    // Realtime Live Typing Indicator (ketikan langsung ala Figma)
    socket.on("flowchart-typing", (payload: {
      diagramId: string;
      userId: string;
      userName: string;
      text: string;
      nodeId?: string;
    }) => {
      if (payload?.diagramId) {
        const room = `flowchart:${payload.diagramId}`;
        socket.to(room).emit("flowchart-typing-updated", payload);
      }
    });

    socket.on("flowchart-stop-typing", (payload: { diagramId: string; userId: string }) => {
      if (payload?.diagramId) {
        const room = `flowchart:${payload.diagramId}`;
        socket.to(room).emit("flowchart-typing-stopped", payload);
      }
    });

    // Realtime Comments & Questions on Flowchart
    socket.on("flowchart-new-comment", async (payload: {
      diagramId: string;
      comment: {
        id: string;
        userId: string;
        userName: string;
        userAvatar?: string;
        text: string;
        createdAt: string;
        nodeId?: string;
        nodeLabel?: string;
      };
    }) => {
      if (payload?.diagramId && payload?.comment) {
        const room = `flowchart:${payload.diagramId}`;
        io.to(room).emit("flowchart-comment-received", payload);

        // Otomatis simpan ke tabel Flowchart secara transaksional
        try {
          await prisma.$transaction(async (tx) => {
            const rec = await tx.flowchart.findFirst({
              where: { id: payload.diagramId },
            });
            if (rec) {
              const comments: any[] = Array.isArray(rec.comments) ? (rec.comments as any) : [];
              comments.push(payload.comment);
              await tx.flowchart.update({
                where: { id: rec.id },
                data: { comments: comments as any },
              });
            }
          });
        } catch (e) {
          console.error("[Socket.IO] Gagal menyimpan komentar flowchart:", e);
        }
      }
    });

    // ==========================================
    // 🎨 WHITEBOARD COLLABORATIVE (Papan Tulis Streaming)
    // ==========================================

    socket.on("join-whiteboard", (payload: {
      whiteboardId: string;
      userId: string;
      userName: string;
      userAvatar?: string;
      userColor?: string;
    }) => {
      if (payload?.whiteboardId) {
        const room = `whiteboard:${payload.whiteboardId}`;
        socket.join(room);
        console.log(`[Socket.IO] User ${payload.userName} (${payload.userId}) join ${room}`);
        socket.to(room).emit("whiteboard-user-joined", {
          ...payload,
          socketId: socket.id,
        });
      }
    });

    socket.on("leave-whiteboard", (payload: { whiteboardId: string; userId: string }) => {
      if (payload?.whiteboardId) {
        const room = `whiteboard:${payload.whiteboardId}`;
        socket.leave(room);
        socket.to(room).emit("whiteboard-user-left", {
          ...payload,
          socketId: socket.id,
        });
      }
    });

    // Live Figma-Style Multiplayer Cursor Streaming
    socket.on("whiteboard-cursor-move", (payload: {
      whiteboardId: string;
      userId: string;
      userName: string;
      userColor: string;
      x: number;
      y: number;
    }) => {
      if (payload?.whiteboardId) {
        const room = `whiteboard:${payload.whiteboardId}`;
        socket.to(room).emit("whiteboard-cursor-updated", {
          ...payload,
          socketId: socket.id,
        });
      }
    });

    // Live Canvas Sync (Move shape, resize, add, update, delete)
    socket.on("whiteboard-change", (payload: {
      whiteboardId: string;
      elements: any[];
      senderId: string;
    }) => {
      if (payload?.whiteboardId) {
        const room = `whiteboard:${payload.whiteboardId}`;
        socket.to(room).emit("whiteboard-synced", payload);
      }
    });

    // Live Streaming Typing Indicator (Ketikan langsung bergerak)
    socket.on("whiteboard-typing", (payload: {
      whiteboardId: string;
      userId: string;
      userName: string;
      userColor: string;
      elementId?: string;
      text: string;
      x?: number;
      y?: number;
    }) => {
      if (payload?.whiteboardId) {
        const room = `whiteboard:${payload.whiteboardId}`;
        socket.to(room).emit("whiteboard-typing-updated", payload);
      }
    });

    socket.on("whiteboard-stop-typing", (payload: {
      whiteboardId: string;
      userId: string;
      elementId?: string;
    }) => {
      if (payload?.whiteboardId) {
        const room = `whiteboard:${payload.whiteboardId}`;
        socket.to(room).emit("whiteboard-typing-stopped", payload);
      }
    });

    // Live Comments & Questions on Whiteboard
    socket.on("whiteboard-new-comment", async (payload: {
      whiteboardId: string;
      comment: {
        id: string;
        userId: string;
        userName: string;
        userAvatar?: string;
        userColor?: string;
        text: string;
        createdAt: string;
        elementId?: string;
        elementLabel?: string;
      };
    }) => {
      if (payload?.whiteboardId && payload?.comment) {
        const room = `whiteboard:${payload.whiteboardId}`;
        io.to(room).emit("whiteboard-comment-received", payload);

        // Otomatis simpan ke tabel Whiteboard secara transaksional
        try {
          await prisma.$transaction(async (tx) => {
            const rec = await tx.whiteboard.findFirst({
              where: { id: payload.whiteboardId },
            });
            if (rec) {
              const comments: any[] = Array.isArray(rec.comments) ? (rec.comments as any) : [];
              comments.push(payload.comment);
              await tx.whiteboard.update({
                where: { id: rec.id },
                data: { comments: comments as any },
              });
            }
          });
        } catch (e) {
          console.error("[Socket.IO] Gagal menyimpan komentar whiteboard:", e);
        }
      }
    });

    socket.on("disconnect", () => {
      console.log(`[Socket.IO] Client terputus: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): SocketIOServer | null {
  return ioInstance;
}

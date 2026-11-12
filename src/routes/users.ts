import { Router, Request, Response } from "express";
import { getUsers } from "../lib/data-service.js";
import { prisma } from "../lib/prisma.js";
import { authenticateRequest } from "./auth.js";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const users = await getUsers();
    return res.json(users);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete("/", async (req: Request, res: Response) => {
  try {
    const authUser = await authenticateRequest(req);
    const userId =
      (req.query.id as string) ||
      (req.query.userId as string) ||
      req.body?.id ||
      req.body?.userId;

    if (!userId) {
      return res.status(400).json({ error: "userId wajib disertakan" });
    }

    if (authUser && authUser.id !== userId && authUser.role !== "ADMIN") {
      return res.status(403).json({ error: "Tidak memiliki hak akses untuk menghapus pengguna ini" });
    }

    await prisma.account.deleteMany({ where: { userId } }).catch(() => { });
    await prisma.session.deleteMany({ where: { userId } }).catch(() => { });
    await prisma.workspaceMember.deleteMany({ where: { userId } }).catch(() => { });
    await prisma.taskComment.deleteMany({ where: { userId } }).catch(() => { });
    await prisma.activityLog.deleteMany({ where: { userId } }).catch(() => { });
    await prisma.chatMessage.deleteMany({ where: { senderId: userId } }).catch(() => { });
    await prisma.task.updateMany({ where: { assigneeId: userId }, data: { assigneeId: null } }).catch(() => { });

    // Reassign createdTasks if another user exists, or delete them
    const otherUser = await prisma.user.findFirst({ where: { id: { not: userId } } });
    if (otherUser) {
      await prisma.task.updateMany({ where: { creatorId: userId }, data: { creatorId: otherUser.id } }).catch(() => { });
    } else {
      await prisma.subtask.deleteMany({ where: { task: { creatorId: userId } } }).catch(() => { });
      await prisma.taskComment.deleteMany({ where: { task: { creatorId: userId } } }).catch(() => { });
      await prisma.activityLog.deleteMany({ where: { task: { creatorId: userId } } }).catch(() => { });
      await prisma.task.deleteMany({ where: { creatorId: userId } }).catch(() => { });
    }

    await prisma.user.delete({ where: { id: userId } });
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;

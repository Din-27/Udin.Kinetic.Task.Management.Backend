import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

const DEFAULT_BOARD_COLUMNS = [
  { id: "BACKLOG", title: "Backlog", color: "#64748b" },
  { id: "TODO", title: "To Do", color: "#0ea5e9" },
  { id: "IN_PROGRESS", title: "In Progress", color: "#eab308" },
  { id: "IN_REVIEW", title: "In Review", color: "#a855f7" },
  { id: "DONE", title: "Done", color: "#22c55e" },
];

router.get("/", async (req: Request, res: Response) => {
  try {
    const workspaceId = (req.query.workspaceId as string) || "default";

    const records: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "BoardColumn" WHERE "workspaceId" = $1 ORDER BY "order" ASC, "createdAt" ASC`,
      workspaceId
    );

    if (records.length > 0) {
      const mapped = records.map((r) => ({
        id: r.status,
        title: r.label,
        color: r.color,
      }));
      return res.json(mapped);
    }

    return res.json(DEFAULT_BOARD_COLUMNS);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { workspaceId, columns } = req.body;

    if (!workspaceId || !Array.isArray(columns)) {
      return res.status(400).json({ error: "workspaceId dan columns array wajib disertakan" });
    }

    // Hapus kolom lama untuk workspace ini lalu insert urutan baru
    const data = await prisma.$executeRawUnsafe(
      `select * FROM "BoardColumn" WHERE "workspaceId" = $1`,
      workspaceId
    );

    if (data) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "BoardColumn" WHERE "workspaceId" = $1`,
        workspaceId
      );
    }

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const status = col.id || `COL_${i}`;
      const label = col.title || col.label || status;
      const color = col.color || "#6366f1";
      const id = `col-${workspaceId}-${status}`;

      await prisma.$executeRawUnsafe(
        `INSERT INTO "BoardColumn" ("id", "workspaceId", "status", "label", "color", "order", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        id,
        workspaceId,
        status,
        label,
        color,
        i
      );
    }

    return res.json({ success: true, columns });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;

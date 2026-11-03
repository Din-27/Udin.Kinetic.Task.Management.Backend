import { prisma } from "../../lib/prisma.js";
import { TaskEmbeddingRecord, RetrievalOptions, RetrievalResult } from "./types.js";

export class VectorStoreService {
  /**
   * Menyimpan batch record embedding ke tabel Neon PostgreSQL.
   */
  public static async insertBatch(records: TaskEmbeddingRecord[]): Promise<void> {
    if (!records || records.length === 0) return;

    for (const record of records) {
      const vectorStr = `[${record.embedding.join(",")}]`;
      const metadataStr = JSON.stringify(record.metadata || {});

      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "TaskDocumentEmbeddings" (
          task_id,
          board_id,
          source_type,
          source_id,
          content,
          embedding,
          metadata
        ) VALUES (
          $1,
          $2,
          $3::embedding_source_type,
          $4,
          $5,
          $6::vector,
          $7::jsonb
        )
        `,
        record.taskId,
        record.boardId,
        record.sourceType,
        record.sourceId,
        record.content,
        vectorStr,
        metadataStr
      );
    }
  }

  /**
   * Menghapus embedding berdasarkan source_id (misal: saat file dihapus/di-reindex).
   */
  public static async deleteBySourceId(sourceId: string): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "TaskDocumentEmbeddings" WHERE source_id = $1`,
      sourceId
    );
  }

  /**
   * Menghapus seluruh embedding yang terikat pada sebuah task.
   */
  public static async deleteByTaskId(taskId: string): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "TaskDocumentEmbeddings" WHERE task_id = $1`,
      taskId
    );
  }

  /**
   * Melakukan query pencarian semantik terisolasi berbasis cosine similarity.
   */
  public static async searchSimilar(
    queryEmbedding: number[],
    options: RetrievalOptions
  ): Promise<RetrievalResult[]> {
    const topK = options.topK || 5;
    const minSimilarity = options.minSimilarity || 0.4;
    const vectorStr = `[${queryEmbedding.join(",")}]`;

    // Filter terisolasi: Wajib task_id atau board_id
    const conditions: string[] = [];
    const params: any[] = [vectorStr];

    if (options.taskId) {
      params.push(options.taskId);
      conditions.push(`task_id = $${params.length}`);
    } else if (options.boardId) {
      params.push(options.boardId);
      conditions.push(`board_id = $${params.length}`);
    }

    if (options.sourceType) {
      params.push(options.sourceType);
      conditions.push(`source_type = $${params.length}::embedding_source_type`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(topK);
    const limitParamIndex = params.length;

    const sql = `
      SELECT 
        id,
        task_id AS "taskId",
        board_id AS "boardId",
        source_type AS "sourceType",
        source_id AS "sourceId",
        content,
        metadata,
        1 - (embedding <=> $1::vector) AS similarity
      FROM "TaskDocumentEmbeddings"
      ${whereClause}
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $${limitParamIndex};
    `;

    try {
      const rows = (await prisma.$queryRawUnsafe(sql, ...params)) as any[];

      return rows
        .map((r) => ({
          id: r.id,
          taskId: r.taskId,
          boardId: r.boardId,
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          content: r.content,
          metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata,
          similarity: parseFloat(r.similarity),
        }))
        .filter((r) => r.similarity >= minSimilarity);
    } catch (err) {
      console.error("VectorStoreService.searchSimilar query error:", err);
      return [];
    }
  }
}

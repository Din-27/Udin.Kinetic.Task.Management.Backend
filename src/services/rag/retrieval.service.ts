import { EmbeddingService } from "./embedding.service.js";
import { VectorStoreService } from "./vector-store.service.js";
import { RetrievalOptions, RetrievalResult } from "./types.js";

export class RetrievalService {
  /**
   * Menjalankan semantic vector retrieval terisolasi pada kartu (task) atau board.
   */
  public static async retrieveContext(options: RetrievalOptions): Promise<RetrievalResult[]> {
    const { queryText } = options;

    if (!queryText || queryText.trim().length === 0) {
      return [];
    }

    // 1. Generate vector embedding dari pertanyaan pengguna
    const queryEmbedding = await EmbeddingService.generateEmbedding(queryText);

    // 2. Eksekusi query cosine similarity terisolasi di database Neon pgvector
    const results = await VectorStoreService.searchSimilar(queryEmbedding, {
      taskId: options.taskId,
      boardId: options.boardId,
      queryText: options.queryText,
      topK: options.topK || 5,
      minSimilarity: options.minSimilarity || 0.35,
      sourceType: options.sourceType,
    });

    return results;
  }
}

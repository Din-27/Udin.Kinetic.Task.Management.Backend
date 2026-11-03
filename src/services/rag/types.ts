export type EmbeddingSourceType = "FILE" | "CHAT";

export interface DocumentChunk {
  content: string;
  metadata: Record<string, any>;
  index: number;
}

export interface TaskEmbeddingRecord {
  id?: string;
  taskId: string;
  boardId: string;
  sourceType: EmbeddingSourceType;
  sourceId: string;
  content: string;
  embedding: number[];
  metadata: Record<string, any>;
  createdAt?: Date;
}

export interface RetrievalOptions {
  taskId: string;
  boardId?: string;
  queryText: string;
  topK?: number;
  minSimilarity?: number;
  sourceType?: EmbeddingSourceType;
}

export interface RetrievalResult {
  id: string;
  taskId: string;
  boardId: string;
  sourceType: EmbeddingSourceType;
  sourceId: string;
  content: string;
  metadata: Record<string, any>;
  similarity: number;
}

export interface RAGAnswerResponse {
  answer: string;
  sources: Array<{
    sourceType: EmbeddingSourceType;
    sourceId: string;
    snippet: string;
    metadata: Record<string, any>;
    similarity: number;
  }>;
  taskId: string;
  model?: string;
}

export interface ChatMessageItem {
  id: string;
  senderName: string;
  content: string;
  createdAt: string | Date;
}

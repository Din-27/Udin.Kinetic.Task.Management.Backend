import { EmbeddingService } from "./embedding.service.js";
import { VectorStoreService } from "./vector-store.service.js";
import { ChatMessageItem, TaskEmbeddingRecord } from "./types.js";

export interface ChatIngestionInput {
  taskId: string;
  boardId: string;
  messages: ChatMessageItem[];
  batchSize?: number; // Jumlah pesan per window (default: 12)
}

export class ChatIngestionService {
  /**
   * Menggabungkan rentetan pesan chat dengan format:
   * [Sender Name - Timestamp]: [Message Content]
   * lalu mengindeksnya ke dalam pgvector dengan source_type = 'CHAT'.
   */
  public static async ingestChatThread(input: ChatIngestionInput): Promise<{
    batchesIndexed: number;
    totalMessages: number;
  }> {
    const { taskId, boardId, messages } = input;
    const batchSize = input.batchSize || 12;

    if (!messages || messages.length === 0) {
      return { batchesIndexed: 0, totalMessages: 0 };
    }

    // Urutkan pesan berdasarkan waktu
    const sorted = [...messages].sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      return timeA - timeB;
    });

    const textWindows: string[] = [];
    const windowMetadatas: Record<string, any>[] = [];

    // Lakukan windowing / batching tiap N pesan (misal 10-15 pesan)
    for (let i = 0; i < sorted.length; i += batchSize) {
      const slice = sorted.slice(i, i + batchSize);
      if (slice.length === 0) continue;

      const formattedLines = slice.map((msg) => {
        const timeStr = new Date(msg.createdAt).toISOString().replace("T", " ").slice(0, 19);
        const cleanContent = msg.content.replace(/\s+/g, " ").trim();
        return `[${msg.senderName} - ${timeStr}]: ${cleanContent}`;
      });

      const windowText = formattedLines.join("\n");
      const firstMsg = slice[0];
      const lastMsg = slice[slice.length - 1];

      textWindows.push(windowText);
      windowMetadatas.push({
        sourceType: "CHAT",
        messageCount: slice.length,
        startDate: firstMsg.createdAt,
        endDate: lastMsg.createdAt,
        senderNames: Array.from(new Set(slice.map((m) => m.senderName))),
        batchIndex: Math.floor(i / batchSize),
      });
    }

    if (textWindows.length === 0) {
      return { batchesIndexed: 0, totalMessages: sorted.length };
    }

    // Generate batch embedding untuk seluruh window
    const embeddings = await EmbeddingService.generateBatchEmbeddings(textWindows);

    // Format TaskEmbeddingRecords
    const records: TaskEmbeddingRecord[] = textWindows.map((text, idx) => {
      const batchId = `chat-batch-${taskId}-${windowMetadatas[idx].batchIndex}`;
      return {
        taskId,
        boardId,
        sourceType: "CHAT",
        sourceId: batchId,
        content: text,
        embedding: embeddings[idx],
        metadata: windowMetadatas[idx],
      };
    });

    // Simpan ke pgvector store
    await VectorStoreService.insertBatch(records);

    console.log(
      `[RAG Chat Ingestion] Berhasil mengindeks ${records.length} batch chat (${sorted.length} pesan) untuk task ${taskId}`
    );

    return {
      batchesIndexed: records.length,
      totalMessages: sorted.length,
    };
  }
}

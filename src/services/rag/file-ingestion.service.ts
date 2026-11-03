import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { FileParserService } from "./file-parser.service.js";
import { ChunkingService } from "./chunking.service.js";
import { EmbeddingService } from "./embedding.service.js";
import { VectorStoreService } from "./vector-store.service.js";
import { TaskEmbeddingRecord } from "./types.js";

export interface FileIngestionInput {
  taskId: string;
  boardId: string;
  s3Key?: string;
  fileBuffer?: Buffer;
  filename: string;
  mimetype?: string;
}

export class FileIngestionService {
  /**
   * Helper untuk mengunduh stream file S3 menjadi buffer.
   */
  private static async streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on("error", (err) => reject(err));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  }

  /**
   * Ingestion pipeline untuk file dokumen (PDF/DOCX/TXT/MD) dari S3 ke pgvector.
   */
  public static async ingestFile(input: FileIngestionInput): Promise<{
    chunksCount: number;
    charCount: number;
    sourceId: string;
  }> {
    let buffer = input.fileBuffer;
    const sourceId = input.s3Key || `file-${Date.now()}-${input.filename}`;

    // 1. Download dari AWS S3 jika hanya s3Key yang disediakan
    if (!buffer && input.s3Key) {
      const region = process.env.AWS_REGION || "us-east-2";
      const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || "default";
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      const endpoint = process.env.AWS_ENDPOINT_URL_S3 || process.env.AWS_ENDPOINT;

      if (!accessKeyId || !secretAccessKey) {
        throw new Error("Kredensial AWS S3 tidak dikonfigurasi untuk mengunduh file lampiran.");
      }

      const s3Client = new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      });

      const getCmd = new GetObjectCommand({
        Bucket: bucket,
        Key: input.s3Key,
      });

      const s3Response = await s3Client.send(getCmd);
      if (!s3Response.Body) {
        throw new Error(`File S3 kosong atau tidak ditemukan: ${input.s3Key}`);
      }

      buffer = await this.streamToBuffer(s3Response.Body as Readable);
    }

    if (!buffer) {
      throw new Error("Buffer file tidak tersedia untuk diproses.");
    }

    // 2. Parse teks dari dokumen
    const parsed = await FileParserService.parseBuffer(buffer, input.filename, input.mimetype);
    if (!parsed.text || parsed.text.trim().length === 0) {
      console.warn(`File "${input.filename}" tidak menghasilkan teks yang dapat diekstrak.`);
      return { chunksCount: 0, charCount: 0, sourceId };
    }

    // 3. Chunking teks
    const chunks = ChunkingService.splitText(parsed.text, {
      filename: input.filename,
      mimetype: input.mimetype,
      s3Key: input.s3Key,
      sourceType: "FILE",
    });

    if (chunks.length === 0) {
      return { chunksCount: 0, charCount: parsed.metadata.charCount, sourceId };
    }

    // 4. Batch Embedding Generation
    const chunkTexts = chunks.map((c) => c.content);
    const embeddings = await EmbeddingService.generateBatchEmbeddings(chunkTexts);

    // 5. Format TaskEmbeddingRecords
    const records: TaskEmbeddingRecord[] = chunks.map((chunk, i) => ({
      taskId: input.taskId,
      boardId: input.boardId,
      sourceType: "FILE",
      sourceId,
      content: chunk.content,
      embedding: embeddings[i],
      metadata: {
        ...chunk.metadata,
        chunkIndex: i,
        totalChunks: chunks.length,
      },
    }));

    // 6. Bersihkan embedding lama untuk sourceId yang sama lalu insert batch baru
    await VectorStoreService.deleteBySourceId(sourceId);
    await VectorStoreService.insertBatch(records);

    console.log(
      `[RAG Ingestion] Berhasil mengindeks file "${input.filename}" (${chunks.length} chunks) untuk task ${input.taskId}`
    );

    return {
      chunksCount: chunks.length,
      charCount: parsed.metadata.charCount,
      sourceId,
    };
  }
}

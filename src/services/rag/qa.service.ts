import { RetrievalService } from "./retrieval.service.js";
import { RAGAnswerResponse, RetrievalResult } from "./types.js";
import { prisma } from "../../lib/prisma.js";
import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
// Default model yang cepat, stabil, dan terbukti responsif
const DEFAULT_LLM_MODEL = process.env.LLM_MODEL || "gemini-3.6-flash";

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// Daftar model fallback berurutan berdasarkan stabilitas dan kecepatan
const FALLBACK_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
];

export class QAService {
  /**
   * Menjawab pertanyaan pengguna terkait kartu Kanban menggunakan RAG pipeline dengan Google Gemini.
   */
  public static async answerTaskQuestion(
    taskId: string,
    question: string,
    topK: number = 5,
    customModel?: string
  ): Promise<RAGAnswerResponse> {
    // 1. Ambil metadata kartu Kanban (Title, Description, Assignee, Project)
    const task = await prisma.task
      .findUnique({
        where: { id: taskId },
        include: {
          project: { select: { id: true, name: true } },
          assignee: { select: { name: true, role: true } },
          creator: { select: { name: true } },
        },
      })
      .catch(() => null);

    const boardId = task?.project?.id || "";

    // 2. Retrieval: Ambil chunk dokumen dan chat paling relevan dari pgvector
    // Gunakan timeout cepat (2.5 detik) agar jika pgvector/embedding terhambat, request tidak hang
    let retrievedChunks: RetrievalResult[] = [];
    try {
      const retrievalPromise = RetrievalService.retrieveContext({
        taskId,
        boardId,
        queryText: question,
        topK,
        minSimilarity: 0.3,
      });

      const timeoutPromise = new Promise<RetrievalResult[]>((resolve) =>
        setTimeout(() => resolve([]), 2500)
      );

      retrievedChunks = await Promise.race([retrievalPromise, timeoutPromise]);
    } catch (retrievalError) {
      console.warn("Retrieval timeout or error, proceeding with task metadata:", retrievalError);
      retrievedChunks = [];
    }

    // 3. Susun konteks kartu dan chunk hasil pencarian semantik
    const contextPrompt = this.buildContextPrompt(task, retrievedChunks);

    // Tentukan urutan model yang akan dicoba (requested model -> fallback cascade)
    const requestedModel = customModel?.trim() || DEFAULT_LLM_MODEL;
    const modelCandidates = Array.from(new Set([requestedModel, ...FALLBACK_MODELS]));

    // 4. Generate jawaban dari Google Gemini LLM dengan fallback cascade otomatis
    const { answer, actualModel } = await this.callGeminiWithFallback(
      question,
      contextPrompt,
      modelCandidates
    );

    // 5. Format sitasi sumber
    const sources = retrievedChunks.map((chunk) => ({
      sourceType: chunk.sourceType,
      sourceId: chunk.sourceId,
      snippet:
        chunk.content.slice(0, 180) + (chunk.content.length > 180 ? "..." : ""),
      metadata: chunk.metadata,
      similarity: Math.round(chunk.similarity * 100) / 100,
    }));

    return {
      answer,
      sources,
      taskId,
      model: actualModel,
    };
  }

  /**
   * Menyusun payload konteks untuk diumpankan ke Gemini LLM.
   */
  private static buildContextPrompt(
    task: any,
    chunks: RetrievalResult[],
  ): string {
    const sections: string[] = [];

    // Metadata Kartu Kanban
    if (task) {
      sections.push(
        `
=== INFORMASI KARTU KANBAN ===
Judul: ${task.title}
Deskripsi: ${task.description || "(Tidak ada deskripsi)"}
Status: ${task.status} | Prioritas: ${task.priority}
Assignee: ${task.assignee?.name || "Belum ditugaskan"}
Project / Board: ${task.project?.name || "General"}
      `.trim(),
      );
    }

    // Chunk Hasil Retrieval Dokumen & Chat
    if (chunks.length > 0) {
      const chunkTexts = chunks.map((c, i) => {
        const sourceLabel =
          c.sourceType === "FILE"
            ? `File: ${c.metadata?.filename || c.sourceId}`
            : `Chat Thread (${c.metadata?.messageCount || "?"} pesan)`;
        return `[Konteks #${i + 1} - ${sourceLabel} (Relevansi: ${Math.round(c.similarity * 100)}%)]\n${c.content}`;
      });

      sections.push(
        `
=== DOKUMEN LAMPIRAN & CHAT THREAD TERKAIT ===
${chunkTexts.join("\n\n---\n\n")}
      `.trim(),
      );
    } else {
      sections.push(
        `(Tidak ditemukan dokumen lampiran atau chat thread yang relevan di kartu ini)`,
      );
    }

    return sections.join("\n\n");
  }

  /**
   * Memanggil Google Gemini API dengan cascade fallback dan timeout per model
   * Mencegah Error: socket hang up dan memastikan respons super cepat.
   */
  private static async callGeminiWithFallback(
    question: string,
    contextPrompt: string,
    models: string[]
  ): Promise<{ answer: string; actualModel: string }> {
    const systemInstructionText = `
Anda adalah asisten cerdas AI untuk sistem Kanban Task Management.
Tugas Anda adalah menjawab pertanyaan pengguna secara akurat, lugas, dan profesional berdasarkan informasi kartu, dokumen lampiran (PDF/DOCX/TXT), dan riwayat chat thread yang diberikan dalam konteks.

Pedoman:
1. Dasarkan jawaban Anda pada fakta yang tertulis dalam konteks yang disediakan.
2. Jika informasi tidak ditemukan dalam lampiran dokumen atau riwayat chat, katakan dengan jujur bahwa informasi tersebut tidak tercantum pada data kartu.
3. Sebutkan nama file dokumen atau referensi chat yang menjadi rujukan jika relevan.
4. Gunakan bahasa Indonesia yang baik, sopan, dan jelas.
5. Format jawaban menggunakan Markdown yang rapi dan standar (gunakan bold **teks** untuk penekanan, bullet points untuk daftar, dan blockquote untuk kutipan). JANGAN gunakan awalan seperti '//jawaban' atau tanda bintang berlebih (seperti '****//jawaban****'). Langsung berikan jawaban yang komprehensif.
    `.trim();

    if (ai) {
      const userPrompt = `Berikut adalah konteks data kartu Kanban:\n\n${contextPrompt}\n\nPertanyaan Pengguna: "${question}"\n\nBerikan jawaban yang jelas dan terstruktur:`;

      for (const modelName of models) {
        const controller = new AbortController();
        // Batas timeout 8.5 detik per model untuk mencegah socket hang up
        const timeoutId = setTimeout(() => controller.abort(), 8500);

        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: userPrompt,
            config: {
              systemInstruction: systemInstructionText,
              temperature: 0.2,
              // @ts-ignore
              signal: controller.signal,
            },
          });
          clearTimeout(timeoutId);

          const candidateText = response.text;
          if (candidateText && candidateText.trim().length > 0) {
            const cleanedAnswer = candidateText
              .replace(/^(\*{2,4})\s*\/\/\s*jawaba?n:?\s*(\*{2,4})?\s*/gim, "")
              .trim();
            return {
              answer: cleanedAnswer || candidateText.trim(),
              actualModel: modelName,
            };
          }
        } catch (err: any) {
          clearTimeout(timeoutId);
          console.warn(
            `[QAService] Model ${modelName} gagal (${err?.status || err?.code || err?.message || "error"}). Mencoba model cadangan...`
          );
        }
      }
    }

    // Fallback jika semua pemanggilan API gagal atau API key belum diset
    return {
      answer: `[Mode Pratinjau RAG Gemini - API Key Belum Dikonfigurasi / Koneksi Terbatas]\n\nBerdasarkan konteks kartu dan file yang terindeks:\n${contextPrompt.slice(
        0,
        300
      )}...\n\n(Catatan: Permintaan telah diproses secara cepat dengan ringkasan konteks kartu).`,
      actualModel: "fallback-context",
    };
  }
}


/**
 * Service untuk men-generate vector embedding dari teks menggunakan Google Gemini API.
 * Menggunakan model text-embedding-004 (768 dimensi).
 */

import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "gemini-embedding-001";
const EMBEDDING_DIMENSION = parseInt(
  process.env.EMBEDDING_DIMENSION || "768",
  10,
);

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

export class EmbeddingService {
  /**
   * Menghasilkan embedding untuk satu string teks menggunakan Google Gen AI SDK (@google/genai).
   */
  public static async generateEmbedding(text: string): Promise<number[]> {
    const cleanedText = text.replace(/\n+/g, " ").trim();
    if (!cleanedText) {
      return new Array(EMBEDDING_DIMENSION).fill(0);
    }

    if (ai) {
      try {
        const response = await ai.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: cleanedText,
        });
        const values =
          response.embeddings?.[0]?.values || (response as any).embedding?.values;
        if (values && values.length > 0) {
          return values;
        }
      } catch (err) {
        console.warn("EmbeddingService.generateEmbedding error, falling back to pseudo-embedding:", err);
        return this.generatePseudoEmbedding(cleanedText, EMBEDDING_DIMENSION);
      }
    }


    // Fallback Mock/Deterministic Embedding untuk development/testing jika belum ada API key
    console.warn(
      "GEMINI_API_KEY tidak terdeteksi. Menggunakan deterministic pseudo-embedding untuk dev/test.",
    );
    return this.generatePseudoEmbedding(cleanedText, EMBEDDING_DIMENSION);
  }

  /**
   * Menghasilkan embedding dalam batch menggunakan Google Gen AI SDK (@google/genai).
   */
  public static async generateBatchEmbeddings(
    texts: string[],
  ): Promise<number[][]> {
    const cleanedTexts = texts.map((t) => t.replace(/\n+/g, " ").trim());
    const validIndexes: number[] = [];
    const inputsToSend: string[] = [];

    cleanedTexts.forEach((t, idx) => {
      if (t.length > 0) {
        validIndexes.push(idx);
        inputsToSend.push(t);
      }
    });

    if (inputsToSend.length === 0) {
      return texts.map(() => new Array(EMBEDDING_DIMENSION).fill(0));
    }

    if (ai) {
      try {
        const response = await ai.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: inputsToSend,
        });

        const results: number[][] = new Array(texts.length).fill(null);

        // Petakan kembali ke indeks asli
        if (response.embeddings) {
          response.embeddings.forEach((item: any, i: number) => {
            const originalIdx = validIndexes[i];
            results[originalIdx] = item.values;
          });
        }

        // Isi string kosong dengan array 0
        for (let i = 0; i < results.length; i++) {
          if (!results[i]) {
            results[i] = new Array(EMBEDDING_DIMENSION).fill(0);
          }
        }

        return results;
      } catch (err) {
        console.error("EmbeddingService.generateBatchEmbeddings error:", err);
        throw err;
      }
    }

    // Fallback Pseudo Embedding
    return cleanedTexts.map((text) =>
      this.generatePseudoEmbedding(text, EMBEDDING_DIMENSION),
    );
  }

  /**
   * Generator pseudo-embedding normalisasi Cosine untuk mode offline/testing.
   */
  private static generatePseudoEmbedding(text: string, dim: number): number[] {
    const vec: number[] = new Array(dim).fill(0);
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
      const idx = Math.abs(hash) % dim;
      vec[idx] += 1;
    }

    // Normalisasi vektor ke unit length (magnitude 1.0)
    const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0)) || 1;
    return vec.map((val) => val / norm);
  }
}

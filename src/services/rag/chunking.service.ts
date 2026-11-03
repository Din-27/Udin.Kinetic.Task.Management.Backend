import { DocumentChunk } from "./types.js";

export interface ChunkingOptions {
  chunkSize?: number; // target karakter per chunk (default ~1500 chars / ~300-500 tokens)
  chunkOverlap?: number; // overlap karakter antar chunk (default ~200 chars / ~50-80 tokens)
  separators?: string[];
}

export class ChunkingService {
  private static defaultOptions: Required<ChunkingOptions> = {
    chunkSize: 1500,
    chunkOverlap: 200,
    separators: ["\n\n", "\n", ". ", "? ", "! ", " ", ""],
  };

  /**
   * Memotong teks panjang menjadi chunk-chunk kontekstual dengan sliding window overlap.
   */
  public static splitText(
    text: string,
    metadata: Record<string, any> = {},
    customOptions?: ChunkingOptions
  ): DocumentChunk[] {
    const opts = { ...this.defaultOptions, ...customOptions };
    const cleanText = text.replace(/\r\n/g, "\n").trim();

    if (!cleanText) {
      return [];
    }

    if (cleanText.length <= opts.chunkSize) {
      return [
        {
          content: cleanText,
          metadata: { ...metadata, chunkIndex: 0, totalChunks: 1 },
          index: 0,
        },
      ];
    }

    const rawChunks = this.recursiveSplit(cleanText, opts.separators, opts.chunkSize, opts.chunkOverlap);

    return rawChunks.map((content, idx) => ({
      content: content.trim(),
      metadata: {
        ...metadata,
        chunkIndex: idx,
        totalChunks: rawChunks.length,
        charCount: content.length,
      },
      index: idx,
    }));
  }

  /**
   * Algoritma recursive character text splitter.
   */
  private static recursiveSplit(
    text: string,
    separators: string[],
    chunkSize: number,
    chunkOverlap: number
  ): string[] {
    const finalChunks: string[] = [];

    // Pilih separator terbaik
    let separator = separators[separators.length - 1];
    let newSeparators: string[] = [];

    for (let i = 0; i < separators.length; i++) {
      const s = separators[i];
      if (s === "" || text.includes(s)) {
        separator = s;
        newSeparators = separators.slice(i + 1);
        break;
      }
    }

    const splits = separator ? text.split(separator) : Array.from(text);
    let currentChunk: string[] = [];
    let currentLength = 0;

    for (const piece of splits) {
      const pieceLen = piece.length + (currentChunk.length > 0 ? separator.length : 0);

      if (currentLength + pieceLen > chunkSize && currentChunk.length > 0) {
        const chunkText = currentChunk.join(separator);
        finalChunks.push(chunkText);

        // Pertahankan overlap dari akhir chunk sebelumnya
        while (currentLength > chunkOverlap && currentChunk.length > 1) {
          const removed = currentChunk.shift()!;
          currentLength -= removed.length + separator.length;
        }
      }

      currentChunk.push(piece);
      currentLength += piece.length + (currentChunk.length > 1 ? separator.length : 0);
    }

    if (currentChunk.length > 0) {
      finalChunks.push(currentChunk.join(separator));
    }

    return finalChunks;
  }
}

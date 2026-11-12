import path from "path";

export interface ParsedDocument {
  text: string;
  metadata: {
    filename: string;
    extension: string;
    mimetype?: string;
    pageCount?: number;
    charCount: number;
  };
}

export class FileParserService {
  /**
   * Mengurai buffer file menjadi string teks terstruktur.
   */
  public static async parseBuffer(
    buffer: Buffer,
    filename: string,
    mimetype?: string
  ): Promise<ParsedDocument> {
    const ext = path.extname(filename).toLowerCase().replace(".", "");
    let extractedText = "";

    switch (ext) {
      case "txt":
      case "md":
      case "markdown":
      case "json":
      case "csv":
      case "log":
      case "yaml":
      case "yml":
        extractedText = buffer.toString("utf-8");
        break;

      case "pdf":
        extractedText = await this.parsePdf(buffer);
        break;

      case "docx":
        extractedText = await this.parseDocx(buffer);
        break;

      default:
        // Coba konversi utf-8 jika readable text, jika biner buang non-printable
        extractedText = buffer
          .toString("utf-8")
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, " ")
          .trim();
        break;
    }

    return {
      text: extractedText.trim(),
      metadata: {
        filename,
        extension: ext,
        mimetype,
        charCount: extractedText.length,
      },
    };
  }

  /**
   * Ekstraksi teks dari file PDF.
   * Menggunakan stream parser sederhana yang mengekstrak blok teks (BT ... ET)
   * tanpa membutuhkan native binaries.
   */
  private static async parsePdf(buffer: Buffer): Promise<string> {
    try {
      const maxSlice = Math.min(buffer.length, 5 * 1024 * 1024);
      const pdfString = buffer.subarray(0, maxSlice).toString("latin1");
      const textBlocks: string[] = [];

      // Regex untuk menangkap stream teks di PDF: BT (Begin Text) hingga ET (End Text)
      const btMatches = pdfString.match(/BT[\s\S]*?ET/g);

      if (btMatches && btMatches.length > 0) {
        for (let i = 0; i < Math.min(btMatches.length, 2000); i++) {
          const block = btMatches[i];
          // Cari string dalam tanda kurung: (Teks yang diekstrak)
          const textMatches = block.match(/\((.*?)\)/g);
          if (textMatches) {
            const blockContent = textMatches
              .map((m) => m.slice(1, -1))
              .join(" ");
            textBlocks.push(blockContent);
          }
        }
      }

      const result = textBlocks.join("\n").trim();
      if (result.length > 50) {
        return result;
      }

      // Fallback: ekstrak semua readable string berurutan
      const readableStrings = pdfString.match(/[A-Za-z0-9\s.,!?:;'"\-–—()]{4,}/g);
      return (readableStrings || []).slice(0, 5000).join(" ").trim();
    } catch (err) {
      console.warn("Gagal parse PDF via regex extractor, fallback ke string scanner:", err);
      return buffer.subarray(0, 1024 * 1024).toString("utf-8").replace(/[^\x20-\x7E\n\r\t]/g, " ");
    }
  }

  /**
   * Ekstraksi teks dari file DOCX (OpenXML).
   * DOCX adalah arsip ZIP yang memuat 'word/document.xml'.
   */
  private static async parseDocx(buffer: Buffer): Promise<string> {
    try {
      const maxSlice = Math.min(buffer.length, 5 * 1024 * 1024);
      const raw = buffer.subarray(0, maxSlice).toString("latin1");
      // Cari fragmen XML paragraf w:t (Word Text element)
      const textMatches = raw.match(/<w:t[^>]*>(.*?)<\/w:t>/g);
      if (textMatches && textMatches.length > 0) {
        const clean = textMatches
          .slice(0, 3000)
          .map((m) => m.replace(/<[^>]+>/g, ""))
          .join(" ");
        return clean.trim();
      }

      return buffer.subarray(0, 1024 * 1024).toString("utf-8").replace(/<[^>]+>/g, " ").replace(/[^\x20-\x7E\n\r\t]/g, " ");
    } catch (err) {
      console.warn("Gagal parse DOCX, fallback:", err);
      return buffer.subarray(0, 1024 * 1024).toString("utf-8").replace(/[^\x20-\x7E\n\r\t]/g, " ");
    }
  }
}

import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const router = Router();

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".pdf",
  ".txt",
  ".csv",
  ".md",
  ".json",
  ".docx",
  ".xlsx",
  ".pptx",
  ".zip",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

router.post("/", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "Tidak ada file yang diunggah" });
    }

    if (file.size > MAX_FILE_SIZE) {
      return res.status(400).json({
        error: "Ukuran file melebihi batas maksimal 10 MB",
        size: file.size,
        maxSize: MAX_FILE_SIZE,
      });
    }

    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
      return res.status(400).json({
        error: `Format file "${ext}" tidak diizinkan. Hanya file dokumen dan gambar umum yang diperbolehkan.`,
      });
    }

    const region = process.env.AWS_REGION || "us-east-2";
    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || "default";
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const endpoint = process.env.AWS_ENDPOINT_URL_S3 || process.env.AWS_ENDPOINT;

    const safeBasename = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
    const s3Key = `tasks/${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safeBasename}${ext}`;
    const isImage = file.mimetype.startsWith("image/");

    if (accessKeyId && secretAccessKey) {
      const s3Client = new S3Client({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      });

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: file.buffer,
        ContentType: file.mimetype || "application/octet-stream",
      });

      await s3Client.send(command);

      const fileUrl = endpoint
        ? `${endpoint.replace(/\/$/, "")}/${bucket}/${s3Key}`
        : `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`;

      return res.json({
        success: true,
        url: fileUrl,
        name: file.originalname,
        size: file.size,
        type: isImage ? "image" : "file",
        storage: "s3",
      });
    }

    // Fallback development jika AWS credentials belum diisi di .env
    const base64Data = `data:${file.mimetype || "application/octet-stream"};base64,${file.buffer.toString("base64")}`;
    return res.json({
      success: true,
      url: base64Data,
      name: file.originalname,
      size: file.size,
      type: isImage ? "image" : "file",
      storage: "local-dev-fallback",
      message:
        "AWS S3 credentials belum dikonfigurasi di .env, file disimpan secara in-memory untuk dev.",
    });
  } catch (error: any) {
    console.error("Upload S3 error:", error);
    return res.status(500).json({
      error: error?.message || "Gagal mengunggah file ke S3",
    });
  }
});

export default router;

import { prisma } from "../lib/prisma.js";
import fs from "fs";
import path from "path";

async function runPgvectorMigration() {
  console.log("\n🚀 Memulai eksekusi migrasi pgvector ke Neon PostgreSQL...");

  const sqlFilePath = path.resolve(process.cwd(), "prisma/migrations/rag_pgvector_schema.sql");
  if (!fs.existsSync(sqlFilePath)) {
    throw new Error(`File SQL tidak ditemukan pada: ${sqlFilePath}`);
  }

  const sqlContent = fs.readFileSync(sqlFilePath, "utf-8");

  try {
    // 1. Verifikasi koneksi Neon
    console.log("⏳ Memeriksa koneksi database...");
    await prisma.$queryRawUnsafe(`SELECT 1`);
    console.log("✅ Terhubung ke database Neon PostgreSQL.");

    // 2. Aktifkan ekstensi vector
    console.log("⏳ Mengaktifkan ekstensi vector (pgvector)...");
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector;`);
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    console.log("✅ Ekstensi pgvector & uuid berhasil diaktifkan.");

    // 3. Buat ENUM jika belum ada
    console.log("⏳ Membuat ENUM embedding_source_type...");
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'embedding_source_type') THEN
          CREATE TYPE embedding_source_type AS ENUM ('FILE', 'CHAT');
        END IF;
      END$$;
    `);

    // 4. Buat Tabel "TaskDocumentEmbeddings"
    console.log("⏳ Membuat tabel TaskDocumentEmbeddings (VECTOR 768)...");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "TaskDocumentEmbeddings" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id VARCHAR(255) NOT NULL,
        board_id VARCHAR(255) NOT NULL,
        source_type embedding_source_type NOT NULL,
        source_id VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        embedding VECTOR(768) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT fk_task_embedding_task FOREIGN KEY (task_id) REFERENCES "Task"(id) ON DELETE CASCADE,
        CONSTRAINT fk_task_embedding_board FOREIGN KEY (board_id) REFERENCES "Project"(id) ON DELETE CASCADE
      );
    `);
    console.log("✅ Tabel TaskDocumentEmbeddings siap.");

    // 5. Buat Indeks B-Tree & HNSW
    console.log("⏳ Membuat indeks B-Tree & HNSW Vector Cosine...");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_task_embeddings_task_id ON "TaskDocumentEmbeddings" (task_id);
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_task_embeddings_board_id ON "TaskDocumentEmbeddings" (board_id);
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_task_embeddings_source_type ON "TaskDocumentEmbeddings" (source_type);
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_task_embeddings_metadata_gin ON "TaskDocumentEmbeddings" USING GIN (metadata);
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_task_embeddings_hnsw_cosine
      ON "TaskDocumentEmbeddings" 
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
    `);
    console.log("✅ Seluruh indeks (termasuk HNSW Vector Cosine) berhasil dibuat.");

    // 6. Validasi hasil
    const result = await prisma.$queryRawUnsafe<any[]>(`
      SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
    `);

    console.log("\n🎉 Migrasi pgvector SUKSES!");
    console.log("Status Ekstensi:", result[0] || "Terpasang");
  } catch (error: any) {
    console.error("\n❌ Gagal menjalankan migrasi pgvector:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runPgvectorMigration();

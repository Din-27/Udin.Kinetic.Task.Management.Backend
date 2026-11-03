-- ==============================================================================
-- Migration: RAG pgvector Schema for Kanban Task Management (Neon / PostgreSQL)
-- ==============================================================================

-- 1. Pastikan ekstensi vector dan uuid aktif di database Neon / PostgreSQL
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. ENUM tipe sumber embedding (FILE dokumen lampiran atau CHAT thread)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'embedding_source_type') THEN
        CREATE TYPE embedding_source_type AS ENUM ('FILE', 'CHAT');
    END IF;
END$$;

-- 3. Tabel utama penyimpan embedding dokumen dan chat kartu Kanban
CREATE TABLE IF NOT EXISTS "TaskDocumentEmbeddings" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id VARCHAR(255) NOT NULL,
    board_id VARCHAR(255) NOT NULL,
    source_type embedding_source_type NOT NULL,
    source_id VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    -- Dimensi 768 untuk Google Gemini (text-embedding-004)
    embedding VECTOR(768) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Foreign keys terhubung dengan tabel Task dan Project/Board
    CONSTRAINT fk_task_embedding_task FOREIGN KEY (task_id) REFERENCES "Task"(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_embedding_board FOREIGN KEY (board_id) REFERENCES "Project"(id) ON DELETE CASCADE
);

-- 4. Indeks B-Tree untuk pencarian cepat dan pemfilteran terisolasi per Task & Board
CREATE INDEX IF NOT EXISTS idx_task_embeddings_task_id 
    ON "TaskDocumentEmbeddings" (task_id);

CREATE INDEX IF NOT EXISTS idx_task_embeddings_board_id 
    ON "TaskDocumentEmbeddings" (board_id);

CREATE INDEX IF NOT EXISTS idx_task_embeddings_source_type 
    ON "TaskDocumentEmbeddings" (source_type);

CREATE INDEX IF NOT EXISTS idx_task_embeddings_source_id 
    ON "TaskDocumentEmbeddings" (source_id);

CREATE INDEX IF NOT EXISTS idx_task_embeddings_metadata_gin 
    ON "TaskDocumentEmbeddings" USING GIN (metadata);

-- 5. Indeks Vector HNSW (Hierarchical Navigable Small World) dengan Cosine Distance
-- HNSW sangat cepat untuk skala produksi dan tidak memerlukan training data seperti IVFFlat
CREATE INDEX IF NOT EXISTS idx_task_embeddings_hnsw_cosine
    ON "TaskDocumentEmbeddings" 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

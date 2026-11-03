import { prisma } from "../lib/prisma.js";
import { GoogleGenAI } from "@google/genai";

export type FlowchartNodeType =
  | "START"
  | "END"
  | "PROCESS"
  | "DECISION"
  | "DATABASE"
  | "INPUT_OUTPUT"
  | "SUBPROCESS"
  | "NOTE";

export interface FlowchartNode {
  id: string;
  type: FlowchartNodeType;
  label: string;
  description?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}

export interface FlowchartEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  color?: string;
  arrowStyle?: "directed" | "bidirectional" | "line" | "dashed";
  routing?: "orthogonal" | "curved" | "straight";
  strokeWidth?: number;
}

export interface FlowchartComment {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  text: string;
  createdAt: string;
  nodeId?: string;
  nodeLabel?: string;
}

export interface FlowchartDiagram {
  id: string;
  workspaceId: string;
  userId?: string;
  creatorName?: string;
  title: string;
  description?: string;
  prompt?: string;
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
  comments?: FlowchartComment[];
  createdAt: string;
  updatedAt: string;
}

export class FlowchartService {
  /**
   * Mengambil semua diagram flowchart dalam suatu workspace
   */
  static async getFlowcharts(workspaceId: string = "default", userId?: string): Promise<FlowchartDiagram[]> {
    const records = await prisma.flowchart.findMany({
      where: {
        workspaceId,
        ...(userId ? { OR: [{ userId }, { userId: null }] } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });

    return records.map((rec) => ({
      id: rec.id,
      workspaceId: rec.workspaceId,
      userId: rec.userId || undefined,
      creatorName: rec.creatorName || undefined,
      title: rec.title,
      description: rec.description || "",
      prompt: rec.prompt || "",
      nodes: (rec.nodes as any) || [],
      edges: (rec.edges as any) || [],
      comments: (rec.comments as any) || [],
      createdAt: rec.createdAt.toISOString(),
      updatedAt: rec.updatedAt.toISOString(),
    }));
  }

  /**
   * Mengambil satu diagram flowchart berdasarkan ID
   */
  static async getFlowchartById(id: string): Promise<FlowchartDiagram | null> {
    let rec = await prisma.flowchart.findUnique({
      where: { id },
    });

    if (!rec) {
      rec = await prisma.flowchart.findFirst({
        where: { id: { contains: id } },
      });
    }

    if (!rec) return null;

    return {
      id: rec.id,
      workspaceId: rec.workspaceId,
      userId: rec.userId || undefined,
      creatorName: rec.creatorName || undefined,
      title: rec.title,
      description: rec.description || "",
      prompt: rec.prompt || "",
      nodes: (rec.nodes as any) || [],
      edges: (rec.edges as any) || [],
      comments: (rec.comments as any) || [],
      createdAt: rec.createdAt.toISOString(),
      updatedAt: rec.updatedAt.toISOString(),
    };
  }

  /**
   * Menyimpan / memperbarui flowchart dengan validasi ID unik anti-bentrok
   */
  static async saveFlowchart(data: {
    id?: string;
    workspaceId?: string;
    userId?: string;
    creatorName?: string;
    title?: string;
    description?: string;
    prompt?: string;
    nodes?: FlowchartNode[];
    edges?: FlowchartEdge[];
    comments?: FlowchartComment[];
  }): Promise<FlowchartDiagram> {
    const rawId = data.id ? String(data.id).trim() : "";
    const isForbiddenDefault =
      !rawId ||
      rawId === "default" ||
      rawId === "flow-default" ||
      rawId.endsWith("-default");

    const id = !isForbiddenDefault
      ? rawId
      : `flow-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const workspaceId = data.workspaceId || "default";
    const userId = data.userId || undefined;
    const creatorName = data.creatorName || undefined;

    // Validasi kepemilikan jika diagram sudah ada sebelumnya
    const existing = await prisma.flowchart.findUnique({ where: { id } });
    if (existing && existing.userId && userId && existing.userId !== userId) {
      throw new Error("FORBIDDEN_USER");
    }

    const saved = await prisma.flowchart.upsert({
      where: { id },
      create: {
        id,
        workspaceId,
        userId: userId || undefined,
        creatorName: creatorName || undefined,
        title: data.title || "Flowchart Diagram",
        description: data.description || "",
        prompt: data.prompt || "",
        nodes: Array.isArray(data.nodes) ? (data.nodes as any) : [],
        edges: Array.isArray(data.edges) ? (data.edges as any) : [],
        comments: Array.isArray(data.comments) ? (data.comments as any) : [],
      },
      update: {
        workspaceId,
        userId: userId || existing?.userId,
        creatorName: creatorName || existing?.creatorName,
        title: data.title || "Flowchart Diagram",
        description: data.description || "",
        prompt: data.prompt || "",
        nodes: Array.isArray(data.nodes) ? (data.nodes as any) : [],
        edges: Array.isArray(data.edges) ? (data.edges as any) : [],
        comments: Array.isArray(data.comments) ? (data.comments as any) : (existing?.comments as any) || [],
      },
    });

    return {
      id: saved.id,
      workspaceId: saved.workspaceId,
      userId: saved.userId || undefined,
      creatorName: saved.creatorName || undefined,
      title: saved.title,
      description: saved.description || "",
      prompt: saved.prompt || "",
      nodes: saved.nodes as any,
      edges: saved.edges as any,
      comments: saved.comments as any,
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  /**
   * Menambahkan komentar ke diagram
   */
  static async addComment(
    id: string,
    commentPayload: {
      id?: string;
      userId?: string;
      userName?: string;
      userAvatar?: string;
      text?: string;
      createdAt?: string;
      nodeId?: string;
      nodeLabel?: string;
    }
  ): Promise<FlowchartComment> {
    let rec = await prisma.flowchart.findUnique({ where: { id } });
    if (!rec) {
      rec = await prisma.flowchart.findFirst({
        where: { id: { contains: id } },
      });
    }

    if (!rec) {
      throw new Error("NOT_FOUND");
    }

    const comments: FlowchartComment[] = Array.isArray(rec.comments) ? (rec.comments as any) : [];
    const newComment: FlowchartComment = {
      id: commentPayload.id || `comment-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      userId: commentPayload.userId || "anonymous",
      userName: commentPayload.userName || "User",
      userAvatar: commentPayload.userAvatar,
      text: commentPayload.text || "",
      createdAt: commentPayload.createdAt || new Date().toISOString(),
      nodeId: commentPayload.nodeId,
      nodeLabel: commentPayload.nodeLabel,
    };

    comments.push(newComment);

    await prisma.flowchart.update({
      where: { id: rec.id },
      data: { comments: comments as any },
    });

    return newComment;
  }

  /**
   * Menghapus diagram flowchart
   */
  static async deleteFlowchart(id: string, userId?: string): Promise<boolean> {
    const existing = await prisma.flowchart.findUnique({ where: { id } });
    if (existing) {
      if (existing.userId && userId && existing.userId !== userId) {
        throw new Error("FORBIDDEN_USER");
      }
      await prisma.flowchart.delete({ where: { id } });
      return true;
    }
    return false;
  }

  /**
   * Generate Flowchart dari Prompt AI menggunakan Gemini atau Smart Rule-Based Fallback
   */
  static async generateFlowchart(
    prompt: string,
    workspaceId: string = "default",
    userId?: string,
    creatorName?: string
  ): Promise<FlowchartDiagram> {
    let generatedDiagram: {
      title: string;
      description: string;
      nodes: FlowchartNode[];
      edges: FlowchartEdge[];
    } | null = null;

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        generatedDiagram = await FlowchartService.generateWithGemini(prompt.trim(), apiKey);
      } catch (geminiErr: any) {
        console.warn("Gemini Flowchart error, beralih ke fallback cerdas:", geminiErr?.message || geminiErr);
      }
    }

    if (!generatedDiagram || !generatedDiagram.nodes || generatedDiagram.nodes.length === 0) {
      generatedDiagram = FlowchartService.generateSmartFallbackFlowchart(prompt.trim());
    }

    const arranged = FlowchartService.applyHierarchicalLayout(generatedDiagram.nodes, generatedDiagram.edges);

    return {
      id: `flow-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      workspaceId,
      userId,
      creatorName,
      title: generatedDiagram.title || "AI Flowchart Diagram",
      description: generatedDiagram.description || `Flowchart otomatis dari prompt: "${prompt}"`,
      prompt: prompt.trim(),
      nodes: arranged.nodes,
      edges: arranged.edges,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  private static async generateWithGemini(
    userPrompt: string,
    apiKey: string
  ): Promise<{
    title: string;
    description: string;
    nodes: FlowchartNode[];
    edges: FlowchartEdge[];
  } | null> {
    const systemInstruction = `Anda adalah Software Architect & System Analyst ahli yang membuat diagram flowchart profesional (seperti Draw.io / BPMN / ISO 5807).
Tugas Anda adalah membaca deskripsi alur proses dari user dan mengonversinya menjadi diagram alur yang jelas, presisi, dan logis.

Aturan Pembuatan Node:
1. Mulai dengan 1 node START ("START", warna hijau #10b981).
2. Gunakan "PROCESS" (warna biru #3b82f6) untuk tindakan, eksekusi kode, atau operasi.
3. Gunakan "DECISION" (warna amber #f59e0b) untuk percabangan (misal: "Valid?", "Email Ada?", "Saldo Cukup?").
4. Gunakan "DATABASE" (warna ungu #8b5cf6) untuk penyimpanan atau query database.
5. Gunakan "INPUT_OUTPUT" (warna cyan #06b6d4) untuk input pengguna atau output pesan.
6. Akhiri setiap cabang dengan node "END" (warna merah rose #f43f5e).

Aturan Pembuatan Edge (Panah):
- Setiap edge menghubungkan source node ID ke target node ID.
- Pada cabang dari DECISION, sertakan label pada edge (misal: "Ya", "Tidak", "Sukses", "Gagal").

Format output HANYA JSON murni tanpa markdown wrapper:
{
  "title": "Judul Flowchart",
  "description": "Penjelasan singkat diagram",
  "nodes": [
    {
      "id": "node-1",
      "type": "START" | "PROCESS" | "DECISION" | "DATABASE" | "INPUT_OUTPUT" | "END",
      "label": "Teks Singkat Node",
      "description": "Deskripsi opsional",
      "color": "#hex"
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "node-1",
      "target": "node-2",
      "label": "opsional label panah",
      "animated": false
    }
  ]
}`;

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: `Buat diagram flowchart untuk alur proses berikut:\n"${userPrompt}"`,
      config: {
        systemInstruction,
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    });

    const rawText = response.text;
    if (!rawText) return null;

    const parsed = JSON.parse(rawText);
    return {
      title: parsed.title || "Flowchart Diagram",
      description: parsed.description || "",
      nodes: (parsed.nodes || []).map((n: any, idx: number) => ({
        id: n.id || `node-${idx + 1}`,
        type: n.type || "PROCESS",
        label: n.label || `Langkah ${idx + 1}`,
        description: n.description || "",
        x: 0,
        y: 0,
        width: n.type === "DECISION" ? 180 : 160,
        height: n.type === "DECISION" ? 90 : 70,
        color: n.color || FlowchartService.getNodeDefaultColor(n.type),
      })),
      edges: (parsed.edges || []).map((e: any, idx: number) => ({
        id: e.id || `edge-${idx + 1}`,
        source: e.source,
        target: e.target,
        label: e.label || "",
        animated: Boolean(e.animated),
        color: e.color || "#94a3b8",
      })),
    };
  }

  static generateSmartFallbackFlowchart(prompt: string): {
    title: string;
    description: string;
    nodes: FlowchartNode[];
    edges: FlowchartEdge[];
  } {
    const p = prompt.toLowerCase();

    if (p.includes("login") || p.includes("daftar") || p.includes("register") || p.includes("auth") || p.includes("otp")) {
      return {
        title: "Alur Autentikasi & Verifikasi Pengguna",
        description: "Diagram alur proses autentikasi, pengecekan akun, dan verifikasi keamanan.",
        nodes: [
          { id: "start", type: "START", label: "Mulai", x: 0, y: 0, width: 140, height: 60, color: "#10b981" },
          { id: "input_cred", type: "INPUT_OUTPUT", label: "Input Email & Password", x: 0, y: 0, width: 170, height: 70, color: "#06b6d4" },
          { id: "query_db", type: "DATABASE", label: "Cari User di DB Neon", x: 0, y: 0, width: 160, height: 70, color: "#8b5cf6" },
          { id: "check_valid", type: "DECISION", label: "Kredensial Valid?", x: 0, y: 0, width: 180, height: 90, color: "#f59e0b" },
          { id: "check_otp", type: "DECISION", label: "Perlu OTP / 2FA?", x: 0, y: 0, width: 180, height: 90, color: "#f59e0b" },
          { id: "send_otp", type: "PROCESS", label: "Kirim Kode OTP Email", x: 0, y: 0, width: 160, height: 70, color: "#3b82f6" },
          { id: "create_session", type: "PROCESS", label: "Generate Session Token", x: 0, y: 0, width: 170, height: 70, color: "#3b82f6" },
          { id: "auth_success", type: "END", label: "Masuk ke Dashboard", x: 0, y: 0, width: 150, height: 60, color: "#10b981" },
          { id: "auth_fail", type: "END", label: "Tolak & Tampilkan Error", x: 0, y: 0, width: 160, height: 60, color: "#f43f5e" },
        ],
        edges: [
          { id: "e1", source: "start", target: "input_cred" },
          { id: "e2", source: "input_cred", target: "query_db" },
          { id: "e3", source: "query_db", target: "check_valid" },
          { id: "e4", source: "check_valid", target: "check_otp", label: "Ya" },
          { id: "e5", source: "check_valid", target: "auth_fail", label: "Tidak" },
          { id: "e6", source: "check_otp", target: "send_otp", label: "Ya" },
          { id: "e7", source: "send_otp", target: "create_session" },
          { id: "e8", source: "check_otp", target: "create_session", label: "Tidak" },
          { id: "e9", source: "create_session", target: "auth_success" },
        ],
      };
    }

    if (p.includes("bug") || p.includes("issue") || p.includes("error") || p.includes("tiket")) {
      return {
        title: "SOP Penanganan Bug & Eskalasi Masalah",
        description: "Alur penerimaan tiket laporan bug, investigasi, dan rilis hotfix.",
        nodes: [
          { id: "start", type: "START", label: "Tiket Bug Masuk", x: 0, y: 0, width: 140, height: 60, color: "#10b981" },
          { id: "triage", type: "PROCESS", label: "Triage & Klasifikasi AI", x: 0, y: 0, width: 160, height: 70, color: "#3b82f6" },
          { id: "is_critical", type: "DECISION", label: "Severity Critical?", x: 0, y: 0, width: 180, height: 90, color: "#f59e0b" },
          { id: "hotfix", type: "PROCESS", label: "Investigasi Darurat Hotfix", x: 0, y: 0, width: 170, height: 70, color: "#ef4444" },
          { id: "normal_sprint", type: "PROCESS", label: "Masukkan ke Backlog Sprint", x: 0, y: 0, width: 170, height: 70, color: "#3b82f6" },
          { id: "code_review", type: "PROCESS", label: "Code Review & Unit Test", x: 0, y: 0, width: 160, height: 70, color: "#8b5cf6" },
          { id: "qa_test", type: "DECISION", label: "QA Lolos Verifikasi?", x: 0, y: 0, width: 180, height: 90, color: "#f59e0b" },
          { id: "deploy", type: "PROCESS", label: "Deploy ke Production", x: 0, y: 0, width: 160, height: 70, color: "#10b981" },
          { id: "closed", type: "END", label: "Tiket Selesai (Done)", x: 0, y: 0, width: 150, height: 60, color: "#10b981" },
        ],
        edges: [
          { id: "e1", source: "start", target: "triage" },
          { id: "e2", source: "triage", target: "is_critical" },
          { id: "e3", source: "is_critical", target: "hotfix", label: "Ya" },
          { id: "e4", source: "is_critical", target: "normal_sprint", label: "Tidak" },
          { id: "e5", source: "hotfix", target: "code_review" },
          { id: "e6", source: "normal_sprint", target: "code_review" },
          { id: "e7", source: "code_review", target: "qa_test" },
          { id: "e8", source: "qa_test", target: "deploy", label: "Ya" },
          { id: "e9", source: "qa_test", target: "code_review", label: "Revisi" },
          { id: "e10", source: "deploy", target: "closed" },
        ],
      };
    }

    return {
      title: `Alur Kerja: ${prompt.length > 30 ? prompt.substring(0, 30) + "..." : prompt}`,
      description: `Diagram flowchart sistematis untuk "${prompt}".`,
      nodes: [
        { id: "start", type: "START", label: "Mulai Proses", x: 0, y: 0, width: 140, height: 60, color: "#10b981" },
        { id: "step1", type: "INPUT_OUTPUT", label: "Inisialisasi Permintaan", x: 0, y: 0, width: 170, height: 70, color: "#06b6d4" },
        { id: "step2", type: "PROCESS", label: "Validasi & Pemrosesan Data", x: 0, y: 0, width: 170, height: 70, color: "#3b82f6" },
        { id: "decision", type: "DECISION", label: "Kondisi Terpenuhi?", x: 0, y: 0, width: 180, height: 90, color: "#f59e0b" },
        { id: "step_yes", type: "PROCESS", label: "Simpan ke Database", x: 0, y: 0, width: 160, height: 70, color: "#8b5cf6" },
        { id: "step_no", type: "PROCESS", label: "Log Pengecualian / Error", x: 0, y: 0, width: 170, height: 70, color: "#ef4444" },
        { id: "notify", type: "INPUT_OUTPUT", label: "Kirim Notifikasi Respon", x: 0, y: 0, width: 170, height: 70, color: "#06b6d4" },
        { id: "end", type: "END", label: "Selesai", x: 0, y: 0, width: 140, height: 60, color: "#10b981" },
      ],
      edges: [
        { id: "e1", source: "start", target: "step1" },
        { id: "e2", source: "step1", target: "step2" },
        { id: "e3", source: "step2", target: "decision" },
        { id: "e4", source: "decision", target: "step_yes", label: "Ya" },
        { id: "e5", source: "decision", target: "step_no", label: "Tidak" },
        { id: "e6", source: "step_yes", target: "notify" },
        { id: "e7", source: "step_no", target: "notify" },
        { id: "e8", source: "notify", target: "end" },
      ],
    };
  }

  static applyHierarchicalLayout(
    nodes: FlowchartNode[],
    edges: FlowchartEdge[]
  ): { nodes: FlowchartNode[]; edges: FlowchartEdge[] } {
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    nodes.forEach((n) => {
      adj.set(n.id, []);
      inDegree.set(n.id, 0);
    });

    edges.forEach((e) => {
      adj.get(e.source)?.push(e.target);
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    });

    const levels = new Map<string, number>();
    const queue: string[] = [];

    nodes.forEach((n) => {
      if ((inDegree.get(n.id) || 0) === 0 || n.type === "START") {
        levels.set(n.id, 0);
        queue.push(n.id);
      }
    });

    if (queue.length === 0 && nodes.length > 0) {
      levels.set(nodes[0].id, 0);
      queue.push(nodes[0].id);
    }

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const currLevel = levels.get(curr) || 0;
      const neighbors = adj.get(curr) || [];

      for (const next of neighbors) {
        const nextLevel = levels.get(next);
        if (nextLevel === undefined || nextLevel < currLevel + 1) {
          levels.set(next, currLevel + 1);
          queue.push(next);
        }
      }
    }

    nodes.forEach((n, idx) => {
      if (!levels.has(n.id)) {
        levels.set(n.id, idx);
      }
    });

    const levelGroups = new Map<number, FlowchartNode[]>();
    nodes.forEach((n) => {
      const lvl = levels.get(n.id) || 0;
      if (!levelGroups.has(lvl)) levelGroups.set(lvl, []);
      levelGroups.get(lvl)!.push(n);
    });

    const startX = 400;
    const startY = 80;
    const levelHeight = 140;
    const nodeGapX = 240;

    const arrangedNodes = nodes.map((n) => {
      const lvl = levels.get(n.id) || 0;
      const group = levelGroups.get(lvl) || [n];
      const indexInGroup = group.findIndex((item) => item.id === n.id);
      const groupTotal = group.length;

      const offsetX = (indexInGroup - (groupTotal - 1) / 2) * nodeGapX;
      const x = Math.round(startX + offsetX - n.width / 2);
      const y = Math.round(startY + lvl * levelHeight);

      return {
        ...n,
        x,
        y,
      };
    });

    const defaultEdges = edges.map((e) => ({
      ...e,
      arrowStyle: e.arrowStyle || "directed",
      routing: e.routing || "orthogonal",
    }));

    return { nodes: arrangedNodes, edges: defaultEdges };
  }

  static getNodeDefaultColor(type: FlowchartNodeType): string {
    switch (type) {
      case "START":
      case "END":
        return "#10b981";
      case "PROCESS":
        return "#3b82f6";
      case "DECISION":
        return "#f59e0b";
      case "DATABASE":
        return "#8b5cf6";
      case "INPUT_OUTPUT":
        return "#06b6d4";
      case "SUBPROCESS":
        return "#6366f1";
      case "NOTE":
        return "#eab308";
      default:
        return "#64748b";
    }
  }
}

import { OutlookEmailMessage } from "./outlook-mail.js";
import { TaskPriority } from "../types/index.js";
import { GoogleGenAI } from "@google/genai";

// ==========================================
// Type-Safe AI Issue & Bug Classification
// ==========================================

export type IssueCategory =
  | "BUG"
  | "ISSUE"
  | "ERROR"
  | "SECURITY"
  | "PERFORMANCE"
  | "FEATURE_REQUEST"
  | "IMPROVEMENT"
  | "INQUIRY"
  | "CASUAL_CHAT";

export type BugSeverity = "CRITICAL" | "MAJOR" | "MINOR" | "LOW";

export type BugClassification =
  | "UI_UX"
  | "BACKEND_API"
  | "DATABASE"
  | "AUTHENTICATION"
  | "NETWORK_TIMEOUT"
  | "INTEGRATION"
  | "BUSINESS_LOGIC"
  | "OTHER";

export interface TypeSafeIssueClassification {
  isTaskCandidate: boolean;
  category: IssueCategory;
  bugClassification?: BugClassification;
  severity?: BugSeverity;
  priority: TaskPriority;
  title: string;
  description: string;
  confidenceScore?: number;
  reproductionSteps?: string[];
  expectedBehavior?: string;
  actualBehavior?: string;
  affectedComponent?: string;
  tags: string[];
  reasoning: string;
  modelUsed: string;
}

// Alias for backwards compatibility
export type AIEmailAnalysisResult = TypeSafeIssueClassification;

/**
 * Panggilan Utama AI Email Classification & Bug Categorization
 * Menggunakan model Respan: Span-01 Lite via OpenRouter Decisions API
 */
export async function analyzeEmailWithAI(
  email: OutlookEmailMessage,
  options?: {
    openRouterApiKey?: string;
    model?: string;
  }
): Promise<TypeSafeIssueClassification> {
  const openRouterKey =
    options?.openRouterApiKey ||
    process.env.OPENROUTER_API_KEY

  const model =
    options?.model ||
    process.env.OPENROUTER_MODEL ||
    "respan/span-01-lite:free";

  // 1. Coba OpenRouter Decisions API dengan model Respan: Span-01 Lite
  if (openRouterKey) {
    try {
      const result = await callRespanDecisionsAPI(email, openRouterKey, model);
      if (result) return result;
    } catch (err) {
      console.warn("Panggilan OpenRouter Respan Span-01 Lite gagal, mencoba fallback:", err);
    }
  }

  // 2. Fallback ke Google Gemini API jika OpenRouter tidak ada / gagal
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (geminiApiKey) {
    try {
      const result = await callGeminiAPI(email, geminiApiKey);
      if (result) return result;
    } catch (err) {
      console.warn("Panggilan Gemini API fallback gagal, menggunakan heuristic NLP:", err);
    }
  }

  // 3. Fallback Heuristic Rule-Based NLP lokal
  return analyzeWithLocalHeuristic(email);
}

/**
 * Panggilan ke OpenRouter Decisions API untuk model Respan: Span-01 Lite
 * Mengembalikan keputusan probabilitas terkalibrasi yang 100% type-safe
 */
async function callRespanDecisionsAPI(
  email: OutlookEmailMessage,
  apiKey: string,
  model: string = "respan/span-01-lite:free"
): Promise<TypeSafeIssueClassification | null> {
  const emailContent = `${email.bodyContent || email.bodyPreview || ""}`.trim();
  const state = `Pengirim: ${email.senderName} <${email.senderEmail}>\nSubjek: ${email.subject}\nIsi Pesan:\n${emailContent}`;

  const questions = {
    is_task: {
      type: "noul",
      instructions: "Apakah email ini merupakan laporan pekerjaan, bug, error sistem, atau permintaan teknis?",
      criteria: {
        true: "Email berisi laporan bug, error, gangguan sistem, request fitur, atau instruksi pekerjaan.",
        false: "Email hanya obrolan santai, basa-basi sosial, sapaan santai, ucapan terima kasih, atau ajakan makan.",
      },
    },
    is_bug: {
      type: "noul",
      instructions: "Apakah email ini melaporkan bug atau kegagalan fungsi aplikasi?",
      criteria: {
        true: "Ada fungsi yang tidak berjalan, tombol macet, fitur error, atau hasil yang tidak sesuai.",
        false: "Bukan laporan kerusakan atau bug fungsional.",
      },
    },
    is_critical_error: {
      type: "noul",
      instructions: "Apakah terjadi error fatal, crash sistem, respon 500, atau downtime?",
      criteria: {
        true: "Sistem crash, halaman blank/rusak total, server down, atau status HTTP 500 / fatal exception.",
        false: "Bukan error fatal atau sistem crash.",
      },
    },
    is_security_issue: {
      type: "noul",
      instructions: "Apakah ada isu keamanan, kebocoran data, atau celah autentikasi?",
      criteria: {
        true: "Melaporkan celah keamanan, unauthorized access, kebocoran data, atau masalah autentikasi kritis.",
        false: "Tidak ada indikasi masalah keamanan.",
      },
    },
    is_performance_issue: {
      type: "noul",
      instructions: "Apakah ada keluhan sistem lambat, lag, atau request timeout?",
      criteria: {
        true: "Mengeluhkan respon lambat, loading lama, timeout, atau lag pada aplikasi.",
        false: "Bukan masalah performa atau kelambatan.",
      },
    },
    is_backend_api: {
      type: "noul",
      instructions: "Apakah masalah diduga berada pada backend, server, atau API?",
      criteria: {
        true: "Terkait API endpoint, respon server, logika backend, atau error HTTP.",
        false: "Bukan masalah backend API.",
      },
    },
    is_ui_ux: {
      type: "noul",
      instructions: "Apakah masalah diduga berada pada tampilan antarmuka (UI/UX), CSS, atau form input?",
      criteria: {
        true: "Tampilan berantakan, layout rusak, CSS salah, tombol tidak merespon di layar, atau visual glitch.",
        false: "Bukan masalah tampilan UI/UX.",
      },
    },
    is_database_issue: {
      type: "noul",
      instructions: "Apakah masalah berkaitan dengan query database, prisma, atau data yang hilang/duplikat?",
      criteria: {
        true: "Data tidak tersimpan di database, query lambat/gagal, atau duplikasi data.",
        false: "Bukan masalah database.",
      },
    },
    is_urgent: {
      type: "noul",
      instructions: "Apakah masalah ini mendesak dan harus segera diselesaikan?",
      criteria: {
        true: "Mendesak, mempengaruhi pengguna langsung, atau deadline segera.",
        false: "Dapat dikerjakan secara reguler tanpa urgensi darurat.",
      },
    },
  };

  const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://kinetic-task-management.local",
      "X-Title": "Kinetic Task Management",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model,
      state: state,
      questions: questions,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter Decisions API error HTTP ${response.status}: ${errorText}`);
  }

  const jsonResponse = await response.json();
  const answers = jsonResponse.answers;
  if (!answers) return null;

  // Dapatkan skor probabilitas terkalibrasi dari Respan
  const isTaskScore = answers.is_task?.noul ?? 0.5;
  const isBugScore = answers.is_bug?.noul ?? 0;
  const isCriticalScore = answers.is_critical_error?.noul ?? 0;
  const isSecurityScore = answers.is_security_issue?.noul ?? 0;
  const isPerfScore = answers.is_performance_issue?.noul ?? 0;
  const isBackendScore = answers.is_backend_api?.noul ?? 0;
  const isUiScore = answers.is_ui_ux?.noul ?? 0;
  const isDbScore = answers.is_database_issue?.noul ?? 0;
  const isUrgentScore = answers.is_urgent?.noul ?? 0;

  // Evaluasi deterministic type-safe dari skor Respan
  const isTaskCandidate = isTaskScore >= 0.45;

  let category: IssueCategory = "FEATURE_REQUEST";
  if (!isTaskCandidate) {
    category = "CASUAL_CHAT";
  } else if (isSecurityScore >= 0.6) {
    category = "SECURITY";
  } else if (isCriticalScore >= 0.65) {
    category = "ERROR";
  } else if (isBugScore >= 0.5) {
    category = "BUG";
  } else if (isPerfScore >= 0.6) {
    category = "PERFORMANCE";
  }

  // Tentukan Bug Classification
  let bugClassification: BugClassification | undefined = undefined;
  if (category === "BUG" || category === "ERROR" || category === "SECURITY" || category === "PERFORMANCE") {
    const scores = [
      { type: "UI_UX" as BugClassification, score: isUiScore },
      { type: "BACKEND_API" as BugClassification, score: isBackendScore },
      { type: "DATABASE" as BugClassification, score: isDbScore },
      { type: "AUTHENTICATION" as BugClassification, score: isSecurityScore },
      { type: "NETWORK_TIMEOUT" as BugClassification, score: isPerfScore },
    ];
    scores.sort((a, b) => b.score - a.score);
    if (scores[0].score >= 0.5) {
      bugClassification = scores[0].type;
    } else {
      bugClassification = "OTHER";
    }
  }

  // Tentukan Severity
  let severity: BugSeverity | undefined = undefined;
  if (category === "BUG" || category === "ERROR" || category === "SECURITY") {
    if (isCriticalScore >= 0.7 || isSecurityScore >= 0.7) {
      severity = "CRITICAL";
    } else if (isUrgentScore >= 0.65 || isBugScore >= 0.75) {
      severity = "MAJOR";
    } else {
      severity = "MINOR";
    }
  }

  // Tentukan Priority
  let priority: TaskPriority = "MEDIUM";
  if (isCriticalScore >= 0.65 || isSecurityScore >= 0.65 || isUrgentScore >= 0.75) {
    priority = "URGENT";
  } else if (isUrgentScore >= 0.5 || isBugScore >= 0.65) {
    priority = "HIGH";
  } else if (isTaskCandidate && isTaskScore < 0.6) {
    priority = "LOW";
  }

  // Buat title yang informatif dan terstruktur
  let titlePrefix = "";
  if (category === "BUG") titlePrefix = `[BUG${bugClassification ? ` - ${bugClassification}` : ""}] `;
  else if (category === "ERROR") titlePrefix = "[CRITICAL ERROR] ";
  else if (category === "SECURITY") titlePrefix = "[SECURITY] ";
  else if (category === "PERFORMANCE") titlePrefix = "[PERFORMANCE] ";

  const title = `${titlePrefix}${email.subject}`.trim();

  // Buat deskripsi yang rapi
  const preview = email.bodyPreview || email.bodyContent?.substring(0, 300) || "";
  const description = `${preview}\n\n*Catatan Respan AI:* Terdeteksi laporan email dari ${email.senderName}. Kategori: ${category}, Prioritas: ${priority}.`;

  const tags = [
    "outlook",
    category.toLowerCase(),
    ...(bugClassification ? [bugClassification.toLowerCase()] : []),
    ...(severity ? [`severity-${severity.toLowerCase()}`] : []),
  ];

  const confidenceScore = Math.round(
    Math.max(isTaskScore, isBugScore, isCriticalScore, isSecurityScore) * 100
  );

  return {
    isTaskCandidate,
    category,
    bugClassification,
    severity,
    priority,
    title,
    description,
    confidenceScore,
    tags,
    reasoning: `Keputusan model Respan: Span-01 Lite (Confidence: ${confidenceScore}%, Bug: ${Math.round(isBugScore * 100)}%, Error: ${Math.round(isCriticalScore * 100)}%)`,
    modelUsed: `openrouter:${jsonResponse.model || model}`,
  };
}

/**
 * Fallback panggilan Google Gemini API jika OpenRouter tidak merespons
 */
async function callGeminiAPI(
  email: OutlookEmailMessage,
  apiKey: string
): Promise<TypeSafeIssueClassification | null> {
  const prompt = `
Analisis email berikut untuk issue classification & bug categorization:
- Pengirim: ${email.senderName} <${email.senderEmail}>
- Subjek: ${email.subject}
- Isi Email: ${email.bodyContent || email.bodyPreview}

Format output HANYA JSON murni:
{
  "isTaskCandidate": boolean,
  "category": "BUG" | "ISSUE" | "ERROR" | "SECURITY" | "PERFORMANCE" | "FEATURE_REQUEST" | "CASUAL_CHAT",
  "bugClassification": "UI_UX" | "BACKEND_API" | "DATABASE" | "AUTHENTICATION" | "NETWORK_TIMEOUT" | "OTHER",
  "severity": "CRITICAL" | "MAJOR" | "MINOR" | "LOW",
  "priority": "URGENT" | "HIGH" | "MEDIUM" | "LOW",
  "title": "string",
  "description": "string",
  "tags": ["string"],
  "reasoning": "string"
}
`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    const rawText = response.text;
    if (!rawText) return null;

    const parsed = JSON.parse(rawText);
    return {
      isTaskCandidate: Boolean(parsed.isTaskCandidate),
      category: parsed.category || "ISSUE",
      bugClassification: parsed.bugClassification,
      severity: parsed.severity,
      priority: parsed.priority || "MEDIUM",
      title: parsed.title || email.subject,
      description: parsed.description || email.bodyPreview || "",
      tags: Array.isArray(parsed.tags) ? parsed.tags : ["outlook"],
      reasoning: parsed.reasoning || "Dianalisis oleh Gemini AI",
      modelUsed: "gemini-3.8-flash",
    };
  } catch {
    return null;
  }
}

/**
 * Fallback Heuristic Rule-Based NLP lokal
 */
function analyzeWithLocalHeuristic(email: OutlookEmailMessage): TypeSafeIssueClassification {
  const combined = `${email.subject} ${email.bodyPreview} ${email.bodyContent}`.toLowerCase();

  if (combined.includes("security") || combined.includes("vulnerability") || combined.includes("cve")) {
    return {
      isTaskCandidate: true,
      category: "SECURITY",
      bugClassification: "AUTHENTICATION",
      severity: "CRITICAL",
      priority: "URGENT",
      title: `[SECURITY] ${email.subject}`,
      description: `Laporan isu keamanan terdeteksi dari email: "${email.subject}".`,
      tags: ["security", "critical", "outlook"],
      reasoning: "Terdeteksi indikasi kerentanan keamanan pada email",
      modelUsed: "heuristic-nlp",
    };
  }

  const errorTriggers = ["fatal", "error 500", "status 500", "crash", "timeout", "server down"];
  if (errorTriggers.some((t) => combined.includes(t))) {
    return {
      isTaskCandidate: true,
      category: "ERROR",
      bugClassification: "BACKEND_API",
      severity: "CRITICAL",
      priority: "URGENT",
      title: `[CRITICAL ERROR] ${email.subject}`,
      description: `Terdeteksi indikasi crash sistem:\n\nSubjek: ${email.subject}`,
      tags: ["error", "critical", "backend_api", "outlook"],
      reasoning: "Mengandung kata kunci error kritis atau crash sistem produksi",
      modelUsed: "heuristic-nlp",
    };
  }

  const bugTriggers = ["bug", "tidak bisa", "gagal", "rusak", "glitch", "failed", "broken"];
  if (bugTriggers.some((t) => combined.includes(t))) {
    return {
      isTaskCandidate: true,
      category: "BUG",
      bugClassification: combined.includes("tampilan") ? "UI_UX" : "BACKEND_API",
      severity: "MAJOR",
      priority: "HIGH",
      title: `[BUG] ${email.subject}`,
      description: `Laporan bug fungsional:\n\nSubjek: ${email.subject}`,
      tags: ["bug", "outlook"],
      reasoning: "Terdeteksi laporan bug atau kegagalan fungsionalitas sistem",
      modelUsed: "heuristic-nlp",
    };
  }

  const casualTriggers = ["makan siang", "lunch", "kopi", "terima kasih", "thank you", "selamat pagi"];
  if (casualTriggers.some((t) => combined.includes(t))) {
    return {
      isTaskCandidate: false,
      category: "CASUAL_CHAT",
      priority: "LOW",
      title: email.subject,
      description: "Percakapan kasual / obrolan harian.",
      tags: ["casual"],
      reasoning: "Email teridentifikasi sebagai percakapan santai non-teknis",
      modelUsed: "heuristic-nlp",
    };
  }

  return {
    isTaskCandidate: true,
    category: "FEATURE_REQUEST",
    priority: "MEDIUM",
    title: email.subject,
    description: email.bodyPreview || email.bodyContent?.substring(0, 200) || "",
    tags: ["task", "outlook"],
    reasoning: "Email berisi permintaan atau instruksi kerja dari anggota tim",
    modelUsed: "heuristic-nlp",
  };
}

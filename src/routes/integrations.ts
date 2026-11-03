import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { fetchOutlookEmails } from "../lib/outlook-mail.js";
import { analyzeEmailWithAI, TypeSafeIssueClassification } from "../lib/ai-outlook-service.js";
import { createTask, getProjects, getUsers } from "../lib/data-service.js";

const router = Router();

const SETTING_KEY = "outlook_scheduler_config";
export const OUTLOOK_ISSUES_PROJECT_NAME = "Issues from Outlook";

// Default schedule adalah OFF (enabled: false) sesuai kebutuhan spesifikasi
const DEFAULT_CONFIG = {
  enabled: false,
  mode: "interval",
  intervalMinutes: 30,
  scheduledTime: "09:00",
};

/**
 * Mencari atau otomatis membuat project "Issues from Outlook" di workspace yang bersangkutan
 */
export async function getOrCreateOutlookIssuesProject(workspaceId: string): Promise<any> {
  if (!workspaceId) return null;

  // Cari project di workspace tersebut (case-insensitive)
  let project = await prisma.project.findFirst({
    where: {
      workspaceId,
      name: {
        equals: OUTLOOK_ISSUES_PROJECT_NAME,
        mode: "insensitive",
      },
    },
  });

  if (!project) {
    project = await prisma.project.create({
      data: {
        name: OUTLOOK_ISSUES_PROJECT_NAME,
        description: "Project otomatis untuk klasifikasi issue dan bug dari schedule email Outlook via AI Respan Span-01 Lite",
        color: "#0078d4", // Warna biru Microsoft Outlook
        icon: "Mail",
        workspaceId,
      },
    });
  }

  return project;
}

// Scheduler config: GET
router.get("/outlook/scheduler", async (_req: Request, res: Response) => {
  try {
    const record = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEY },
    });

    if (record?.value) {
      try {
        const parsed = JSON.parse(record.value);
        return res.json({ ...DEFAULT_CONFIG, ...parsed });
      } catch {}
    }

    return res.json(DEFAULT_CONFIG);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Scheduler config: POST (Menyimpan config dan otomatis membuat project "Issues from Outlook" jika dihidupkan)
router.post("/outlook/scheduler", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const workspaceId = body.workspaceId as string | undefined;

    const record = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEY },
    });

    let current = DEFAULT_CONFIG;
    if (record?.value) {
      try {
        current = { ...DEFAULT_CONFIG, ...JSON.parse(record.value) };
      } catch {}
    }

    const updated = { ...current, ...body };

    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEY },
      update: { value: JSON.stringify(updated) },
      create: { key: SETTING_KEY, value: JSON.stringify(updated) },
    });

    // Jika schedule dihidupkan (enabled: true) dan ada workspaceId, otomatis buat project "Issues from Outlook"
    let issuesProject = null;
    if (updated.enabled && workspaceId) {
      try {
        issuesProject = await getOrCreateOutlookIssuesProject(workspaceId);
      } catch (projErr) {
        console.warn("Gagal otomatis membuat project Issues from Outlook:", projErr);
      }
    }

    return res.json({
      success: true,
      config: updated,
      project: issuesProject,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Outlook Sync: Ekstraksi email dengan Type-Safe AI Classification & Bug Categorization
router.post("/outlook/sync", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const {
      workspaceId,
      projectId,
      memberEmails = [],
      accessToken,
      isScheduled = false,
    } = body;

    let targetEmails: string[] = memberEmails;
    if (targetEmails.length === 0) {
      const allUsers = await getUsers();
      targetEmails = allUsers.map((u) => u.email).filter(Boolean);
    }

    let targetProjectId = projectId;
    let targetWsId = workspaceId;

    // Jika sinkronisasi berasal dari schedule, wajib masukkan ke project "Issues from Outlook"
    if (isScheduled && targetWsId) {
      const issuesProj = await getOrCreateOutlookIssuesProject(targetWsId);
      if (issuesProj) {
        targetProjectId = issuesProj.id;
      }
    }

    if (!targetProjectId) {
      if (targetWsId) {
        const issuesProj = await getOrCreateOutlookIssuesProject(targetWsId);
        targetProjectId = issuesProj?.id;
      }
      if (!targetProjectId) {
        const allProjects = await getProjects();
        const projects = targetWsId
          ? allProjects.filter((p) => p.workspaceId === targetWsId)
          : allProjects;
        targetProjectId = projects[0]?.id || allProjects[0]?.id || "prj-1";
      }
    }

    const emails = await fetchOutlookEmails({
      memberEmails: targetEmails,
      accessToken,
    });

    const createdTasks = [];
    const skippedEmails = [];

    for (const email of emails) {
      // Analisis email menggunakan Type-Safe AI (Respan: Span-01 Lite via OpenRouter)
      const analysis: TypeSafeIssueClassification = await analyzeEmailWithAI(email);

      if (analysis.isTaskCandidate) {
        // Susun deskripsi terstruktur yang informatif
        const descSections: string[] = [analysis.description];

        if (analysis.bugClassification || analysis.severity || analysis.affectedComponent) {
          descSections.push("### 🔍 Detail Klasifikasi AI");
          if (analysis.category) descSections.push(`- **Kategori:** \`${analysis.category}\``);
          if (analysis.bugClassification) descSections.push(`- **Klasifikasi Bug:** \`${analysis.bugClassification}\``);
          if (analysis.severity) descSections.push(`- **Tingkat Keparahan (Severity):** \`${analysis.severity}\``);
          if (analysis.affectedComponent) descSections.push(`- **Komponen Terdampak:** \`${analysis.affectedComponent}\``);
        }

        if (analysis.reproductionSteps && analysis.reproductionSteps.length > 0) {
          descSections.push("### 🧪 Langkah Reproduksi");
          analysis.reproductionSteps.forEach((step, idx) => {
            descSections.push(`${idx + 1}. ${step}`);
          });
        }

        if (analysis.expectedBehavior || analysis.actualBehavior) {
          descSections.push("### ⚖️ Perbandingan Perilaku");
          if (analysis.expectedBehavior) descSections.push(`- **Ekspektasi:** ${analysis.expectedBehavior}`);
          if (analysis.actualBehavior) descSections.push(`- **Kenyataan:** ${analysis.actualBehavior}`);
        }

        descSections.push(
          `---\n*Sumber: Email Outlook dari ${email.senderName} (${email.senderEmail})*\n*Subjek: "${email.subject}"*\n*Model AI:* \`${analysis.modelUsed}\`\n*Alasan Klasifikasi:* ${analysis.reasoning}`
        );

        const fullDesc = descSections.join("\n\n");

        // Susun tags terpadu
        const tagSet = new Set<string>([
          "outlook",
          analysis.category.toLowerCase(),
          ...(analysis.bugClassification ? [analysis.bugClassification.toLowerCase()] : []),
          ...(analysis.tags || []),
        ]);

        const task = await createTask({
          title: analysis.title,
          description: fullDesc,
          status: "BACKLOG",
          priority: analysis.priority,
          projectId: targetProjectId,
          tags: Array.from(tagSet),
        });

        createdTasks.push({
          task,
          category: analysis.category,
          bugClassification: analysis.bugClassification,
          severity: analysis.severity,
          reasoning: analysis.reasoning,
          modelUsed: analysis.modelUsed,
          originalEmail: email,
        });
      } else {
        skippedEmails.push({
          subject: email.subject,
          sender: `${email.senderName} (${email.senderEmail})`,
          category: analysis.category,
          reason: analysis.reasoning,
        });
      }
    }

    return res.json({
      success: true,
      totalScanned: emails.length,
      createdCount: createdTasks.length,
      skippedCount: skippedEmails.length,
      targetProjectId,
      createdTasks,
      skippedEmails,
    });
  } catch (error: any) {
    console.error("Error saat sinkronisasi email Outlook:", error);
    return res.status(500).json({
      error: error?.message || "Gagal memproses sinkronisasi email Outlook",
    });
  }
});

export default router;

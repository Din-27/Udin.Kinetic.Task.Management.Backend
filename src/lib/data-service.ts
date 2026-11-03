import { prisma } from "./prisma.js";
import {
  Task,
  Project,
  User,
  Workspace,
  UserRole,
  ChatMessage,
  TaskStatus,
  TaskPriority,
  TaskVisibility,
  Subtask,
  TaskComment,
  CommentAttachment,
  getDefaultAvatar,
} from "../types/index.js";

export function mapDbUser(u: {
  id: string;
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
  image?: string | null;
  role?: string | null;
}): User {
  const role: UserRole = (u.role === "ADMIN" || u.role === "VIEWER" || u.role === "MEMBER"
    ? u.role
    : "MEMBER") as UserRole;
  const title = role === "ADMIN" ? "Product Lead (Admin)" : role === "VIEWER" ? "Viewer / Guest" : "Engineer";

  const resolvedName = u.name || (u.email ? u.email.split("@")[0] : "User");
  const resolvedEmail = u.email || "";

  return {
    id: u.id,
    name: resolvedName,
    email: resolvedEmail,
    avatar: u.avatar || u.image || getDefaultAvatar(resolvedName, resolvedEmail),
    role,
    title,
  };
}

export interface TaskMetadata {
  collaboratorIds?: string[];
  tags?: string[];
  visibility?: TaskVisibility;
}

export async function getTaskMetadataMap(taskIds: string[]): Promise<Map<string, TaskMetadata>> {
  const map = new Map<string, TaskMetadata>();
  if (!taskIds.length) return map;

  try {
    const records = await prisma.taskMeta.findMany({
      where: { taskId: { in: taskIds } },
    });

    for (const r of records) {
      map.set(r.taskId, {
        collaboratorIds: Array.isArray(r.collaboratorIds) ? (r.collaboratorIds as string[]) : [],
        tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
        visibility: (r.visibility as TaskVisibility) || "WORKSPACE",
      });
    }
  } catch (err) {
    console.error("Error fetching task metadata:", err);
  }

  return map;
}

export async function saveTaskMetadata(
  taskId: string,
  updates: Partial<TaskMetadata>
): Promise<TaskMetadata> {
  let existingMeta: TaskMetadata = {};

  try {
    const existing = await prisma.taskMeta.findUnique({ where: { taskId } });
    if (existing) {
      existingMeta = {
        collaboratorIds: Array.isArray(existing.collaboratorIds) ? (existing.collaboratorIds as string[]) : [],
        tags: Array.isArray(existing.tags) ? (existing.tags as string[]) : [],
        visibility: (existing.visibility as TaskVisibility) || "WORKSPACE",
      };
    }
  } catch {}

  const mergedMeta: TaskMetadata = {
    ...existingMeta,
    ...(updates.collaboratorIds !== undefined ? { collaboratorIds: updates.collaboratorIds } : {}),
    ...(updates.tags !== undefined ? { tags: updates.tags } : {}),
    ...(updates.visibility !== undefined ? { visibility: updates.visibility } : {}),
  };

  try {
    await prisma.taskMeta.upsert({
      where: { taskId },
      create: {
        taskId,
        collaboratorIds: mergedMeta.collaboratorIds || [],
        tags: mergedMeta.tags || [],
        visibility: mergedMeta.visibility || "WORKSPACE",
      },
      update: {
        ...(updates.collaboratorIds !== undefined ? { collaboratorIds: updates.collaboratorIds } : {}),
        ...(updates.tags !== undefined ? { tags: updates.tags } : {}),
        ...(updates.visibility !== undefined ? { visibility: updates.visibility } : {}),
      },
    });
  } catch (err) {
    console.error(`Error saving task metadata for ${taskId}:`, err);
  }

  return mergedMeta;
}

export function mapDbTask(t: any, meta?: TaskMetadata): Task {
  return {
    id: t.id,
    title: t.title,
    description: t.description || "",
    status: t.status as TaskStatus,
    priority: t.priority as TaskPriority,
    visibility: meta?.visibility || (t.visibility as TaskVisibility) || "PUBLIC",
    tags: meta?.tags || (Array.isArray(t.tags) ? t.tags : []),
    collaboratorIds: meta?.collaboratorIds || (Array.isArray(t.collaboratorIds) ? t.collaboratorIds : []),
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    order: t.order ?? 0,
    completed: Boolean(t.completed),
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    projectId: t.projectId,
    creatorId: t.creatorId,
    assigneeId: t.assigneeId || null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    assignee: t.assignee ? mapDbUser(t.assignee) : null,
    creator: t.creator ? mapDbUser(t.creator) : undefined,
    subtasks: (t.subtasks || []).map((s: any) => ({
      id: s.id,
      title: s.title,
      completed: Boolean(s.completed),
      taskId: s.taskId,
    })),
    comments: (t.comments || []).map((c: any) => ({
      id: c.id,
      content: c.content,
      taskId: c.taskId,
      userId: c.userId,
      createdAt: c.createdAt.toISOString(),
      user: c.user ? mapDbUser(c.user) : undefined,
    })),
    activities: (t.activities || []).map((a: any) => ({
      id: a.id,
      action: a.action,
      details: a.details || undefined,
      taskId: a.taskId,
      userId: a.userId,
      createdAt: a.createdAt.toISOString(),
      user: a.user ? mapDbUser(a.user) : undefined,
    })),
  };
}

export async function checkNeonConnection(): Promise<{ connected: boolean; message: string; tableCount?: number }> {
  if (!process.env.DATABASE_URL) {
    return {
      connected: false,
      message: "DATABASE_URL belum diatur di file .env.",
    };
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    const count = await prisma.task.count().catch(() => 0);
    return {
      connected: true,
      message: "Terhubung ke Neon Tech PostgreSQL!",
      tableCount: count,
    };
  } catch (error: any) {
    return {
      connected: false,
      message: `Gagal terkoneksi ke Neon: ${error?.message || "Koneksi ditolak"}`,
    };
  }
}

export async function getWorkspaces(userId?: string, userEmail?: string): Promise<Workspace[]> {
  try {
    let whereClause: any = undefined;

    if (userId || userEmail) {
      const cleanEmail = userEmail?.trim().toLowerCase();
      whereClause = {
        OR: [
          ...(userId ? [{ createdBy: userId }] : []),
          ...(cleanEmail ? [{ createdBy: cleanEmail }] : []),
          {
            members: {
              some: {
                OR: [
                  ...(userId ? [{ userId }] : []),
                  ...(cleanEmail ? [{ user: { email: cleanEmail } }] : []),
                ],
              },
            },
          },
        ],
      };
    }

    const dbWorkspaces = await (prisma.workspace as any).findMany({
      where: whereClause,
      orderBy: { createdAt: "asc" },
    });

    return dbWorkspaces.map((w: any) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      description: w.description || "",
      color: w.color || "#6366f1",
      createdBy: w.createdBy || undefined,
    }));
  } catch (err) {
    console.error("Error fetching workspaces from database:", err);
    return [];
  }
}

export async function createWorkspace(data: {
  id?: string;
  name: string;
  slug?: string;
  description?: string;
  color?: string;
  createdBy?: string;
  creator?: { id: string; name?: string; email?: string; avatar?: string };
}): Promise<Workspace> {
  const cleanName = data.name.trim();
  const rawSlug = data.slug?.trim() || cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  let slug = rawSlug || `ws-${Date.now()}`;
  const wsId = data.id?.trim() || `ws-${Date.now()}`;
  const creatorId = data.creator?.id || data.createdBy || undefined;

  const existingWithSlug = await prisma.workspace.findUnique({
    where: { slug },
  }).catch(() => null);

  if (existingWithSlug && existingWithSlug.id !== wsId) {
    slug = `${slug}-${Date.now().toString().slice(-4)}`;
  }

  const created = await (prisma.workspace as any).upsert({
    where: { id: wsId },
    update: {
      name: cleanName,
      slug,
      description: data.description || "",
      color: data.color || "#6366f1",
      ...(creatorId ? { createdBy: creatorId } : {}),
    },
    create: {
      id: wsId,
      name: cleanName,
      slug,
      description: data.description || "",
      color: data.color || "#6366f1",
      createdBy: creatorId,
    },
  });

  if (data.creator?.id) {
    try {
      await prisma.user.upsert({
        where: { id: data.creator.id },
        update: {
          ...(data.creator.name ? { name: data.creator.name } : {}),
          ...(data.creator.email ? { email: data.creator.email } : {}),
          role: "ADMIN",
        },
        create: {
          id: data.creator.id,
          name: data.creator.name || "Admin",
          email: data.creator.email || undefined,
          avatar: data.creator.avatar,
          role: "ADMIN",
        },
      });

      await prisma.workspaceMember.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: created.id,
            userId: data.creator.id,
          },
        },
        update: { role: "ADMIN" },
        create: {
          workspaceId: created.id,
          userId: data.creator.id,
          role: "ADMIN",
        },
      });
    } catch (memErr) {
      console.warn("Failed to associate creator member in DB:", memErr);
    }
  }

  return {
    id: created.id,
    name: created.name,
    slug: created.slug,
    description: created.description || "",
    color: created.color || data.color || "#6366f1",
    createdBy: (created as any).createdBy || creatorId || undefined,
  };
}

export async function updateWorkspace(id: string, updates: Partial<Workspace>): Promise<Workspace | null> {
  try {
    const updated = await prisma.workspace.update({
      where: { id },
      data: {
        ...(updates.name ? { name: updates.name.trim() } : {}),
        ...(updates.slug ? { slug: updates.slug.trim() } : {}),
        ...(updates.description !== undefined ? { description: updates.description } : {}),
        ...(updates.color ? { color: updates.color } : {}),
      },
    });
    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      description: updated.description || "",
      color: updated.color || "#6366f1",
    };
  } catch (err) {
    console.error("Error updating workspace in database:", err);
    return null;
  }
}

export async function deleteWorkspace(id: string): Promise<boolean> {
  try {
    const projects = await prisma.project.findMany({ where: { workspaceId: id }, select: { id: true } });
    const projectIds = projects.map((p) => p.id);
    if (projectIds.length > 0) {
      await prisma.subtask.deleteMany({ where: { task: { projectId: { in: projectIds } } } }).catch(() => {});
      await prisma.taskComment.deleteMany({ where: { task: { projectId: { in: projectIds } } } }).catch(() => {});
      await prisma.activityLog.deleteMany({ where: { task: { projectId: { in: projectIds } } } }).catch(() => {});
      await prisma.task.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
      await prisma.project.deleteMany({ where: { workspaceId: id } }).catch(() => {});
    }
    await prisma.chatMessage.deleteMany({ where: { workspaceId: id } }).catch(() => {});
    await prisma.workspaceMember.deleteMany({ where: { workspaceId: id } }).catch(() => {});
    await prisma.workspace.delete({ where: { id } });
    return true;
  } catch (err) {
    console.error("Error deleting workspace in database:", err);
    return false;
  }
}

export async function getProjects(workspaceId?: string): Promise<Project[]> {
  try {
    const where: any = {};
    if (workspaceId && workspaceId.trim() !== "" && workspaceId !== "all") {
      where.workspaceId = workspaceId.trim();
    }

    const dbProjects = await prisma.project.findMany({
      where,
      include: {
        _count: {
          select: { tasks: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return dbProjects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || "",
      color: p.color,
      icon: p.icon,
      workspaceId: p.workspaceId,
      taskCount: p._count.tasks,
    }));
  } catch (err) {
    console.error("Error fetching projects from database:", err);
    return [];
  }
}

export async function createProject(data: {
  id?: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  workspaceId?: string;
}): Promise<Project> {
  let targetWsId = data.workspaceId;
  if (!targetWsId) {
    const firstWs = await prisma.workspace.findFirst();
    if (firstWs) {
      targetWsId = firstWs.id;
    } else {
      throw new Error("Workspace tidak ditemukan. Silakan buat workspace terlebih dahulu.");
    }
  } else {
    const wsExists = await prisma.workspace.findUnique({ where: { id: targetWsId } });
    if (!wsExists) {
      throw new Error(`Workspace dengan ID "${targetWsId}" tidak ditemukan.`);
    }
  }

  const projId = data.id?.trim() || `proj-${Date.now()}`;

  const created = await prisma.project.create({
    data: {
      id: projId,
      name: data.name.trim(),
      description: data.description?.trim() || "",
      color: data.color || "#6366f1",
      icon: data.icon || "FolderKanban",
      workspaceId: targetWsId,
    },
  });

  return {
    id: created.id,
    name: created.name,
    description: created.description || "",
    color: created.color,
    icon: created.icon,
    workspaceId: created.workspaceId,
    taskCount: 0,
  };
}

export async function getProjectById(id: string): Promise<Project | null> {
  try {
    const p = await prisma.project.findUnique({
      where: { id },
      include: {
        _count: {
          select: { tasks: true },
        },
      },
    });
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      description: p.description || "",
      color: p.color,
      icon: p.icon,
      workspaceId: p.workspaceId,
      taskCount: p._count.tasks,
    };
  } catch (err) {
    console.error("Error fetching project by ID:", err);
    return null;
  }
}

export async function updateProject(
  id: string,
  data: { name?: string; description?: string; color?: string; icon?: string }
): Promise<Project | null> {
  try {
    const updated = await prisma.project.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.color ? { color: data.color } : {}),
        ...(data.icon ? { icon: data.icon } : {}),
      },
      include: {
        _count: {
          select: { tasks: true },
        },
      },
    });
    return {
      id: updated.id,
      name: updated.name,
      description: updated.description || "",
      color: updated.color,
      icon: updated.icon,
      workspaceId: updated.workspaceId,
      taskCount: updated._count.tasks,
    };
  } catch (err) {
    console.error("Error updating project in database:", err);
    return null;
  }
}

export async function deleteProject(id: string): Promise<boolean> {
  try {
    await prisma.chatMessage.deleteMany({ where: { projectId: id } }).catch(() => {});
    await prisma.subtask.deleteMany({ where: { task: { projectId: id } } }).catch(() => {});
    await prisma.taskComment.deleteMany({ where: { task: { projectId: id } } }).catch(() => {});
    await prisma.activityLog.deleteMany({ where: { task: { projectId: id } } }).catch(() => {});
    await prisma.task.deleteMany({ where: { projectId: id } }).catch(() => {});
    await prisma.project.delete({ where: { id } });
    return true;
  } catch (err) {
    console.error("Error deleting project in database:", err);
    return false;
  }
}

export async function getTasks(
  projectId?: string,
  search?: string,
  status?: string,
  workspaceId?: string
): Promise<Task[]> {
  try {
    const where: any = {};
    if (projectId && projectId !== "all") {
      where.projectId = projectId;
    } else if (workspaceId && workspaceId !== "all") {
      where.project = { workspaceId };
    }
    if (status && status !== "ALL") where.status = status as any;
    if (search && search.trim() !== "") {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const dbTasks = await prisma.task.findMany({
      where,
      include: {
        assignee: true,
        creator: true,
        subtasks: { orderBy: { createdAt: "asc" } },
        comments: {
          include: { user: true },
          orderBy: { createdAt: "asc" },
        },
        activities: {
          include: { user: true },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    });

    const metaMap = await getTaskMetadataMap(dbTasks.map((t) => t.id));
    return dbTasks.map((t) => mapDbTask(t, metaMap.get(t.id)));
  } catch (err) {
    console.error("Error fetching tasks from database:", err);
    return [];
  }
}

export async function getTaskById(taskId: string): Promise<Task | null> {
  try {
    const dbTask = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignee: true,
        creator: true,
        subtasks: { orderBy: { createdAt: "asc" } },
        comments: {
          include: { user: true },
          orderBy: { createdAt: "asc" },
        },
        activities: {
          include: { user: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!dbTask) return null;
    const metaMap = await getTaskMetadataMap([taskId]);
    return mapDbTask(dbTask, metaMap.get(taskId));
  } catch (err) {
    console.error("Error fetching task by ID from database:", err);
    return null;
  }
}

export async function createTask(data: {
  id?: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  projectId: string;
  assigneeId?: string | null;
  creatorId?: string;
  visibility?: TaskVisibility;
  tags?: string[];
  collaboratorIds?: string[];
}): Promise<Task> {
  let targetProjectId = data.projectId;
  const existingProj = await prisma.project.findUnique({ where: { id: targetProjectId } });
  if (!existingProj) {
    throw new Error(`Project dengan ID "${targetProjectId}" tidak ditemukan. Silakan pilih project yang valid.`);
  }

  let validCreatorId = data.creatorId;
  if (validCreatorId) {
    const userExists = await prisma.user.findUnique({ where: { id: validCreatorId } });
    if (!userExists) {
      const firstUser = await prisma.user.findFirst();
      validCreatorId = firstUser?.id;
    }
  }
  if (!validCreatorId) {
    const firstUser = await prisma.user.findFirst();
    if (firstUser) {
      validCreatorId = firstUser.id;
    } else {
      const newUser = await prisma.user.create({
        data: { id: `usr-${Date.now()}`, name: "Lead", role: "ADMIN" },
      });
      validCreatorId = newUser.id;
    }
  }

  let validAssigneeId = data.assigneeId || null;
  if (validAssigneeId) {
    const assigneeExists = await prisma.user.findUnique({ where: { id: validAssigneeId } });
    if (!assigneeExists) {
      validAssigneeId = null;
    }
  }

  const taskId = data.id?.trim() || `task-${Date.now()}`;
  const status = (data.status || "TODO") as any;
  const priority = (data.priority || "MEDIUM") as any;
  const isDone = data.status === "DONE";

  const taskOrder = await prisma.task.count({
    where: { projectId: targetProjectId, status },
  });

  const created = await prisma.task.create({
    data: {
      id: taskId,
      title: data.title.trim(),
      description: data.description || "",
      status,
      priority,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      order: taskOrder,
      completed: isDone,
      completedAt: isDone ? new Date() : null,
      projectId: targetProjectId,
      creatorId: validCreatorId,
      assigneeId: validAssigneeId,
      activities: {
        create: {
          action: "Created task",
          userId: validCreatorId,
        },
      },
    },
    include: {
      assignee: true,
      creator: true,
      subtasks: { orderBy: { createdAt: "asc" } },
      comments: {
        include: { user: true },
        orderBy: { createdAt: "asc" },
      },
      activities: {
        include: { user: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (data.collaboratorIds || data.tags || data.visibility) {
    await saveTaskMetadata(taskId, {
      collaboratorIds: data.collaboratorIds,
      tags: data.tags,
      visibility: data.visibility,
    });
  }

  const metaMap = await getTaskMetadataMap([created.id]);
  return mapDbTask(created, metaMap.get(created.id));
}

export async function updateTask(
  taskId: string,
  updates: Partial<Task>,
  currentUserId?: string
): Promise<Task | null> {
  try {
    const existing = await prisma.task.findUnique({
      where: { id: taskId },
    });
    if (!existing) return null;

    let validAssigneeId: string | null | undefined = undefined;
    if (updates.assigneeId !== undefined) {
      if (updates.assigneeId) {
        const u = await prisma.user.findUnique({ where: { id: updates.assigneeId } });
        validAssigneeId = u ? u.id : null;
      } else {
        validAssigneeId = null;
      }
    }

    const data: any = {};
    if (updates.title !== undefined) data.title = updates.title.trim();
    if (updates.description !== undefined) data.description = updates.description;
    if (updates.status !== undefined) data.status = updates.status as any;
    if (updates.priority !== undefined) data.priority = updates.priority as any;
    if (updates.dueDate !== undefined) data.dueDate = updates.dueDate ? new Date(updates.dueDate) : null;
    if (updates.order !== undefined) data.order = updates.order;
    if (updates.completed !== undefined) data.completed = updates.completed;
    if (updates.completedAt !== undefined) data.completedAt = updates.completedAt ? new Date(updates.completedAt) : null;
    if (validAssigneeId !== undefined) data.assigneeId = validAssigneeId;

    if (updates.status && updates.status !== existing.status) {
      if (updates.status === "DONE") {
        data.completed = true;
        data.completedAt = new Date();
      } else {
        data.completed = false;
        data.completedAt = null;
      }
    }

    let updatedMeta: TaskMetadata | undefined = undefined;
    if (
      updates.collaboratorIds !== undefined ||
      updates.tags !== undefined ||
      updates.visibility !== undefined
    ) {
      updatedMeta = await saveTaskMetadata(taskId, {
        collaboratorIds: updates.collaboratorIds,
        tags: updates.tags,
        visibility: updates.visibility,
      });
    } else {
      const metaMap = await getTaskMetadataMap([taskId]);
      updatedMeta = metaMap.get(taskId);
    }

    const updated = await prisma.task.update({
      where: { id: taskId },
      data,
      include: {
        assignee: true,
        creator: true,
        subtasks: { orderBy: { createdAt: "asc" } },
        comments: {
          include: { user: true },
          orderBy: { createdAt: "asc" },
        },
        activities: {
          include: { user: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (updates.status && updates.status !== existing.status && currentUserId) {
      const userExists = await prisma.user.findUnique({ where: { id: currentUserId } });
      if (userExists) {
        await prisma.activityLog.create({
          data: {
            action: `Changed status to ${updates.status}`,
            taskId,
            userId: currentUserId,
          },
        }).catch(() => {});
      }
    }

    return mapDbTask(updated, updatedMeta);
  } catch (err) {
    console.error("Error updating task in database:", err);
    return null;
  }
}

export async function deleteTask(taskId: string): Promise<boolean> {
  try {
    await prisma.taskMeta.delete({ where: { taskId } }).catch(() => {});
    await prisma.subtask.deleteMany({ where: { taskId } }).catch(() => {});
    await prisma.taskComment.deleteMany({ where: { taskId } }).catch(() => {});
    await prisma.activityLog.deleteMany({ where: { taskId } }).catch(() => {});
    await prisma.task.delete({ where: { id: taskId } });
    return true;
  } catch (err) {
    console.error("Error deleting task in database:", err);
    return false;
  }
}

export async function addSubtask(taskId: string, title: string): Promise<Subtask> {
  const created = await prisma.subtask.create({
    data: {
      id: `sub-${Date.now()}`,
      title: title.trim(),
      completed: false,
      taskId,
    },
  });
  return {
    id: created.id,
    title: created.title,
    completed: created.completed,
    taskId: created.taskId,
  };
}

export async function toggleSubtask(subtaskId: string, completed: boolean): Promise<boolean> {
  try {
    await prisma.subtask.update({
      where: { id: subtaskId },
      data: { completed },
    });
    return true;
  } catch (err) {
    console.error("Error toggling subtask in database:", err);
    return false;
  }
}

export async function addComment(
  taskId: string,
  content: string,
  userId: string,
  attachments?: CommentAttachment[],
  id?: string
): Promise<TaskComment> {
  let validUserId = userId;
  const userExists = await prisma.user.findUnique({ where: { id: userId } });
  if (!userExists) {
    const firstUser = await prisma.user.findFirst();
    if (firstUser) {
      validUserId = firstUser.id;
    }
  }

  const created = await prisma.taskComment.create({
    data: {
      id: id || `comm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      content: content.trim(),
      taskId,
      userId: validUserId,
    },
    include: {
      user: true,
    },
  });

  return {
    id: created.id,
    content: created.content,
    taskId: created.taskId,
    userId: created.userId,
    createdAt: created.createdAt.toISOString(),
    user: created.user ? mapDbUser(created.user) : undefined,
    attachments: attachments || [],
  };
}

export async function getChatMessages(
  workspaceId?: string,
  projectId?: string | null,
  type?: "PROJECT_CHAT" | "TEAM_DISCUSSION" | string
): Promise<ChatMessage[]> {
  try {
    const where: any = {};
    if (workspaceId && workspaceId.trim() !== "") {
      where.workspaceId = workspaceId;
    }

    // Pembedaan ketat berdasarkan kolom type di database
    if (type) {
      where.type = type;
    }

    // Isolasi ketat: jika project chat, hanya ambil milik project terkait
    if (projectId && projectId !== "all" && projectId !== "undefined") {
      where.projectId = projectId;
      if (!type) where.type = "PROJECT_CHAT";
    } else if (projectId === "null" || type === "TEAM_DISCUSSION") {
      if (!type) where.type = "TEAM_DISCUSSION";
    }

    const dbChat = await prisma.chatMessage.findMany({
      where,
      include: { sender: true },
      orderBy: { createdAt: "asc" },
    });

    return dbChat.map((m) => ({
      id: m.id,
      content: m.content,
      workspaceId: m.workspaceId,
      projectId: m.projectId,
      senderId: m.senderId,
      type: (m.type as "PROJECT_CHAT" | "TEAM_DISCUSSION") || "PROJECT_CHAT",
      createdAt: m.createdAt.toISOString(),
      sender: m.sender ? mapDbUser(m.sender) : undefined,
    }));
  } catch (err) {
    console.error("Error fetching chat messages from database:", err);
    return [];
  }
}

export async function sendChatMessage(
  content: string,
  senderId: string,
  projectId?: string | null,
  workspaceId?: string,
  id?: string,
  type: "PROJECT_CHAT" | "TEAM_DISCUSSION" = "PROJECT_CHAT"
): Promise<ChatMessage> {
  let targetWsId = workspaceId;
  if (!targetWsId && projectId) {
    const p = await prisma.project.findUnique({ where: { id: projectId } });
    if (p) targetWsId = p.workspaceId;
  }
  if (!targetWsId) {
    const firstWs = await prisma.workspace.findFirst();
    if (firstWs) {
      targetWsId = firstWs.id;
    } else {
      throw new Error("Workspace tidak ditemukan untuk pengiriman chat.");
    }
  }

  let validSenderId = senderId;
  const existingUser = await prisma.user.findUnique({ where: { id: senderId } });
  if (!existingUser) {
    const firstUser = await prisma.user.findFirst();
    if (firstUser) {
      validSenderId = firstUser.id;
    } else {
      const createdUser = await prisma.user.create({
        data: {
          id: senderId,
          name: "User",
          role: "ADMIN",
        },
      });
      validSenderId = createdUser.id;
    }
  }

  const determinedType = type || (projectId ? "PROJECT_CHAT" : "TEAM_DISCUSSION");

  const created = await prisma.chatMessage.create({
    data: {
      id: id || `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      content: content.trim(),
      workspaceId: targetWsId,
      projectId: projectId || null,
      senderId: validSenderId,
      type: determinedType,
    },
    include: {
      sender: true,
    },
  });

  return {
    id: created.id,
    content: created.content,
    workspaceId: created.workspaceId,
    projectId: created.projectId,
    senderId: created.senderId,
    type: (created.type as "PROJECT_CHAT" | "TEAM_DISCUSSION") || "PROJECT_CHAT",
    createdAt: created.createdAt.toISOString(),
    sender: created.sender ? mapDbUser(created.sender) : undefined,
  };
}

export async function getUsers(): Promise<User[]> {
  try {
    const dbUsers = await prisma.user.findMany({ orderBy: { name: "asc" } });
    return dbUsers.map(mapDbUser);
  } catch (err) {
    console.error("Error fetching users from database:", err);
    return [];
  }
}

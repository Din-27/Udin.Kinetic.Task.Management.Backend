export type UserRole = "ADMIN" | "MEMBER" | "VIEWER";

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: UserRole;
  title: string;
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  taskId: string;
}

export interface CommentAttachment {
  id: string;
  type: "image" | "file" | "audio";
  url: string;
  name: string;
  size?: string;
  duration?: number;
}

export interface TaskComment {
  id: string;
  content: string;
  taskId: string;
  userId: string;
  createdAt: string;
  user?: User;
  attachments?: CommentAttachment[];
}

export interface ActivityLog {
  id: string;
  action: string;
  details?: string;
  taskId: string;
  userId: string;
  createdAt: string;
  user?: User;
}

export type TaskStatus = "BACKLOG" | "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | (string & {});
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type TaskVisibility = "PUBLIC" | "PRIVATE";

export interface BoardColumn {
  id: string;
  workspaceId: string;
  status: string;
  label: string;
  color: string;
  order: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  visibility?: TaskVisibility;
  tags?: string[];
  collaboratorIds?: string[];
  collaborators?: User[];
  dueDate: string | null;
  order: number;
  completed: boolean;
  completedAt?: string | null;
  projectId: string;
  creatorId: string;
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
  assignee?: User | null;
  creator?: User;
  subtasks: Subtask[];
  comments: TaskComment[];
  activities: ActivityLog[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  workspaceId: string;
  taskCount?: number;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string;
  color?: string;
  createdBy?: string;
  ownerId?: string;
}

export interface ChatMessage {
  id: string;
  content: string;
  workspaceId: string;
  projectId?: string | null;
  senderId: string;
  type?: "PROJECT_CHAT" | "TEAM_DISCUSSION";
  createdAt: string;
  sender?: User;
}

export function getDefaultAvatar(name: string, email?: string): string {
  const seed = (email || name || "User").toLowerCase().trim();
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

export interface WorkspaceInvitation {
  id: string;
  token: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  name: string;
  role: UserRole;
  title: string;
  invitedBy: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
}

export interface JoinRequest {
  id: string;
  workspaceId: string;
  workspaceName: string;
  userId: string;
  userName: string;
  userEmail: string;
  userAvatar?: string;
  requestedAt: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
}


import { Router } from "express";
import workspacesRouter from "./workspaces.js";
import workspaceMembersRouter from "./workspace-members.js";
import projectsRouter from "./projects.js";
import tasksRouter from "./tasks.js";
import chatRouter from "./chat.js";
import pushRouter from "./push.js";
import boardColumnsRouter from "./board-columns.js";
import usersRouter from "./users.js";
import invitationsRouter from "./invitations.js";
import joinRequestsRouter from "./join-requests.js";
import uploadRouter from "./upload.js";
import neonRouter from "./neon.js";
import integrationsRouter from "./integrations.js";
import socketInitRouter from "./socket-init.js";
import authRouter from "./auth.js";
import ragRouter from "./rag.js";
import flowchartRouter from "./flowchart.js";
import whiteboardRouter from "./whiteboard.js";

const apiRouter = Router();

apiRouter.use("/workspaces", workspacesRouter);
apiRouter.use("/workspace-members", workspaceMembersRouter);
apiRouter.use("/projects", projectsRouter);
apiRouter.use("/tasks", tasksRouter);
apiRouter.use("/tasks", ragRouter);
apiRouter.use("/rag", ragRouter);
apiRouter.use("/chat", chatRouter);
apiRouter.use("/push", pushRouter);
apiRouter.use("/board-columns", boardColumnsRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/invitations", invitationsRouter);
apiRouter.use("/join-requests", joinRequestsRouter);
apiRouter.use("/upload", uploadRouter);
apiRouter.use("/neon", neonRouter);
apiRouter.use("/integrations", integrationsRouter);
apiRouter.use("/socket-init", socketInitRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/flowchart", flowchartRouter);
apiRouter.use("/whiteboard", whiteboardRouter);

// Health check endpoint
apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default apiRouter;

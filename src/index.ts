import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http";
import cors from "cors";
import apiRouter from "./routes/index";
import { setupSocketIO } from "./socket";
import { prisma } from "./lib/prisma";

const app = express();
const PORT = process.env.PORT || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";

// Middleware
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? "*" : CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Request logger for development
app.use((req, _res, next) => {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  }
  next();
});

// API Routes
app.use("/api", apiRouter);

// Root greeting
app.get("/", (_req, res) => {
  res.json({
    name: "Task Management Backend API",
    version: "1.0.0",
    status: "running",
    corsOrigin: CORS_ORIGIN,
  });
});

// Create HTTP server
const httpServer = http.createServer(app);

// Setup Socket.IO
const io = setupSocketIO(httpServer, CORS_ORIGIN);

// Start server
httpServer.listen(PORT, () => {
  console.log(`\n🚀 [Server] Backend Express berjalan pada http://localhost:${PORT}`);
  console.log(`📡 [Socket.IO] Real-time engine siap di path /api/socket/io`);
  console.log(`🔒 [CORS] Mengizinkan origin: ${CORS_ORIGIN}\n`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[Server] Shutting down gracefully...");
  await prisma.$disconnect();
  httpServer.close(() => {
    console.log("[Server] Closed HTTP server.");
    process.exit(0);
  });
});

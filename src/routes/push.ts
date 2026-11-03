import { Router, Request, Response } from "express";
import {
  VAPID_PUBLIC_KEY,
  getBrowserFromRequest,
  getStoredSubscriptions,
  saveStoredSubscription,
  removeExpiredSubscriptions,
  sendServerPushNotification,
} from "../lib/server-push.js";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  const subs = await getStoredSubscriptions();
  return res.json({
    publicKey: VAPID_PUBLIC_KEY,
    subscribersCount: subs.length,
    subscribers: subs.map((s) => ({
      endpoint: s.endpoint.slice(0, 45) + "...",
      userId: s.userId,
      workspaceId: s.workspaceId,
    })),
  });
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { action, subscription, notification, userId, workspaceId, oldEndpoint } =
      req.body;

    if (action === "subscribe" && subscription) {
      const agent = getBrowserFromRequest(req);
      if (oldEndpoint && typeof oldEndpoint === "string" && oldEndpoint !== subscription.endpoint) {
        console.log("[PushAPI] Endpoint berubah, menghapus endpoint lama:", oldEndpoint.slice(0, 45) + "...");
        await removeExpiredSubscriptions([oldEndpoint]).catch(() => {});
      }
      await saveStoredSubscription(subscription, userId, workspaceId, agent);
      const subs = await getStoredSubscriptions();

      return res.json({
        success: true,
        message: "Subscription registered",
        total: subs.length,
      });
    }
    
    if (action === "send") {
      const result = await sendServerPushNotification({
        title: notification?.title || "Diskusi Tim",
        body:
          notification?.body || "Ada pembaruan aktivitas task di workspace.",
        url: notification?.url || "/",
        excludeUserId: notification?.excludeUserId || notification?.userId,
        workspaceId: notification?.workspaceId,
      });

      return res.json({
        success: true,
        sentCount: result.sentCount,
        totalSubscribers: result.totalSubscribers,
      });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (error) {
    console.error("Push notification API error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      details: String(error),
    });
  }
});

export default router;

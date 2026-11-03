import webpush from "web-push";
import { prisma } from "./prisma.js";

export const VAPID_PUBLIC_KEY = String(
  process.env.NEXT_VAPID_PUBLIC_KEY ||
    "BLeU_4VxmooOIxLVGlssH3fLzxMiQQ1RgAOVyS8xG8q3C7zRpkHDvFYXLhlXWgGyMdwfk3flVdIdtJyglgMVEj4",
);
export const VAPID_PRIVATE_KEY = String(
  process.env.NEXT_VAPID_PRIVATE_KEY ||
    "NKMKfmgjX0xYlWkl0swjgH7vf1bwRq7lxUTcMuM4QCI",
);

try {
  webpush.setVapidDetails(
    "mailto:admin@kinetic.dev",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
} catch (e) {
  console.warn("Failed to set VAPID details in server-push:", e);
}

export interface StoredSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  agent?: string;
  userId?: string;
  workspaceId?: string;
  updatedAt?: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __pushSubscriptions: StoredSubscription[] | undefined;
}

const SETTING_KEY = "web_push_subscriptions";

/**
 * Mengambil semua push subscriptions yang tersimpan di DB & in-memory
 */
export async function getStoredSubscriptions(): Promise<StoredSubscription[]> {
  try {
    const record = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEY },
    });

    if (record?.value) {
      const dbSubs: StoredSubscription[] = JSON.parse(record.value);
      if (Array.isArray(dbSubs)) {
        globalThis.__pushSubscriptions = dbSubs;
        return dbSubs;
      }
    }
  } catch (err) {
    console.warn(
      "Could not read subscriptions from DB, falling back to memory:",
      err,
    );
  }

  return globalThis.__pushSubscriptions || [];
}

export function getBrowserFromRequest(req: Request | any) {
  const ua = req.headers["user-agent"] || "";

  if (/edg\//i.test(ua)) {
    return "Microsoft Edge";
  }

  if (/chrome|crios/i.test(ua)) {
    return "Google Chrome";
  }

  return "Other Browser";
}

/**
 * Menyimpan atau memperbarui subscription ke DB & in-memory
 */
export async function saveStoredSubscription(
  subscription: webpush.PushSubscription,
  userId?: string,
  workspaceId?: string,
  agent?: string,
): Promise<void> {
  if (!subscription || !subscription.endpoint) return;

  const current = await getStoredSubscriptions();
  const index = current.findIndex((s) => s.endpoint === subscription.endpoint);

  const existingItem = index >= 0 ? current[index] : null;

  const item: StoredSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: (subscription as any).keys?.p256dh || existingItem?.keys?.p256dh || "",
      auth: (subscription as any).keys?.auth || existingItem?.keys?.auth || "",
    },
    agent: agent || existingItem?.agent,
    userId: userId !== undefined && userId !== "" ? userId : existingItem?.userId,
    workspaceId: workspaceId !== undefined && workspaceId !== "" ? workspaceId : existingItem?.workspaceId,
    updatedAt: Date.now(),
  };

  if (index >= 0) {
    current[index] = item;
  } else {
    current.push(item);
  }

  // Deduplikasi berdasarkan endpoint (kunci keunikan push browser)
  const uniqueEntries = Array.from(
    new Map(
      current.map((entry) => [entry.endpoint, entry]),
    ).values(),
  );

  globalThis.__pushSubscriptions = uniqueEntries;

  try {
    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEY },
      create: {
        key: SETTING_KEY,
        value: JSON.stringify(uniqueEntries),
      },
      update: {
        value: JSON.stringify(uniqueEntries),
      },
    });
  } catch (err) {
    console.warn("Could not persist subscriptions to DB:", err);
  }
}

/**
 * Menghapus subscriptions yang sudah kadaluarsa (status 404 / 410)
 */
export async function removeExpiredSubscriptions(
  endpointsToRemove: string[],
): Promise<void> {
  if (endpointsToRemove.length === 0) return;
  const set = new Set(endpointsToRemove);

  const current = (await getStoredSubscriptions()).filter(
    (s) => !set.has(s.endpoint),
  );
  globalThis.__pushSubscriptions = current;

  try {
    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEY },
      create: {
        key: SETTING_KEY,
        value: JSON.stringify(current),
      },
      update: {
        value: JSON.stringify(current),
      },
    });
  } catch (err) {
    console.warn("Could not update pruned subscriptions in DB:", err);
  }
}

/**
 * Mengirim notifikasi push ke semua subscription yang memenuhi kriteria
 */
export async function sendServerPushNotification(opts: {
  title: string;
  body: string;
  url?: string;
  excludeUserId?: string;
  excludeEndpoint?: string;
  workspaceId?: string;
}): Promise<{ sentCount: number; totalSubscribers: number }> {
  const subscriptions = await getStoredSubscriptions();

  // Filter pengirim: pengirim tidak perlu menerima notifikasi untuk pesannya sendiri
  const targets = subscriptions.filter((sub) => {
    // 1. Abaikan subscription yang tidak memiliki endpoint atau keys
    if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return false;
    }

    // 2. Kecualikan browser yang baru saja mengirimkan pesan (paling akurat)
    if (opts.excludeEndpoint && sub.endpoint === opts.excludeEndpoint) {
      return false;
    }
    // 3. Kecualikan jika userId sama dengan pengirim
    if (opts.excludeUserId && sub.userId && sub.userId === opts.excludeUserId) {
      return false;
    }
    // 4. Kecualikan jika berada di workspace berbeda
    if (
      opts.workspaceId &&
      sub.workspaceId &&
      sub.workspaceId !== opts.workspaceId
    ) {
      return false;
    }

    return true;
  });

  if (targets.length === 0) {
    return { sentCount: 0, totalSubscribers: subscriptions.length };
  }

  const payload = JSON.stringify({
    title: opts.title || "Diskusi Tim",
    body: opts.body || "Ada pesan baru di diskusi tim.",
    url: opts.url || "/",
    icon: "/favicon.ico",
    senderId: opts.excludeUserId,
    tag: `kinetic-${(opts.title + "-" + opts.body).replace(/\s+/g, "_").slice(0, 50)}`,
  });

  const expiredEndpoints: string[] = [];

  const results = await Promise.allSettled(
    targets.map((sub) =>
      webpush
        .sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          payload,
          {
            TTL: 86400, // 24 jam waktu simpan antrean pesan
          },
        )
        .catch((err) => {
          // Hanya 410 (Gone) dan 404 (Not Found) yang benar-benar menandakan subscription tidak berlaku lagi
          if (err.statusCode === 410 || err.statusCode === 404) {
            console.log(
              `[ServerPush] Endpoint kadaluarsa/unsubscribed (${err.statusCode}):`,
              sub.endpoint.slice(0, 45) + "...",
            );
            expiredEndpoints.push(sub.endpoint);
          } else {
            console.warn(
              `[ServerPush] Pengiriman gagal sementara ke ${sub.endpoint.slice(0, 45)}...:`,
              err.statusCode,
              err.message,
            );
          }
          throw err;
        }),
    ),
  );

  if (expiredEndpoints.length > 0) {
    await removeExpiredSubscriptions(expiredEndpoints).catch(() => {});
  }

  const sentCount = results.filter((r) => r.status === "fulfilled").length;
  return { sentCount, totalSubscribers: targets.length };
}

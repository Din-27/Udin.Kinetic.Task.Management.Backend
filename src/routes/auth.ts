import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { getDefaultAvatar } from "../types/index.js";

const router = Router();
const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "";

/**
 * Mendekripsi session token terenkripsi NextAuth v4 (JWE AES-256-GCM via HKDF)
 * Mendukung cookie HTTPS (__Secure-next-auth.session-token), HTTP, serta secret valid.
 */
function decryptNextAuthToken(token: string, explicitSecret?: string): any | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 5) {
      return null;
    }

    const [headerB64, , ivB64, ciphertextB64, tagB64] = parts;
    const iv = Buffer.from(ivB64, "base64url");
    const ciphertext = Buffer.from(ciphertextB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const aad = Buffer.from(headerB64, "ascii");

    const candidateSecrets = Array.from(
      new Set(
        [
          explicitSecret,
          process.env.NEXTAUTH_SECRET,
        ].filter((s): s is string => Boolean(s && s.trim()))
      )
    );

    const candidateSalts = [
      "__Secure-next-auth.session-token",
      "next-auth.session-token",
      "sessionToken",
      "",
    ];

    for (const secret of candidateSecrets) {
      for (const salt of candidateSalts) {
        try {
          const info = salt
            ? `NextAuth.js Generated Encryption Key (${salt})`
            : "NextAuth.js Generated Encryption Key";

          const key = crypto.hkdfSync(
            "sha256",
            Buffer.from(secret),
            Buffer.from(salt),
            Buffer.from(info),
            32
          );

          const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key), iv);
          decipher.setAuthTag(tag);
          decipher.setAAD(aad);

          const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
          ]);

          const parsed = JSON.parse(decrypted.toString("utf-8"));
          if (parsed && typeof parsed === "object") {
            return parsed;
          }
        } catch {
          // Lanjut ke kombinasi salt & secret berikutnya
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function authenticateRequest(req: Request): Promise<{
  id: string;
  name: string | null;
  email: string | null;
  image?: string | null;
  role: string;
  expires?: string;
} | null> {
  try {
    const authHeader = req.headers.authorization;
    const cookieHeader = req.headers.cookie;

    let sessionToken: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      sessionToken = authHeader.substring(7).trim();
    } else if (cookieHeader) {
      // Periksa cookie chunked NextAuth jika ada
      const chunkMatches = Array.from(
        cookieHeader.matchAll(/(?:next-auth\.session-token|__Secure-next-auth\.session-token)\.(\d+)=([^;]+)/g)
      );

      if (chunkMatches.length > 0) {
        chunkMatches.sort((a, b) => Number(a[1]) - Number(b[1]));
        sessionToken = chunkMatches.map((m) => decodeURIComponent(m[2])).join("");
      } else {
        const match = cookieHeader.match(
          /(?:next-auth\.session-token|__Secure-next-auth\.session-token|sessionToken)=([^;]+)/
        );
        if (match) {
          sessionToken = decodeURIComponent(match[1]);
        }
      }
    }

    if (!sessionToken) return null;

    // 1. Cek di tabel Session Prisma jika sessionToken ada di database
    const dbSession = await prisma.session.findUnique({
      where: { sessionToken },
      include: { user: true },
    });

    if (dbSession && dbSession.user && new Date(dbSession.expires) > new Date()) {
      return {
        id: dbSession.user.id,
        name: dbSession.user.name,
        email: dbSession.user.email,
        image: dbSession.user.image || dbSession.user.avatar,
        role: dbSession.user.role,
        expires: dbSession.expires.toISOString(),
      };
    }

    // 2. Dekripsi JWE token NextAuth (digunakan oleh Google OAuth, Mock, Azure AD)
    const decrypted = decryptNextAuthToken(sessionToken, NEXTAUTH_SECRET);
    if (decrypted) {
      const email = decrypted.email as string | undefined;
      const sub = (decrypted.sub || decrypted.id) as string | undefined;
      const name = decrypted.name || (email ? email.split("@")[0] : "User");
      const picture = decrypted.picture || decrypted.image;

      if (email || sub) {
        // Cari atau buat user di database Prisma
        let user = await prisma.user.findFirst({
          where: {
            OR: [
              ...(sub ? [{ id: sub }] : []),
              ...(email ? [{ email }] : []),
            ],
          },
        });

        if (!user && email) {
          user = await prisma.user.create({
            data: {
              id: sub || `usr-${Date.now()}`,
              email,
              name,
              image: picture,
              avatar: picture || getDefaultAvatar(name, email),
              role: "MEMBER",
            },
          });
        }

        if (user) {
          const expires = decrypted.exp
            ? new Date(decrypted.exp * 1000)
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

          const existingSession = await prisma.session.findFirst({
            where: { userId: user.id },
          });

          if (!existingSession) {
            await prisma.session.create({
              data: {
                sessionToken,
                userId: user.id,
                expires,
              },
            }).catch(() => {});
          }

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image || user.avatar || picture,
            role: user.role,
            expires: expires.toISOString(),
          };
        }
      }
    }

    return null;
  } catch (err) {
    console.error("[Authenticate Request Error]:", err);
    return null;
  }
}

/**
 * GET & POST /api/auth/session
 * Mengembalikan sesi aktif dari database server (BE).
 */
router.all("/session", async (req: Request, res: Response) => {
  try {
    const auth = await authenticateRequest(req);
    if (auth) {
      return res.status(200).json({
        user: {
          id: auth.id,
          name: auth.name,
          email: auth.email,
          image: auth.image,
          role: auth.role,
        },
        expires: auth.expires,
      });
    }

    // Default NextAuth format saat unauthenticated:
    return res.status(200).json({});
  } catch (error: any) {
    console.error("[Auth Session Error]:", error);
    return res.status(200).json({});
  }
});

/**
 * POST /api/auth/signin / /api/auth/login / /api/auth/callback/credentials
 * Membuat / sinkronisasi session dan user baru di backend database Prisma
 */
const handleSignIn = async (req: Request, res: Response) => {
  try {
    const id = (req.body?.id || req.query.id as string || "").trim();
    const email = (req.body?.email || req.query.email as string || "").trim().toLowerCase();
    const name = (req.body?.name || req.query.name as string || "").trim() || email.split("@")[0] || "User";
    const image = (req.body?.image || req.body?.avatar as string || "").trim();
    const role = "MEMBER"; // Default role aman, cegah privilege escalation melalui payload publik

    if (!email && !id) {
      return res.status(400).json({ error: "Email atau user ID wajib diisi" });
    }

    // Cari atau buat user baru di Prisma
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          ...(id ? [{ id }] : []),
          ...(email ? [{ email }] : []),
        ],
      },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: id || `usr-${Date.now()}`,
          email: email || `${id}@local.dev`,
          name,
          image: image || null,
          avatar: image || getDefaultAvatar(name, email),
          role: "MEMBER",
        },
      });
    } else if (image && !user.image) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { image, avatar: image },
      });
    }

    // Buat token session dan simpan di tabel Session Prisma
    const sessionToken = `sess_${crypto.randomUUID().replace(/-/g, "")}`;
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 hari

    await prisma.session.create({
      data: {
        sessionToken,
        userId: user.id,
        expires,
      },
    });

    // Set cookie sessionToken
    const maxAge = 30 * 24 * 60 * 60;
    res.setHeader("Set-Cookie", [
      `next-auth.session-token=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
      `sessionToken=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
    ]);

    return res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image || user.avatar,
        role: user.role,
      },
      sessionToken,
      expires: expires.toISOString(),
    });
  } catch (error: any) {
    console.error("[Auth SignIn Error]:", error);
    return res.status(500).json({ error: error.message || "Gagal membuat sesi login" });
  }
};

router.post("/signin", handleSignIn);
router.post("/login", handleSignIn);
router.post("/callback/credentials", handleSignIn);

/**
 * POST /api/auth/signout / /api/auth/logout
 * Menghapus sesi aktif dari database Prisma dan membersihkan cookie
 */
const handleSignOut = async (req: Request, res: Response) => {
  try {
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(
        /(?:next-auth\.session-token|__Secure-next-auth\.session-token|sessionToken)=([^;]+)/
      );
      if (match) {
        const sessionToken = decodeURIComponent(match[1]);
        await prisma.session.deleteMany({ where: { sessionToken } }).catch(() => {});
      }
    }

    res.setHeader("Set-Cookie", [
      "next-auth.session-token=; Path=/; HttpOnly; Max-Age=0",
      "sessionToken=; Path=/; HttpOnly; Max-Age=0",
    ]);

    return res.status(200).json({ url: "/" });
  } catch {
    return res.status(200).json({ url: "/" });
  }
};

router.post("/signout", handleSignOut);
router.post("/logout", handleSignOut);

/**
 * Endpoints pelengkap NextAuth CSRF & Providers dengan URL absolut
 */
router.all("/csrf", (_req: Request, res: Response) => {
  return res.status(200).json({ csrfToken: "backend-csrf-token" });
});

router.all("/providers", (req: Request, res: Response) => {
  const host = req.get("host") || "localhost:3000";
  const protocol = req.protocol || "http";
  const baseUrl = `${protocol}://${host}`;
  return res.status(200).json({
    credentials: {
      id: "credentials",
      name: "Credentials",
      type: "credentials",
      signinUrl: `${baseUrl}/api/auth/signin/credentials`,
      callbackUrl: `${baseUrl}/api/auth/callback/credentials`,
    },
  });
});

export default router;

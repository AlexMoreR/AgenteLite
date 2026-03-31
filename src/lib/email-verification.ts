import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

type AuthTokenPurpose = "VERIFY_EMAIL" | "AUTO_LOGIN" | "PASSWORD_RESET";

type VerificationPayload = {
  userId: string;
  email: string;
  purpose: AuthTokenPurpose;
  exp: number;
};

const EMAIL_VERIFICATION_TTL_SECONDS = 60 * 60 * 24;
const AUTO_LOGIN_TTL_SECONDS = 60 * 15;
const PASSWORD_RESET_TTL_SECONDS = 60 * 30;

function getSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SECRET no configurado");
  }
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createSignedToken(userId: string, email: string, purpose: AuthTokenPurpose, ttlSeconds: number): string {
  const payload: VerificationPayload = {
    userId,
    email,
    purpose,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function parseSignedToken(token: string): VerificationPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);
  const expectedBuffer = Buffer.from(expectedSignature);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return null;
  }

  try {
    const raw = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const payload = JSON.parse(raw) as Partial<VerificationPayload>;
    if (
      !payload.userId ||
      !payload.email ||
      !payload.exp ||
      !payload.purpose ||
      !["VERIFY_EMAIL", "AUTO_LOGIN", "PASSWORD_RESET"].includes(payload.purpose)
    ) {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return {
      userId: payload.userId,
      email: payload.email,
      purpose: payload.purpose,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

async function createStoredToken(
  userId: string,
  email: string,
  purpose: AuthTokenPurpose,
  ttlSeconds: number,
): Promise<string> {
  const token = createSignedToken(userId, email, purpose, ttlSeconds);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await prisma.$executeRaw`
    INSERT INTO "EmailAuthToken" ("id", "userId", "email", "purpose", "tokenHash", "expiresAt")
    VALUES (${randomUUID()}, ${userId}, ${email}, ${purpose}::"EmailAuthTokenPurpose", ${hashToken(token)}, ${expiresAt})
  `;

  return token;
}

async function consumeStoredToken(
  token: string,
  purpose: AuthTokenPurpose,
): Promise<{ userId: string; email: string } | null> {
  const payload = parseSignedToken(token);
  if (!payload || payload.purpose !== purpose) {
    return null;
  }

  const rows = await prisma.$queryRaw<Array<{ userId: string; email: string }>>`
    UPDATE "EmailAuthToken"
    SET "usedAt" = CURRENT_TIMESTAMP
    WHERE "tokenHash" = ${hashToken(token)}
      AND "purpose" = ${purpose}::"EmailAuthTokenPurpose"
      AND "userId" = ${payload.userId}
      AND "email" = ${payload.email}
      AND "usedAt" IS NULL
      AND "expiresAt" >= CURRENT_TIMESTAMP
    RETURNING "userId", "email"
  `;

  if (rows.length === 0) {
    return null;
  }

  return rows[0];
}

export async function createEmailVerificationToken(userId: string, email: string): Promise<string> {
  return createStoredToken(userId, email, "VERIFY_EMAIL", EMAIL_VERIFICATION_TTL_SECONDS);
}

export async function consumeEmailVerificationToken(
  token: string,
): Promise<{ userId: string; email: string } | null> {
  return consumeStoredToken(token, "VERIFY_EMAIL");
}

export async function createAutoLoginToken(userId: string, email: string): Promise<string> {
  return createStoredToken(userId, email, "AUTO_LOGIN", AUTO_LOGIN_TTL_SECONDS);
}

export async function consumeAutoLoginToken(
  token: string,
): Promise<{ userId: string; email: string } | null> {
  return consumeStoredToken(token, "AUTO_LOGIN");
}

export async function createPasswordResetToken(userId: string, email: string): Promise<string> {
  return createStoredToken(userId, email, "PASSWORD_RESET", PASSWORD_RESET_TTL_SECONDS);
}

export async function consumePasswordResetToken(
  token: string,
): Promise<{ userId: string; email: string } | null> {
  return consumeStoredToken(token, "PASSWORD_RESET");
}

import { createHmac, timingSafeEqual } from "node:crypto";

type VerificationPayload = {
  userId: string;
  email: string;
  exp: number;
};

const EMAIL_VERIFICATION_TTL_SECONDS = 60 * 60 * 24;

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

export function createEmailVerificationToken(userId: string, email: string): string {
  const payload: VerificationPayload = {
    userId,
    email,
    exp: Math.floor(Date.now() / 1000) + EMAIL_VERIFICATION_TTL_SECONDS,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyEmailVerificationToken(token: string): VerificationPayload | null {
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
    if (!payload.userId || !payload.email || !payload.exp) {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return {
      userId: payload.userId,
      email: payload.email,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

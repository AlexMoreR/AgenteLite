CREATE TYPE "EmailAuthTokenPurpose" AS ENUM ('VERIFY_EMAIL', 'AUTO_LOGIN');

CREATE TABLE "EmailAuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" "EmailAuthTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailAuthToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailAuthToken_tokenHash_key" ON "EmailAuthToken"("tokenHash");
CREATE INDEX "EmailAuthToken_userId_purpose_createdAt_idx" ON "EmailAuthToken"("userId", "purpose", "createdAt");
CREATE INDEX "EmailAuthToken_purpose_expiresAt_idx" ON "EmailAuthToken"("purpose", "expiresAt");

ALTER TABLE "EmailAuthToken"
ADD CONSTRAINT "EmailAuthToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

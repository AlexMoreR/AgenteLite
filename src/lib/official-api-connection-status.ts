import { prisma } from "@/lib/prisma";

export async function updateOfficialApiConnectionStatus(input: {
  configId: string;
  status: "NOT_CONNECTED" | "CONNECTED" | "ERROR";
}) {
  await prisma.$executeRaw`
    UPDATE "OfficialApiClientConfig"
    SET
      "status" = ${input.status}::"OfficialApiConnectionStatus",
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.configId}
  `;
}

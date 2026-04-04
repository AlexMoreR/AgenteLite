import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";

const testMessageSchema = z.object({
  workspaceId: z.string().trim().min(1),
  accessToken: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1),
  recipient: z.string().trim().min(8),
  message: z.string().trim().min(1).max(1000),
});

function normalizePhoneNumber(value: string) {
  return value.replace(/[^\d]/g, "");
}

export async function POST(request: Request) {
  const session = await auth();

  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = testMessageSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Datos invalidos" },
      { status: 400 },
    );
  }

  const recipient = normalizePhoneNumber(parsed.data.recipient);
  if (recipient.length < 8) {
    return NextResponse.json(
      { error: "El numero de destino debe estar en formato internacional." },
      { status: 400 },
    );
  }

  const response = await fetch(
    `https://graph.facebook.com/v23.0/${encodeURIComponent(parsed.data.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${parsed.data.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "text",
        text: {
          body: parsed.data.message,
        },
      }),
      cache: "no-store",
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | {
        messages?: Array<{
          id?: string;
        }>;
        error?: {
          message?: string;
        };
      }
    | null;

  if (!response.ok) {
    return NextResponse.json(
      {
        error:
          payload?.error?.message ||
          "No se pudo enviar el mensaje de prueba con la API oficial.",
      },
      { status: response.status },
    );
  }

  return NextResponse.json({
    ok: true,
    messageId: payload?.messages?.[0]?.id ?? null,
    recipient,
  });
}

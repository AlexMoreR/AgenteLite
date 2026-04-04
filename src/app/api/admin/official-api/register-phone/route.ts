import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";

const registerPhoneSchema = z.object({
  accessToken: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1),
  pin: z.string().trim().max(12).optional(),
});

export async function POST(request: Request) {
  const session = await auth();

  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = registerPhoneSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Datos invalidos" },
      { status: 400 },
    );
  }

  const response = await fetch(
    `https://graph.facebook.com/v23.0/${encodeURIComponent(parsed.data.phoneNumberId)}/register`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${parsed.data.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        ...(parsed.data.pin?.trim() ? { pin: parsed.data.pin.trim() } : {}),
      }),
      cache: "no-store",
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | {
        success?: boolean;
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
          "No se pudo registrar el numero con la API oficial.",
      },
      { status: response.status },
    );
  }

  return NextResponse.json({
    ok: true,
    success: payload?.success ?? true,
  });
}

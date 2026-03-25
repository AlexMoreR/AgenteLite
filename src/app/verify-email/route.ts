import { NextResponse } from "next/server";
import { consumeEmailVerificationToken, createAutoLoginToken } from "@/lib/email-verification";
import { getPublicBaseUrl } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const baseUrl = getPublicBaseUrl(request);
  const token = searchParams.get("token") || "";

  if (!token) {
    return NextResponse.redirect(`${baseUrl}/login?error=Token+de+verificacion+invalido`);
  }

  const payload = await consumeEmailVerificationToken(token);
  if (!payload) {
    return NextResponse.redirect(`${baseUrl}/login?error=El+enlace+de+verificacion+es+invalido+o+expiro`);
  }

  try {
    const result = await prisma.user.updateMany({
      where: {
        id: payload.userId,
        email: payload.email,
      },
      data: {
        emailVerified: new Date(),
      },
    });

    if (result.count === 0) {
      return NextResponse.redirect(`${baseUrl}/login?error=No+se+pudo+confirmar+la+cuenta`);
    }

    const autoLoginToken = await createAutoLoginToken(payload.userId, payload.email);
    return NextResponse.redirect(
      `${baseUrl}/login/verified?token=${encodeURIComponent(autoLoginToken)}`,
    );
  } catch {
    return NextResponse.redirect(`${baseUrl}/login?error=No+se+pudo+confirmar+la+cuenta`);
  }
}

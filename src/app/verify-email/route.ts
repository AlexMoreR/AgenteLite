import { NextResponse } from "next/server";
import { verifyEmailVerificationToken } from "@/lib/email-verification";
import { getPublicBaseUrl } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const baseUrl = getPublicBaseUrl(request);
  const token = searchParams.get("token") || "";

  if (!token) {
    return NextResponse.redirect(`${baseUrl}/login?error=Token+de+verificacion+invalido`);
  }

  const payload = verifyEmailVerificationToken(token);
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

    return NextResponse.redirect(`${baseUrl}/login?ok=Correo+verificado.+Ya+puedes+iniciar+sesion`);
  } catch {
    return NextResponse.redirect(`${baseUrl}/login?error=No+se+pudo+confirmar+la+cuenta`);
  }
}

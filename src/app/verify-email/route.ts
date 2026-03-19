import { NextResponse } from "next/server";
import { verifyEmailVerificationToken } from "@/lib/email-verification";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token = searchParams.get("token") || "";

  if (!token) {
    return NextResponse.redirect(`${origin}/login?error=Token+de+verificacion+invalido`);
  }

  const payload = verifyEmailVerificationToken(token);
  if (!payload) {
    return NextResponse.redirect(`${origin}/login?error=El+enlace+de+verificacion+es+invalido+o+expiro`);
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
      return NextResponse.redirect(`${origin}/login?error=No+se+pudo+confirmar+la+cuenta`);
    }

    return NextResponse.redirect(`${origin}/login?ok=Correo+verificado.+Ya+puedes+iniciar+sesion`);
  } catch {
    return NextResponse.redirect(`${origin}/login?error=No+se+pudo+confirmar+la+cuenta`);
  }
}

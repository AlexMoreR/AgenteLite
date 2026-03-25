import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { consumeAutoLoginToken } from "@/lib/email-verification";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations/auth";
import authConfig from "@/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
        verificationToken: {},
      },
      async authorize(credentials) {
        const verificationToken =
          typeof credentials?.verificationToken === "string" ? credentials.verificationToken : "";

        if (verificationToken) {
          const payload = await consumeAutoLoginToken(verificationToken);
          if (!payload) {
            return null;
          }

          const user = await prisma.user.findUnique({
            where: { id: payload.userId },
          });

          if (!user || user.email !== payload.email) {
            return null;
          }

          if (user.role === "CLIENTE" && !user.emailVerified) {
            return null;
          }

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            image: user.image,
          };
        }

        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user) {
          return null;
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          image: user.image,
        };
      },
    }),
  ],
});

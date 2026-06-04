import { Role } from "@prisma/client";
import type { WorkspaceMemberRole } from "@prisma/client";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role?: Role;
      primaryWorkspaceId?: string | null;
      workspaceMemberRole?: WorkspaceMemberRole | null;
    } & DefaultSession["user"];
  }

  interface User {
    role?: Role;
    primaryWorkspaceId?: string | null;
    workspaceMemberRole?: WorkspaceMemberRole | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    primaryWorkspaceId?: string | null;
    workspaceMemberRole?: WorkspaceMemberRole | null;
  }
}

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getCrmData, getCrmKanbanData } from "@/features/crm";

export async function getAuthorizedCrmData() {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const data = await getCrmData({ userId: session.user.id });

  if (!data) {
    redirect("/cliente");
  }

  return data;
}

export async function getAuthorizedCrmKanbanData() {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const data = await getCrmKanbanData({ userId: session.user.id });

  if (!data) {
    redirect("/cliente");
  }

  return data;
}

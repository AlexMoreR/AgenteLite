import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { MarketingOnboardingWizard } from "@/components/marketing/marketing-onboarding-wizard";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteOnboardingPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const existingWorkspace = await getPrimaryWorkspaceForUser(session.user.id);
  if (existingWorkspace) {
    redirect("/cliente");
  }

  const params = await searchParams;
  const errorMessage = typeof params.error === "string" ? params.error : "";
  const returnTo = typeof params.returnTo === "string" && params.returnTo.startsWith("/")
    ? params.returnTo
    : "/cliente";

  return (
    <section className="app-page grid min-h-[calc(100vh-9rem)] place-items-center px-4 py-10">
      <QueryFeedbackToast
        errorMessage={errorMessage}
        okMessage=""
        errorTitle="No pudimos guardar tu negocio"
      />

      <MarketingOnboardingWizard
        defaultBusinessName={session.user.name ?? ""}
        returnTo={returnTo}
      />
    </section>
  );
}

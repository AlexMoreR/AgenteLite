"use client";

import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { Toaster } from "sonner";
import { BreadcrumbLabelProvider } from "@/components/breadcrumb-label-context";

type ProvidersProps = {
  children: React.ReactNode;
  session: Session | null;
};

export function Providers({ children, session }: ProvidersProps) {
  return (
    <SessionProvider session={session}>
      <BreadcrumbLabelProvider>{children}</BreadcrumbLabelProvider>
      <Toaster
        position="top-right"
        closeButton
        expand
        visibleToasts={4}
        toastOptions={{
          classNames: {
            toast: "app-sonner-toast",
            success: "app-sonner-success",
            error: "app-sonner-error",
            info: "app-sonner-info",
            title: "app-sonner-title",
            description: "app-sonner-description",
          },
        }}
      />
    </SessionProvider>
  );
}

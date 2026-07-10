"use client";

import type { ReactNode } from "react";
import { Cable } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";

export function ConnectionsTabsShell({
  conexiones,
  action,
}: {
  conexiones: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="w-full">
      <div className="px-6 pt-6">
        <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <PageHeader icon={Cable} title="Conexión" />

          {action}
        </div>
      </div>

      {conexiones}
    </div>
  );
}

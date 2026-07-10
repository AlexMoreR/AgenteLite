"use client";

import type { ReactNode } from "react";
import { Cable } from "lucide-react";
import { FiBarChart2, FiLink } from "react-icons/fi";

import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ConnectionsTabsShell({
  conexiones,
  reporte,
  action,
}: {
  conexiones: ReactNode;
  reporte: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Tabs defaultValue="conexiones" className="w-full">
      <div className="px-6 pt-6">
        <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <PageHeader icon={Cable} title="Conexión" />

          {action}
        </div>

        <TabsList variant="line" className="mt-2">
          <TabsTrigger value="conexiones">
            <FiLink className="size-4" />
            Conexiones
          </TabsTrigger>
          <TabsTrigger value="reporte">
            <FiBarChart2 className="size-4" />
            Reporte
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="conexiones">{conexiones}</TabsContent>
      <TabsContent value="reporte" className="px-6 pb-6 pt-4">
        {reporte}
      </TabsContent>
    </Tabs>
  );
}

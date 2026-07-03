"use client";

import type { ReactNode } from "react";
import { FiBarChart2, FiLink } from "react-icons/fi";
import { HiMiniChartBar } from "react-icons/hi2";

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
          <div className="space-y-1">
            <div className="inline-flex items-center gap-3">
              <HiMiniChartBar className="size-6 text-sky-600" />
              <h1 className="text-[20px] font-semibold leading-none text-foreground">Conexion</h1>
            </div>
          </div>

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

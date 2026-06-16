"use client";

import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ConnectionsTabsShell({
  conexiones,
  reporte,
}: {
  conexiones: ReactNode;
  reporte: ReactNode;
}) {
  return (
    <Tabs defaultValue="conexiones" className="w-full">
      <TabsList variant="line" className="px-6 pt-4">
        <TabsTrigger value="conexiones">Conexiones</TabsTrigger>
        <TabsTrigger value="reporte">Reporte</TabsTrigger>
      </TabsList>
      <TabsContent value="conexiones">{conexiones}</TabsContent>
      <TabsContent value="reporte" className="px-6 pb-6">
        {reporte}
      </TabsContent>
    </Tabs>
  );
}

"use client";

import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ConnectionTabs({
  ajustes,
  colaboradores,
}: {
  ajustes: ReactNode;
  colaboradores: ReactNode;
}) {
  return (
    <Tabs defaultValue="ajustes">
      <TabsList variant="line">
        <TabsTrigger value="ajustes">Ajustes</TabsTrigger>
        <TabsTrigger value="colaboradores">Colaboradores</TabsTrigger>
      </TabsList>
      <TabsContent value="ajustes" className="pt-4">
        {ajustes}
      </TabsContent>
      <TabsContent value="colaboradores" className="pt-4">
        {colaboradores}
      </TabsContent>
    </Tabs>
  );
}

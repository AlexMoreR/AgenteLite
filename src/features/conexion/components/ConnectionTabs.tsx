"use client";

import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ConnectionTabs({
  agente,
  ajustes,
  colaboradores,
}: {
  agente: ReactNode;
  ajustes?: ReactNode;
  colaboradores: ReactNode;
}) {
  return (
    <Tabs defaultValue={ajustes ? "ajustes" : "agente"}>
      <TabsList variant="line">
        {ajustes ? <TabsTrigger value="ajustes">Ajustes</TabsTrigger> : null}
        <TabsTrigger value="agente">Agente</TabsTrigger>
        <TabsTrigger value="colaboradores">Colaboradores</TabsTrigger>
      </TabsList>
      {ajustes ? (
        <TabsContent value="ajustes" className="pt-4">
          {ajustes}
        </TabsContent>
      ) : null}
      <TabsContent value="agente" className="pt-4">
        {agente}
      </TabsContent>
      <TabsContent value="colaboradores" className="pt-4">
        {colaboradores}
      </TabsContent>
    </Tabs>
  );
}

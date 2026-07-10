"use client";

import type { ReactNode } from "react";
import { Bot, Settings2, Users2 } from "lucide-react";

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
        {ajustes ? (
          <TabsTrigger value="ajustes">
            <Settings2 className="size-4" />
            Ajustes
          </TabsTrigger>
        ) : null}
        <TabsTrigger value="agente">
          <Bot className="size-4" />
          Agente
        </TabsTrigger>
        <TabsTrigger value="colaboradores">
          <Users2 className="size-4" />
          Colaboradores
        </TabsTrigger>
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

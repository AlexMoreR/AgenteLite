"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Plus, Workflow, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AgentV2FlowCanvas } from "./AgentV2FlowCanvas";

type AgentV2 = {
  id: string;
  name: string;
  createdAt: string;
};

const STORAGE_KEY = "agentV2.agents";

function loadAgents(): AgentV2[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is AgentV2 =>
        item && typeof item.id === "string" && typeof item.name === "string",
    );
  } catch {
    return [];
  }
}

function persistAgents(agents: AgentV2[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
}

export function AgentV2Workspace() {
  const [agents, setAgents] = useState<AgentV2[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    setAgents(loadAgents());
    setHydrated(true);
  }, []);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedId) ?? null,
    [agents, selectedId],
  );

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    const agent: AgentV2 = {
      id: crypto.randomUUID(),
      name: trimmed,
      createdAt: new Date().toISOString(),
    };
    const next = [agent, ...agents];
    setAgents(next);
    persistAgents(next);
    setName("");
    setModalOpen(false);
    setSelectedId(agent.id);
  }

  if (selectedAgent) {
    return (
      <AgentV2FlowCanvas
        agentId={selectedAgent.id}
        agentName={selectedAgent.name}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Agente V2</h1>
          <p className="text-sm text-muted-foreground">
            Crea agentes como un flujo visual de nodos.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" />
          Crear agente flow
        </Button>
      </div>

      {!hydrated ? null : agents.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 border-dashed py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Workflow className="h-6 w-6" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Aun no tienes agentes</p>
            <p className="text-sm text-muted-foreground">
              Crea tu primer agente flow para empezar a construir el flujo.
            </p>
          </div>
          <Button variant="outline" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Crear agente flow
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Card
              key={agent.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedId(agent.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedId(agent.id);
                }
              }}
              className="cursor-pointer p-4 transition hover:border-primary/40 hover:shadow-sm"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Bot className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{agent.name}</p>
                  <p className="text-xs text-muted-foreground">Abrir constructor</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Crear agente flow</h2>
                <p className="text-sm text-muted-foreground">
                  Dale un nombre al agente para empezar.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setModalOpen(false);
                  setName("");
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-4 space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="agent-v2-name">
                Nombre del agente
              </label>
              <Input
                id="agent-v2-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleCreate();
                  }
                }}
                placeholder="Ej. Asistente de ventas"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setModalOpen(false);
                  setName("");
                }}
              >
                Cancelar
              </Button>
              <Button onClick={handleCreate} disabled={!name.trim()}>
                Crear y abrir flujo
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

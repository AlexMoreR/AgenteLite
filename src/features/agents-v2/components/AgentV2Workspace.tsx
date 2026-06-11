"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, MoreVertical, Pencil, Plus, Trash2, Workflow, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AgentV2FlowCanvas,
  type AgentV2Product,
  type AgentV2Flow,
  type BusinessData,
} from "./AgentV2FlowCanvas";

export type AgentV2Connection = { id: string; label: string };

type AgentV2 = {
  id: string;
  name: string;
  createdAt: string;
  connectionId?: string;
  active: boolean;
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
    return parsed
      .filter(
        (item): item is AgentV2 =>
          item && typeof item.id === "string" && typeof item.name === "string",
      )
      .map((item) => ({ ...item, active: typeof item.active === "boolean" ? item.active : true }));
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

export function AgentV2Workspace({
  products,
  flows,
  business,
  connections,
}: {
  products: AgentV2Product[];
  flows: AgentV2Flow[];
  business: BusinessData;
  connections: AgentV2Connection[];
}) {
  const [agents, setAgents] = useState<AgentV2[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [connectionId, setConnectionId] = useState("");

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setName("");
    setConnectionId("");
  }

  function openEdit(agent: AgentV2) {
    setEditingId(agent.id);
    setName(agent.name);
    setConnectionId(agent.connectionId ?? "");
    setModalOpen(true);
  }

  function toggleActive(id: string) {
    const next = agents.map((agent) =>
      agent.id === id ? { ...agent, active: !agent.active } : agent,
    );
    setAgents(next);
    persistAgents(next);
  }

  function deleteAgent(id: string) {
    const next = agents.filter((agent) => agent.id !== id);
    setAgents(next);
    persistAgents(next);
    if (selectedId === id) {
      setSelectedId(null);
    }
  }

  useEffect(() => {
    setAgents(loadAgents());
    setHydrated(true);
  }, []);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedId) ?? null,
    [agents, selectedId],
  );

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    if (editingId) {
      const next = agents.map((agent) =>
        agent.id === editingId
          ? { ...agent, name: trimmed, connectionId: connectionId || undefined }
          : agent,
      );
      setAgents(next);
      persistAgents(next);
      closeModal();
      return;
    }
    const agent: AgentV2 = {
      id: crypto.randomUUID(),
      name: trimmed,
      createdAt: new Date().toISOString(),
      connectionId: connectionId || undefined,
      active: true,
    };
    const next = [agent, ...agents];
    setAgents(next);
    persistAgents(next);
    closeModal();
    setSelectedId(agent.id);
  }

  if (selectedAgent) {
    return (
      <AgentV2FlowCanvas
        agentId={selectedAgent.id}
        agentName={selectedAgent.name}
        products={products}
        flows={flows}
        business={business}
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
              className="p-4 transition hover:border-primary/40 hover:shadow-sm"
            >
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedId(agent.id)}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Bot className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{agent.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {agent.active ? "Abrir constructor" : "Desactivado"}
                    </p>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    checked={agent.active}
                    onCheckedChange={() => toggleActive(agent.id)}
                    aria-label={agent.active ? "Desactivar agente" : "Activar agente"}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" aria-label="Opciones del agente">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(agent)}>
                        <Pencil className="h-4 w-4" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => deleteAgent(agent.id)}>
                        <Trash2 className="h-4 w-4" />
                        Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
                <h2 className="text-base font-semibold text-foreground">
                  {editingId ? "Editar agente" : "Crear agente flow"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {editingId
                    ? "Actualiza el nombre y la conexion."
                    : "Dale un nombre al agente para empezar."}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeModal}>
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
                    handleSave();
                  }
                }}
                placeholder="Ej. Asistente de ventas"
              />
            </div>
            <div className="mt-4 space-y-2">
              <label className="text-sm font-medium text-foreground">Conexion</label>
              <Select value={connectionId} onValueChange={(value) => setConnectionId(value ?? "")}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="Selecciona una conexion" />
                </SelectTrigger>
                <SelectContent className="p-1" alignItemWithTrigger={false} side="bottom">
                  {connections.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No hay conexiones disponibles
                    </div>
                  ) : (
                    connections.map((connection) => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {connection.label}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={closeModal}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={!name.trim()}>
                {editingId ? "Guardar" : "Crear y abrir flujo"}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

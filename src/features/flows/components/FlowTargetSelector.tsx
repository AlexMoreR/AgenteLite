"use client";

import { useRouter } from "next/navigation";
import { Workflow } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type FlowTargetOption = {
  id: string;
  name: string;
  href: string;
  isConnected: boolean;
  hasAgent: boolean;
};

type FlowTargetSelectorProps = {
  targets: FlowTargetOption[];
  currentId: string;
};

// Los flujos se guardan DENTRO de cada canal (metadata.flowBuilderState), asi que cada
// conexion tiene los suyos. Antes la pantalla elegia el canal sola y no dejaba cambiar:
// al crear un canal nuevo, Flujos aparecia vacio y parecia que se habian borrado. Este
// selector hace explicito que canal estas editando y permite saltar a otro.
export function FlowTargetSelector({ targets, currentId }: FlowTargetSelectorProps) {
  const router = useRouter();

  if (targets.length <= 1) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Workflow className="h-4 w-4 text-muted-foreground" />
        Flujos de
      </Label>

      <Select
        value={currentId}
        onValueChange={(value) => {
          const target = targets.find((item) => item.id === value);
          if (target && value !== currentId) {
            router.push(target.href);
          }
        }}
      >
        <SelectTrigger className="h-10 w-full rounded-xl sm:w-72" aria-label="Elegir conexion">
          <SelectValue placeholder="Elige una conexion" />
        </SelectTrigger>
        <SelectContent>
          {targets.map((target) => (
            <SelectItem key={target.id} value={target.id}>
              {target.name}
              {target.hasAgent ? "" : " · sin agente"}
              {target.isConnected ? "" : " · sin conectar"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

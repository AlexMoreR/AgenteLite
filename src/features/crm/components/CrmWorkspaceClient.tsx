"use client";

import dynamic from "next/dynamic";
import type { CrmData } from "../types";

const CrmWorkspace = dynamic(() => import("./CrmWorkspace").then((module) => module.CrmWorkspace), {
  ssr: false,
});

export function CrmWorkspaceClient({ data, defaultView }: { data: CrmData; defaultView?: "registro" | "kanban" | "informe" }) {
  return <CrmWorkspace data={data} defaultView={defaultView} />;
}

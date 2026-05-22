"use client";

import dynamic from "next/dynamic";
import type { CrmData } from "../types";

const CrmWorkspace = dynamic(() => import("./CrmWorkspace").then((module) => module.CrmWorkspace), {
  ssr: false,
});

export function CrmWorkspaceClient({ data }: { data: CrmData }) {
  return <CrmWorkspace data={data} />;
}

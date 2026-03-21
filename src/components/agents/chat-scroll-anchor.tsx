"use client";

import { useEffect, useRef } from "react";

type ChatScrollAnchorProps = {
  dependencyKey: string;
};

export function ChatScrollAnchor({ dependencyKey }: ChatScrollAnchorProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    anchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [dependencyKey]);

  return <div ref={anchorRef} aria-hidden="true" />;
}

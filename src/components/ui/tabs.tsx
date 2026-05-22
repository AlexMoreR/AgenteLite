"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type TabsContextValue = {
  value: string;
  setValue: (value: string) => void;
  orientation: "horizontal" | "vertical";
  tabsId: string;
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext(componentName: string) {
  const context = React.useContext(TabsContext);

  if (!context) {
    throw new Error(`${componentName} must be used within Tabs`);
  }

  return context;
}

type TabsProps = React.HTMLAttributes<HTMLDivElement> & {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  orientation?: "horizontal" | "vertical";
};

function Tabs({
  className,
  defaultValue,
  value,
  onValueChange,
  orientation = "horizontal",
  children,
  ...props
}: TabsProps) {
  const tabsId = React.useId();
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");
  const currentValue = value ?? internalValue;

  const setValue = React.useCallback(
    (nextValue: string) => {
      if (value === undefined) {
        setInternalValue(nextValue);
      }
      onValueChange?.(nextValue);
    },
    [onValueChange, value],
  );

  return (
    <TabsContext.Provider value={{ value: currentValue, setValue, orientation, tabsId }}>
      <div className={cn("w-full", className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

function TabsList({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { orientation } = useTabsContext("TabsList");

  return (
    <div
      role="tablist"
      aria-orientation={orientation}
      className={cn(
        "inline-flex h-10 items-center justify-start rounded-2xl bg-slate-100 p-1 text-slate-500",
        orientation === "vertical" && "h-auto min-h-0 flex-col",
        className,
      )}
      {...props}
    />
  );
}

type TabsTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  value: string;
};

function TabsTrigger({
  className,
  value,
  children,
  ...props
}: TabsTriggerProps) {
  const { value: activeValue, setValue, tabsId } = useTabsContext("TabsTrigger");
  const isActive = activeValue === value;
  const triggerId = `${tabsId}-trigger-${value}`;
  const contentId = `${tabsId}-content-${value}`;

  return (
    <button
      type="button"
      role="tab"
      id={triggerId}
      aria-controls={contentId}
      aria-selected={isActive}
      data-state={isActive ? "active" : "inactive"}
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-xl px-3 text-sm font-medium transition",
        isActive
          ? "bg-white text-slate-950 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.35)]"
          : "text-slate-600 hover:text-slate-950",
        className,
      )}
      onClick={() => setValue(value)}
      {...props}
    >
      {children}
    </button>
  );
}

type TabsContentProps = React.HTMLAttributes<HTMLDivElement> & {
  value: string;
};

function TabsContent({
  className,
  value,
  children,
  ...props
}: TabsContentProps) {
  const { value: activeValue, tabsId } = useTabsContext("TabsContent");
  const isActive = activeValue === value;
  const triggerId = `${tabsId}-trigger-${value}`;
  const contentId = `${tabsId}-content-${value}`;

  if (!isActive) {
    return null;
  }

  return (
    <div
      role="tabpanel"
      id={contentId}
      aria-labelledby={triggerId}
      className={cn("outline-none", className)}
      tabIndex={0}
      {...props}
    >
      {children}
    </div>
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };

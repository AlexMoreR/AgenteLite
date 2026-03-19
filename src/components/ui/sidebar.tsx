"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { ArrowLeftRight } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

type SidebarContextValue = {
  isMobile: boolean;
  openMobile: boolean;
  setOpenMobile: React.Dispatch<React.SetStateAction<boolean>>;
  openDesktop: boolean;
  setOpenDesktop: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextValue>({
  isMobile: false,
  openMobile: false,
  setOpenMobile: () => undefined,
  openDesktop: true,
  setOpenDesktop: () => undefined,
  toggleSidebar: () => undefined,
});

export function useSidebar() {
  return React.useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isMobile, setIsMobile] = React.useState(false);
  const [openMobile, setOpenMobile] = React.useState(false);
  const [openDesktop, setOpenDesktop] = React.useState(true);

  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  React.useEffect(() => {
    if (!isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile]);

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((current) => !current);
      return;
    }
    setOpenDesktop((current) => !current);
  }, [isMobile]);

  return (
    <SidebarContext.Provider
      value={{
        isMobile,
        openMobile,
        setOpenMobile,
        openDesktop,
        setOpenDesktop,
        toggleSidebar,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function Sidebar({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & { collapsible?: "icon" | "offcanvas" | "none" }) {
  const { isMobile, openMobile, setOpenMobile, openDesktop } = useSidebar();
  const state = openDesktop ? "expanded" : "collapsed";
  const collapsibleState = !openDesktop ? "icon" : "";

  return (
    <>
      {isMobile && openMobile ? (
        <button
          type="button"
          aria-label="Cerrar menu lateral"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setOpenMobile(false)}
        />
      ) : null}
      <aside
        data-state={state}
        data-collapsible={collapsibleState}
        className={cn(
          "group/sidebar fixed inset-y-0 left-0 z-40 flex h-full flex-col border-r border-[var(--line)] bg-white transition-[transform,width] duration-200 md:sticky md:top-0 md:h-screen",
          isMobile
            ? openMobile
              ? "w-[212px] translate-x-0"
              : "w-[212px] -translate-x-full"
            : openDesktop
              ? "md:w-[212px] md:translate-x-0"
              : "md:w-[64px] md:translate-x-0 md:overflow-hidden",
          className,
        )}
        {...props}
      >
        {children}
      </aside>
    </>
  );
}

export function SidebarTrigger({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md bg-transparent text-slate-700 transition hover:bg-slate-200/60 focus-visible:outline-none",
        className,
      )}
      {...props}
    >
      <ArrowLeftRight className="h-4 w-4" />
      <span className="sr-only">Abrir menu lateral</span>
    </button>
  );
}

export function SidebarInset({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-h-screen flex-1 flex-col", className)} {...props} />;
}

export function SidebarHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex h-12 items-center border-b border-[var(--line)] px-3 md:px-4 group-data-[collapsible=icon]/sidebar:md:px-2",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex-1 overflow-auto px-3 pb-3 md:px-4 md:pb-4 group-data-[collapsible=icon]/sidebar:md:px-2",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-auto border-t border-[var(--line)] p-3 md:p-4 group-data-[collapsible=icon]/sidebar:md:px-2",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarRail({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("hidden", className)} {...props} />;
}

export function SidebarGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1", className)} {...props} />;
}

export function SidebarGroupLabel({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500", className)}
      {...props}
    />
  );
}

export function SidebarMenu({
  className,
  ...props
}: React.HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("grid gap-1", className)} {...props} />;
}

export function SidebarMenuItem({
  className,
  ...props
}: React.HTMLAttributes<HTMLLIElement>) {
  return <li className={cn("group/menu-item relative", className)} {...props} />;
}

const sidebarMenuButtonVariants = cva(
  "inline-flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition group-data-[collapsible=icon]/sidebar:justify-center group-data-[collapsible=icon]/sidebar:px-2",
  {
    variants: {
      size: {
        default: "h-9",
        lg: "h-12",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

export function SidebarMenuButton({
  className,
  asChild = false,
  isActive = false,
  size,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof sidebarMenuButtonVariants> & {
    asChild?: boolean;
    tooltip?: string;
    isActive?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        sidebarMenuButtonVariants({ size }),
        isActive
          ? "bg-[var(--primary)] text-white hover:bg-[var(--primary-strong)]"
          : "text-slate-700 hover:bg-slate-100",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarMenuAction({
  className,
  showOnHover,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { showOnHover?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900",
        showOnHover ? "opacity-0 group-hover/menu-item:opacity-100" : "",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarMenuSub({
  className,
  ...props
}: React.HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("ml-4 grid gap-1 border-l border-[var(--line)] pl-3", className)} {...props} />;
}

export function SidebarMenuSubItem({
  className,
  ...props
}: React.HTMLAttributes<HTMLLIElement>) {
  return <li className={cn(className)} {...props} />;
}

export function SidebarMenuSubButton({
  className,
  asChild = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn("inline-flex h-8 w-full items-center rounded-md px-2 text-sm text-slate-700 transition hover:bg-slate-100", className)}
      {...props}
    />
  );
}

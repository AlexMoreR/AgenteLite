export default function LoadingChatsPage() {
  return (
    <section className="chat-app-layout flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        <aside className="flex w-[380px] min-w-0 flex-col gap-4 rounded-3xl border border-[rgba(148,163,184,0.14)] bg-white p-4 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]">
          <div className="h-12 rounded-2xl bg-slate-100 animate-pulse" />
          <div className="flex flex-1 flex-col gap-3 overflow-hidden">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 rounded-2xl border border-slate-100 p-3">
                <div className="h-11 w-11 rounded-full bg-slate-100 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-slate-100 animate-pulse" />
                  <div className="h-3 w-full rounded bg-slate-50 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-[rgba(148,163,184,0.14)] bg-white shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]">
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4">
            <div className="h-10 w-10 rounded-full bg-slate-100 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-48 rounded bg-slate-100 animate-pulse" />
              <div className="h-3 w-28 rounded bg-slate-50 animate-pulse" />
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-end gap-3 px-4 py-4">
            <div className="ml-auto h-24 w-[72%] rounded-[1.5rem] bg-slate-100 animate-pulse" />
            <div className="h-20 w-[56%] rounded-[1.5rem] bg-slate-50 animate-pulse" />
          </div>

          <div className="border-t border-slate-100 p-3">
            <div className="h-12 rounded-2xl bg-slate-100 animate-pulse" />
          </div>
        </div>
      </div>
    </section>
  );
}

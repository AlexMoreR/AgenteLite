export default function CrmLoading() {
  return (
    <section className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-[76px] animate-pulse rounded-[22px] border border-[#c7d8ff] bg-[#f6f9ff] px-4 py-3.5"
          >
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-[#dbe7ff]" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-20 rounded bg-[#dbe7ff]" />
                <div className="h-2.5 w-28 rounded bg-[#e7efff]" />
              </div>
              <div className="h-5 w-8 rounded bg-[#dbe7ff]" />
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-[22px] border border-[var(--line)] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 rounded-xl border border-[var(--line)] bg-slate-50 p-1">
            <div className="h-8 w-20 animate-pulse rounded-lg bg-white" />
            <div className="h-8 w-20 animate-pulse rounded-lg bg-slate-100" />
          </div>
          <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
        </div>

        <div className="space-y-2 pt-1">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
    </section>
  );
}

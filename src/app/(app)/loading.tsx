/** Shown the instant you click a link, while the page's data loads. */
export default function Loading() {
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-56 rounded-md bg-chip" />
      <div className="h-4 w-80 max-w-full rounded bg-line2" />
      <div className="card p-4 flex flex-col gap-3 mt-2">
        <div className="flex gap-2"><div className="h-10 flex-1 max-w-md rounded-lg bg-line2" /><div className="h-10 w-24 rounded-lg bg-line2" /><div className="h-10 w-24 rounded-lg bg-line2" /></div>
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-9 rounded bg-[#f6f5f2]" />)}
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { pageUser, NAV_ROLES } from "@/lib/session";
import { trorView } from "@/lib/floor";
import { PickTROR } from "@/components/PickTROR";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await pageUser(NAV_ROLES.pick);
  const v = await trorView((await params).id);
  if (!v) notFound();
  if (v.status !== "PLANNED") return (
    <div className="p-4 lg:p-7"><div className="card p-6 max-w-xl"><div className="mono text-2xl font-semibold">{v.to}</div>
      <div className="mt-1">{v.status === "POSTED" ? "Already dispatched." : "Cancelled."}</div><Link className="btn-ghost mt-3" href={`/find?q=${v.to}`}>Open it</Link></div></div>);
  return <div className="p-4 lg:p-7 max-w-5xl min-w-0"><PickTROR initial={v as never} /></div>;
}

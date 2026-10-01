import { pageUser } from "@/lib/session";
import { repository } from "@/lib/fabrics";
import { FabricRepo } from "@/components/FabricRepo";

export default async function Page() {
  await pageUser(["ADMIN"]);
  const r = await repository();
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 min-w-0">
      <div><div className="h1">Fabric repository</div>
        <div className="sub">Fabric group × colour. Colour is unique inside a group. A new colour gets its Fabric # and SKU straight away: Single Jersey takes the next number, its Rib twin the same number + B (55 → 55B). You can type your own.</div></div>
      <FabricRepo groups={r.groups.map((g) => ({ ...g, createdAt: undefined }) as never)} loose={r.loose} />
    </div>
  );
}

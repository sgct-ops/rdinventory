import { pageUser, NAV_ROLES } from "@/lib/session";
import { ADJ_REASONS } from "@/lib/posting";
import { getSettings } from "@/lib/settings";
import { AdjustForm } from "@/components/AdjustForm";

export default async function Page({ searchParams }: { searchParams: Promise<{ serial?: string; reason?: string }> }) {
  const u = await pageUser(NAV_ROLES.adjust);
  const s = await getSettings();
  const sp = await searchParams;
  return (
    <div className="p-5 lg:p-7 flex flex-col gap-4">
      <div><div className="h1">Adjust a roll</div><div className="sub">For kg that changes without a transfer or consumption. Always with a reason. Nothing is deleted — a wrong adjustment is reversed.</div></div>
      <AdjustForm reasons={Object.entries(ADJ_REASONS)} initialSerial={sp.serial ?? ""}
        limitText={u.role === "ADMIN" ? "You are the admin: your adjustments post straight away." :
          `Changes above ${s.adjLimitKg} kg or ${s.adjLimitPct}% of the roll (whichever is ${s.adjLimitRule === "SMALLER" ? "smaller" : "larger"}) go to the admin as Pending and only change the roll once approved.`} />
    </div>
  );
}

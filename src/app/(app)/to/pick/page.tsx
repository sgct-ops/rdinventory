import { pageUser, NAV_ROLES } from "@/lib/session";
import { openTRORs } from "@/lib/floor";
import { TRORList } from "@/components/PickTROR";

export default async function Page() {
  await pageUser(NAV_ROLES.pick);
  const open = await openTRORs();
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 max-w-6xl min-w-0">
      <div><span className="pill bg-okbg text-ok font-semibold">TROR · PICK &amp; DISPATCH</span><div className="h1 mt-2">Pick a TROR</div>
        <div className="sub max-w-2xl">TRORs made in the office wait here. Scan the barcode on the PDF, scan each roll as it leaves the rack — the app checks it belongs to the TROR — then Dispatch. Stock moves only on Dispatch, so nothing is logged twice.</div></div>
      <TRORList open={open as never} />
    </div>
  );
}

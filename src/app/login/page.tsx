import { redirect } from "next/navigation";
import { signIn, devLoginEnabled } from "@/auth";
import { getCurrentUser } from "@/lib/session";

const ERRORS: Record<string, string> = {
  NotInvited: "This Google account isn't in Users yet. Ask the admin to add you.",
  Inactive: "Your access has been switched off. Ask the admin.",
  AccessDenied: "Access denied.",
  Configuration: "Sign-in isn't configured yet (Google client id / secret).",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { error } = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-8 flex flex-col gap-5">
        <div className="flex items-center gap-2.5 font-semibold"><div className="w-[22px] h-[22px] bg-ink rounded-[5px]" />Rajdanga Fabric</div>
        <div>
          <div className="text-xl font-semibold">Sign in</div>
          <div className="sub">Fabric inventory, TOs and the warehouse — one portal.</div>
        </div>
        {error && <div className="text-sm bg-badbg text-bad rounded-md px-3 py-2">{ERRORS[error] ?? "Sign-in failed. Try again."}</div>}
        <form action={async () => { "use server"; await signIn("google", { redirectTo: "/" }); }}>
          <button className="btn w-full h-11">Continue with Google</button>
        </form>
        {devLoginEnabled && (
          <form className="flex flex-col gap-2 border-t border-line pt-4" action={async (fd: FormData) => {
            "use server";
            await signIn("dev", { email: String(fd.get("email") || ""), redirectTo: "/" });
          }}>
            <div className="text-xs text-bad font-medium">TEST COPY ONLY — dev login is on (DEV_LOGIN=true)</div>
            <input name="email" className="input" placeholder="email of a user in Users" />
            <button className="btn-ghost">Dev sign in</button>
          </form>
        )}
      </div>
    </div>
  );
}

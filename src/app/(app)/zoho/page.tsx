import { pageUser } from "@/lib/session";
import { ZohoPrompt } from "@/components/ZohoPrompt";
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await pageUser(["ADMIN", "INVENTORY", "MERCHANDISER"]);
  return <ZohoPrompt initial={(await searchParams).q ?? ""} />;
}

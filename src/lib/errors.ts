/** A rule violation that should be shown to the person as-is. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}
export type ActionResult<T = unknown> = { ok: true; message?: string; data?: T } | { ok: false; error: string };

export async function run<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    // Unique violations from Postgres
    const err = e as { code?: string; detail?: string; cause?: { code?: string; detail?: string } };
    const code = err.code ?? err.cause?.code;
    if (code === "23505") return { ok: false, error: "That value is already used: " + (err.detail ?? err.cause?.detail ?? "duplicate") };
    if ((e as Error)?.message === "NEXT_REDIRECT") throw e;
    console.error(e);
    return { ok: false, error: "Something went wrong. Nothing was saved. (" + ((e as Error)?.message ?? "error") + ")" };
  }
}

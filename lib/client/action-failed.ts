// What a click handler gets when a server action throws.
//
// A handler that does `setBusy(true); const r = await someAction(); setBusy(false)`
// hangs if the action throws: the awaited call rejects, the lines after it
// never run, and the button sits on its busy label forever with no message
// (the Reports "Delete? Cancel …" bug). Appending `.catch(actionFailed)` turns
// the throw into the same `{ error }` shape the handler already knows how to
// show, so the busy state is always released.
//
// Next's own control-flow errors (redirect, notFound) must keep propagating
// or navigation after a successful action would break; unstable_rethrow does
// exactly that.
import { unstable_rethrow } from "next/navigation";

export const ACTION_FAILED_MESSAGE =
  "Something went wrong and this was not saved. Reload the page and try again.";

export function actionFailed(err: unknown): { error: string } {
  unstable_rethrow(err);
  console.error("server action failed", err);
  return { error: ACTION_FAILED_MESSAGE };
}

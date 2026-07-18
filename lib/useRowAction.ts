'use client'
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Runs a row-level mutation that has no confirm step (delete, toggle,
 * status/quantity change): guards against a double-submit while one is in
 * flight, then refreshes so the server-rendered row reflects the change.
 * The bare-button sibling of useDeleteConfirm, which adds the confirm-modal
 * state machine on top of the same idea.
 */
export function useRowAction() {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function run(action: () => Promise<unknown>) {
    if (pending) return;
    setPending(true);
    await action();
    setPending(false);
    router.refresh();
  }

  return { pending, run };
}

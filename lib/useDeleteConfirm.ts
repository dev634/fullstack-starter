'use client'
import { useState } from "react";
import { useRouter } from "next/navigation";

type DeleteActionResult = { type: "error" | "success"; message: string };

/**
 * Shared state machine behind every "trash icon → confirm modal → delete"
 * row action on the project detail page (series, categories, ...): confirm
 * dialog open state, in-flight state, and the error surfaced on failure.
 * Extracted after ProjectTaskGroupRow and ProjectTaskCategorySection ended
 * up hand-rolling the identical four pieces of state and handler.
 */
export function useDeleteConfirm(deleteAction: () => Promise<DeleteActionResult>) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleDelete() {
    setPending(true);
    setError(null);
    const res = await deleteAction();
    setPending(false);
    if (res.type === "error") {
      setError(res.message);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return { confirming, setConfirming, pending, error, handleDelete };
}

import Link from "next/link";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";

type ProjectHubCardProps = {
  href: string;
  icon: ReactNode;
  title: string;
  /**
   * Inline count appended right after the title inside the same `h2`, e.g.
   * `(3/10)` or `3 sous-traitant(s) · 2 intérimaire(s)`. Omitted entirely
   * when there's nothing to count yet — same convention every section link
   * on the hub already followed before this component existed.
   */
  counter?: string;
  /**
   * One- or two-line summary of what this section holds and what you do
   * there — never a paraphrase of `title` ("Gérer les tâches" under "Tâches"
   * is noise). Clamped to two lines so a long translation can't grow the
   * card or push the counter/arrow off a 360px screen.
   */
  description: string;
  /** Extra content under the description — currently only the réserves open/resolved pill. */
  children?: ReactNode;
};

/**
 * Shared chrome for every link-card on the project hub (Tâches, Interventions,
 * Personnel, Fichiers, Réserves). Extracted when all five gained a second
 * line (the description) on top of their existing title+counter row: the
 * `items-start` + `mt-1` mobile-first alignment the réserves card alone used
 * to need for its own two-line layout is now what every card needs, so it
 * lives here once instead of being hand-copied four more times.
 *
 * The whole card stays a single `<Link>` — the tap target — wrapping one
 * `h2` (icon + title + counter only, never the description) so the heading
 * structure a screen reader relies on doesn't grow a second level.
 */
export default function ProjectHubCard({ href, icon, title, counter, description, children }: ProjectHubCardProps) {
  return (
    <Link href={href} className="flex items-start justify-between gap-3 px-4 py-4 sm:px-6">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
          {icon}
          <span className="truncate">{title}</span>
          {counter && (
            <span className="shrink-0 text-sm font-normal text-gray-500 dark:text-gray-400">{counter}</span>
          )}
        </h2>
        <p className="line-clamp-2 text-sm text-gray-500 dark:text-gray-400">{description}</p>
        {children}
      </div>
      <ArrowRightIcon className="mt-1 h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
    </Link>
  );
}

/**
 * Short explanation attached to a list row — why a control is missing or
 * disabled ("Réservé au super admin"). Mobile first: on a narrow screen it
 * drops to its own line under the row (the parent `<li>` must be `flex
 * flex-wrap`), so a 60-character sentence never squeezes the name or overflows
 * at 360 px; from `sm:` up it sits inline between the name and the controls.
 * Text is gray-600 / gray-400: AA on both row backgrounds (6.9:1 and 5.8:1,
 * computed), where gray-500 on the light row is 4.4:1.
 */
export default function RowNote({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <span
      id={id}
      className="order-last basis-full text-xs text-gray-600 dark:text-gray-400 sm:order-none sm:max-w-xs sm:basis-auto"
    >
      {children}
    </span>
  );
}

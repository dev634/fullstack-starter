export type JobFunctionOption = { id: number; name: string };

/** Shared `<option>` list for job-function dropdowns: the empty "none" choice
 * plus one option per function. Renders only the options — the call site
 * keeps its own `<select>` (controlled or not, with whatever `name`/`value`
 * attributes it needs). */
export default function JobFunctionOptions({
  functions,
  noneLabel,
}: {
  functions: JobFunctionOption[];
  noneLabel: string;
}) {
  return (
    <>
      <option value="">{noneLabel}</option>
      {functions.map((f) => (
        <option key={f.id} value={f.id}>{f.name}</option>
      ))}
    </>
  );
}

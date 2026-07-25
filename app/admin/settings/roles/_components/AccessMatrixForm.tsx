'use client'
import { useState } from "react";
import { useTranslation } from "@/components/LocaleProvider";
import { setAccessConfig } from "@/actions/appSettings/appSettings";
import {
  ROLES,
  CAPABILITIES,
  LOCKED_CAPABILITIES,
  type Role,
  type Capability,
} from "@/lib/capabilities";
import { LockClosedIcon } from "@heroicons/react/24/outline";

type Props = {
  config: Record<Capability, Role>;
};

const isLocked = (cap: Capability) => LOCKED_CAPABILITIES.includes(cap);

export default function AccessMatrixForm({ config }: Props) {
  const { t } = useTranslation();
  const a = t.appSettings.access;

  const [values, setValues] = useState<Record<Capability, Role>>(config);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  function handleChange(cap: Capability, role: Role) {
    setValues((prev) => ({ ...prev, [cap]: role }));
    setDirty(true);
    setStatus("idle");
  }

  async function handleSave() {
    setStatus("saving");
    const result = await setAccessConfig(values);
    if (result.ok) {
      setStatus("saved");
      setDirty(false);
    } else {
      setStatus("error");
      setErrorMsg(result.message);
    }
  }

  return (
    <section className="rounded-lg border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] p-4 sm:p-6">
      <h2 className="text-lg font-semibold">{a.title}</h2>
      <p className="mt-1 mb-4 text-sm text-gray-500 dark:text-gray-400">{a.subtitle}</p>

      <ul className="flex flex-col gap-2">
        {CAPABILITIES.map((cap) => {
          const cap_t = a.capabilities[cap];
          const locked = isLocked(cap);
          return (
            <li
              key={cap}
              className="flex flex-col gap-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{cap_t.label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{cap_t.description}</p>
              </div>

              {locked ? (
                <span
                  className="inline-flex shrink-0 items-center gap-1.5 self-start rounded border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 sm:self-auto"
                  title={a.lockedNote}
                >
                  <LockClosedIcon className="h-4 w-4" />
                  {a.roles[values[cap]]}
                </span>
              ) : (
                <label className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
                  <span className="sr-only">
                    {cap_t.label} — {a.roleColumn}
                  </span>
                  <select
                    value={values[cap]}
                    onChange={(e) => handleChange(cap, e.target.value as Role)}
                    className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 sm:w-48"
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {a.roles[role]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <LockClosedIcon className="h-3.5 w-3.5 shrink-0" />
        {a.lockedNote}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        <span className="min-h-4 text-right text-xs" aria-live="polite">
          {status === "saving" && <span className="text-gray-500 dark:text-gray-400">{a.saving}</span>}
          {status === "saved" && <span className="text-green-600 dark:text-green-400">{a.saved}</span>}
          {status === "error" && <span className="text-red-500">{errorMsg || a.saveError}</span>}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || status === "saving"}
          className={`w-full rounded bg-primary px-4 py-2 text-center text-sm font-bold text-white hover:bg-primary/90 cursor-pointer ${
            !dirty || status === "saving" ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          {a.save}
        </button>
      </div>
    </section>
  );
}

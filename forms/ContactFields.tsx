import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ContactActionState } from "@/types/contact";
import JobFunctionOptions, { type JobFunctionOption } from "@/forms/JobFunctionOptions";

export type { JobFunctionOption };

export type ContactDefaults = {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  jobFunctionId?: number | null;
};

const inputClass =
  "w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500";

/** Shared name/function/email/phone inputs for the add & edit contact forms. Presentational: it reads `t`/`state`/`functions` from props, owns no state. */
export default function ContactFields({
  t,
  state,
  functions,
  defaults,
  autoFocus,
}: {
  t: Dictionary;
  state: ContactActionState;
  functions: JobFunctionOption[];
  defaults?: ContactDefaults;
  autoFocus?: boolean;
}) {
  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <input type="text" name="firstName" autoFocus={autoFocus} defaultValue={defaults?.firstName ?? ""} placeholder={t.contacts.firstNameLabel} aria-label={t.contacts.firstNameLabel} className={inputClass} />
          {state.type === "zodError" && state.fieldsForm?.firstName && (
            <p className="mt-1 text-xs text-red-500">{state.fieldsForm.firstName}</p>
          )}
        </div>
        <div className="flex-1">
          <input type="text" name="lastName" defaultValue={defaults?.lastName ?? ""} placeholder={t.contacts.lastNameLabel} aria-label={t.contacts.lastNameLabel} className={inputClass} />
          {state.type === "zodError" && state.fieldsForm?.lastName && (
            <p className="mt-1 text-xs text-red-500">{state.fieldsForm.lastName}</p>
          )}
        </div>
      </div>
      <select name="jobFunctionId" defaultValue={defaults?.jobFunctionId ?? ""} aria-label={t.contacts.roleLabel} className={inputClass}>
        <JobFunctionOptions functions={functions} noneLabel={t.contacts.functionNone} />
      </select>
      <div>
        <input type="email" name="email" defaultValue={defaults?.email ?? ""} placeholder={t.contacts.emailPlaceholder} aria-label={t.contacts.emailLabel} className={inputClass} />
        {state.type === "zodError" && state.fieldsForm?.email && (
          <p className="mt-1 text-xs text-red-500">{state.fieldsForm.email}</p>
        )}
      </div>
      <div>
        <input type="text" name="phone" defaultValue={defaults?.phone ?? ""} placeholder={t.contacts.phonePlaceholder} aria-label={t.contacts.phoneLabel} className={inputClass} />
        {state.type === "zodError" && state.fieldsForm?.phone && (
          <p className="mt-1 text-xs text-red-500">{state.fieldsForm.phone}</p>
        )}
      </div>
      {/* Fallback for a zodError with no field-specific message attached
          (e.g. clientId, resolved server-side) — was `type === "error"` only,
          so a zodError (the actual shape addContact/editContact return on
          invalid input) rendered nothing at all: the user clicked Enregistrer
          and saw no feedback while nothing was saved (adversarial pass on
          EDITOR, point 2). */}
      {(state.type === "error" || state.type === "zodError") && (
        <p className="text-xs text-red-500">{state.message}</p>
      )}
    </>
  );
}

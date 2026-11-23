'use client'
import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ContactActionState } from "@/types/contact";
import FormInput, { formInputClass } from "@/components/FormInput";
import JobFunctionOptions, { type JobFunctionOption } from "@/forms/JobFunctionOptions";

export type { JobFunctionOption };

export type ContactDefaults = {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  jobFunctionId?: number | null;
};

/** Shared name/function/email/phone inputs for the add & edit contact forms.
 * Every field is CONTROLLED: under `<form action>` React 19 resets uncontrolled
 * fields once the action returns — a validation error included — which put the
 * user's input back to its original values. The state lives here, inside the
 * modal's children, so it starts from `defaults` each time the modal reopens. */
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
  const [firstName, setFirstName] = useState(defaults?.firstName ?? "");
  const [lastName, setLastName] = useState(defaults?.lastName ?? "");
  const [jobFunctionId, setJobFunctionId] = useState(String(defaults?.jobFunctionId ?? ""));
  const [email, setEmail] = useState(defaults?.email ?? "");
  const [phone, setPhone] = useState(defaults?.phone ?? "");
  const errors = state.type === "zodError" ? state.fieldsForm : undefined;

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <FormInput
            type="text"
            name="firstName"
            autoFocus={autoFocus}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            label={t.contacts.firstNameLabel}
            error={errors?.firstName}
          />
        </div>
        <div className="flex-1">
          <FormInput
            type="text"
            name="lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            label={t.contacts.lastNameLabel}
            error={errors?.lastName}
          />
        </div>
      </div>
      <select
        name="jobFunctionId"
        value={jobFunctionId}
        onChange={(e) => setJobFunctionId(e.target.value)}
        aria-label={t.contacts.roleLabel}
        className={formInputClass}
      >
        <JobFunctionOptions functions={functions} noneLabel={t.contacts.functionNone} />
      </select>
      <FormInput
        type="email"
        name="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        label={t.contacts.emailLabel}
        placeholder={t.contacts.emailPlaceholder}
        error={errors?.email}
      />
      <FormInput
        type="text"
        name="phone"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        label={t.contacts.phoneLabel}
        placeholder={t.contacts.phonePlaceholder}
        error={errors?.phone}
      />
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

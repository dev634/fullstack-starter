import type { ComponentProps } from "react";

export const formInputClass =
  "w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500";

type FormInputProps = Omit<ComponentProps<"input">, "className" | "aria-label"> & {
  /** Accessible name — also the placeholder unless `placeholder` is given. */
  label: string;
  /** Field-level error shown under the input (undefined = none). */
  error?: string;
};

/** Compact form input: accessible name + optional field error beneath it.
 * Presentational and stateless — pass `value` + `onChange` to control it (the
 * rule under `<form action>`, whose reset wipes uncontrolled fields on a
 * validation error). */
export default function FormInput({ label, error, placeholder, id, name, ...rest }: FormInputProps) {
  const errorId = error && name ? `${name}-error` : undefined;
  return (
    <div>
      <input
        id={id}
        name={name}
        aria-label={label}
        placeholder={placeholder ?? label}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={formInputClass}
        {...rest}
      />
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}

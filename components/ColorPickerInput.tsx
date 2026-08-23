"use client";

type ColorPickerInputProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  /** Native swatch colour while `value` isn't a well-formed hex yet — a
   * partial value mid-typing, or (ReserveStatusStyleForm) a field left at
   * "not configured". Defaults to black, this component's original
   * behaviour from when every caller always had a real value set. Passing
   * the field's actual product default here (rather than leaving it at
   * black) matters: the hint text right below already names that default,
   * and the native swatch disagreeing with it — showing black while the
   * text says e.g. "#e11d48" — is a real, previously-shipped bug (two
   * contradictory colours for the same unconfigured field). */
  fallback?: string;
};

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export default function ColorPickerInput({ label, name, value, onChange, error, fallback = "#000000" }: ColorPickerInputProps) {
  return (
    <div className="mb-7">
      <label htmlFor={name} className="mb-1 block text-sm text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          // The native swatch only accepts a well-formed hex, so fall back to
          // `fallback` rather than feeding it a partial value while the user
          // types in the text field below.
          value={HEX_PATTERN.test(value) ? value : fallback}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded border border-gray-300 bg-white p-1 dark:border-gray-700 dark:bg-gray-800"
        />
        <input
          id={name}
          type="text"
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#3b82f6"
          className="w-full rounded border border-gray-300 bg-white p-2 text-gray-900 placeholder-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>
      {error && (
        <p className="mt-1 text-sm text-red-500" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}

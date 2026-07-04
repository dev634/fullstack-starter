
import { InputProps } from '@/types/inputs';


export function Input({label, name, type = "text", error, value, onChange, fullWidth}:InputProps) {
    return (
        <div key={name} className={`mb-7${fullWidth ? " sm:col-span-2" : ""}`}>
            <label htmlFor={name} className="sr-only">{label}</label>
            <input
                id={name}
                type={type}
                name={name}
                placeholder={label}
                className="w-full mb-2 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500"
                value={value}
                onChange={onChange}
            />
            {typeof error === "object" && error[name] && (
                <p className="text-start text-red-500 mb-6" aria-live="polite">
                    {error[name]}
                </p>
            )}
        </div>
    );
}
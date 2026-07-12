"use client";

import { useState } from 'react';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { InputProps } from '@/types/inputs';
import { useTranslation } from '@/components/LocaleProvider';

export function Input({label, name, type = "text", error, value, onChange, fullWidth, step}:InputProps) {
    const { t } = useTranslation();
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === "password";
    const inputType = isPassword && showPassword ? "text" : type;

    return (
        <div key={name} className={`mb-7${fullWidth ? " sm:col-span-2" : ""}`}>
            <label htmlFor={name} className="sr-only">{label}</label>
            <div className="relative">
                <input
                    id={name}
                    type={inputType}
                    name={name}
                    placeholder={label}
                    step={type === "number" ? (step ?? "any") : undefined}
                    className={`w-full mb-2 p-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500${isPassword ? " pr-10" : ""}`}
                    value={value}
                    onChange={onChange}
                />
                {isPassword && (
                    <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                        className="absolute right-2 top-1/2 -translate-y-1/2 -mt-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-pointer"
                    >
                        {showPassword ? (
                            <EyeSlashIcon className="h-5 w-5" />
                        ) : (
                            <EyeIcon className="h-5 w-5" />
                        )}
                    </button>
                )}
            </div>
            {typeof error === "object" && error[name] && (
                <p className="text-start text-red-500 mb-6" aria-live="polite">
                    {error[name]}
                </p>
            )}
        </div>
    );
}

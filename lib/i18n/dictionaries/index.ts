import fr from "./fr";
import en from "./en";
import type { Locale } from "../locale";
import type { Dictionary } from "./types";

const dictionaries: Record<Locale, Dictionary> = { fr, en };

export function getDictionary(locale: Locale): Dictionary {
    return dictionaries[locale];
}

export type { Dictionary };

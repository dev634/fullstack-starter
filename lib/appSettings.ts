import { unstable_cache } from "next/cache";
import { getSettings } from "@/repository/appSettings";

export const APP_SETTINGS_TAG = "app-settings";

/**
 * App-wide branding/theme, cached across requests since it changes rarely
 * (a SUPERADMIN edit) but is read on every page render (root layout).
 * Invalidated by actions/appSettings/appSettings.ts via revalidateTag.
 */
export const getAppSettings = unstable_cache(getSettings, ["app-settings"], {
    tags: [APP_SETTINGS_TAG],
});

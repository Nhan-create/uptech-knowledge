"use client";

import { Settings2 } from "lucide-react";

import { usePreferences } from "./PreferencesProvider";
import { requestPreferencesOpen } from "./preferences-events";

type SettingsLauncherProps = Readonly<{
  className?: string;
}>;

export function SettingsLauncher({ className = "" }: SettingsLauncherProps) {
  const { locale } = usePreferences();
  const label = locale === "vi" ? "Mở cài đặt hiển thị" : "Open display settings";

  return (
    <button
      type="button"
      onClick={(event) => requestPreferencesOpen(event.currentTarget)}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 text-sm font-semibold text-blue-300 transition-colors hover:border-blue-600 hover:bg-blue-950/40 hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${className}`}
    >
      <Settings2 aria-hidden="true" className="size-4" />
      {label}
    </button>
  );
}

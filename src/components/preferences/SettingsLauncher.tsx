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
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#0D1321]/14 bg-white px-4 text-sm font-semibold text-[#1635C7] transition-colors hover:border-[#1B44FF] hover:bg-[#EEF1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B44FF] ${className}`}
    >
      <Settings2 aria-hidden="true" className="size-4" />
      {label}
    </button>
  );
}

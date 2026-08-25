export const PREFERENCES_OPEN_EVENT = "uptech:preferences-open";
export const PREFERENCES_CLOSE_EVENT = "uptech:preferences-close";

export type PreferencesOpenDetail = Readonly<{
  returnFocusTo?: HTMLElement;
}>;

export function requestPreferencesOpen(returnFocusTo?: HTMLElement) {
  window.dispatchEvent(
    new CustomEvent<PreferencesOpenDetail>(PREFERENCES_OPEN_EVENT, {
      detail: { returnFocusTo },
    }),
  );
}

export function requestPreferencesClose() {
  window.dispatchEvent(new Event(PREFERENCES_CLOSE_EVENT));
}

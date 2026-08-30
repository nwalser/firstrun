import Check from "lucide-solid/icons/check";
import Languages from "lucide-solid/icons/languages";
import { For, Show } from "solid-js";
import { LOCALES, LOCALE_NAMES, useI18n } from "../lib/i18n/index.js";
import { DropdownMenuItem, DropdownMenuLabel } from "./ui/index.js";

/**
 * The language switcher, as a section of an existing menu.
 *
 * Not a menu of its own. Two languages is a list short enough to state in full,
 * and a submenu would hide the current answer behind a hover: the reason to
 * open this is either to change the language or to check which one is on, and
 * both are answered by seeing both rows with a tick against one.
 *
 * The names are endonyms and are not translated, so the row somebody needs is
 * readable whichever language they have landed in.
 *
 * Changing language costs no navigation and no reload. The cookie is written
 * from script and the signal re-renders the app, so a person switching in the
 * middle of a dashboard keeps the board they were looking at.
 */
export function LocaleSwitcher() {
  const i18n = useI18n();

  return (
    <>
      <DropdownMenuLabel class="flex items-center gap-2">
        <Languages class="size-3.5" />
        {i18n.t("locale.language")}
      </DropdownMenuLabel>

      <For each={LOCALES}>
        {(locale) => (
          <DropdownMenuItem
            class="gap-2"
            // The tick is decorative, so the active row is stated rather than
            // drawn. Without this a screen reader hears two identical rows.
            aria-current={i18n.locale() === locale ? "true" : undefined}
            // `closeOnSelect` stays default: the menu closes, the app re-renders
            // behind it in the new language, and that is the confirmation.
            onSelect={() => i18n.setLocale(locale)}
          >
            {/*
              `lang` on the name, not an aria-label spelling out "Switch to
              Deutsch": the visible text is already the accessible name, and
              this is what makes a screen reader pronounce "Deutsch" as German
              rather than reading it in the voice of the surrounding page.
            */}
            <span lang={locale} class="flex-1 truncate">
              {LOCALE_NAMES[locale]}
            </span>
            <Show when={i18n.locale() === locale}>
              <Check class="size-4 shrink-0" />
            </Show>
          </DropdownMenuItem>
        )}
      </For>
    </>
  );
}

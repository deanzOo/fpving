import { useId, useState } from "react";
import { applyTheme, readTheme, saveTheme, Theme } from "./theme.ts";

const CHOICES = [
  { theme: Theme.System, label: "System" },
  { theme: Theme.Light, label: "Light" },
  { theme: Theme.Dark, label: "Dark" },
] as const;

/**
 * The System, Light and Dark choice as a radio group: arrow keys move between the choices, the chosen one applies
 * at once and is remembered for the next visit.
 *
 * @returns The switch.
 */
export const ThemeSwitch = () => {
  const [chosen, choose] = useState(readTheme);
  const name = useId();
  const pick = (theme: Theme) => {
    choose(theme);
    saveTheme(theme);
    applyTheme(theme);
  };
  return (
    <fieldset className="flex rounded-1 border border-line-strong">
      <legend className="absolute inset-0 cursor-pointer appearance-none">Theme</legend>
      {CHOICES.map(({ theme, label }) => (
        <label
          key={theme}
          className={"focus-frame relative flex h-7 cursor-pointer items-center px-2 type-control text-ink-muted "
            + "hover:text-ink has-checked:bg-surface-raised has-checked:text-ink"}
        >
          <input
            type="radio"
            name={name}
            value={theme}
            checked={chosen === theme}
            onChange={() => {
              pick(theme);
            }}
            className="absolute inset-0 cursor-pointer appearance-none"
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
};

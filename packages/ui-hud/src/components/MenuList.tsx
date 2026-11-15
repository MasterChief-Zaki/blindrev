import { type KeyboardEvent, useEffect, useRef } from "react";
import { playSound } from "../sound/sound";

export interface MenuListItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface MenuListProps {
  items: MenuListItem[];
  /** Highlighted (selected) item id. */
  value: string;
  /** Highlight moved (Up/Down/W/S or pointer hover). */
  onChange(id: string): void;
  /** Item activated (Enter/Space or click). Never fires for disabled items. */
  onSelect(id: string): void;
  /** Accessible name of the menu. Default "Main menu". */
  label?: string;
  /** Focus the highlighted item on mount (menu screens). */
  autoFocus?: boolean;
}

/** The mockup's centred text menu: highlighted item cyan + heavier, others Pearl, disabled dimmed.
 *  Up/Down or W/S move (disabled items are skipped), Enter/Space select, hover highlights. Rows ≥ 44 px. */
export function MenuList({ items, value, onChange, onSelect, label = "Main menu", autoFocus = false }: MenuListProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(
    0,
    items.findIndex((i) => i.id === value),
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once on mount only
  useEffect(() => {
    if (autoFocus) refs.current[current]?.focus({ preventScroll: true });
  }, []);

  const move = (dir: 1 | -1) => {
    const n = items.length;
    for (let k = 1; k <= n; k++) {
      const i = (((current + dir * k) % n) + n) % n;
      const it = items[i];
      if (it && !it.disabled) {
        refs.current[i]?.focus();
        if (it.id !== value) {
          playSound("press");
          onChange(it.id);
        }
        return;
      }
    }
  };

  const activate = (it: MenuListItem) => {
    if (it.disabled) return;
    playSound("confirm");
    onSelect(it.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowDown":
      case "s":
      case "S":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
      case "w":
      case "W":
        e.preventDefault();
        move(-1);
        break;
      case "Home": {
        e.preventDefault();
        const i = items.findIndex((it) => !it.disabled);
        if (i >= 0) {
          refs.current[i]?.focus();
          onChange(items[i]!.id);
        }
        break;
      }
      case "End": {
        e.preventDefault();
        for (let i = items.length - 1; i >= 0; i--) {
          if (!items[i]!.disabled) {
            refs.current[i]?.focus();
            onChange(items[i]!.id);
            break;
          }
        }
        break;
      }
    }
  };

  return (
    <div className="br-menu" role="menu" aria-label={label} aria-orientation="vertical" onKeyDown={onKeyDown}>
      {items.map((it, i) => {
        const selected = i === current;
        return (
          <button
            key={it.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="menuitem"
            className={`br-menu__item${selected ? " is-selected" : ""}${it.disabled ? " is-disabled" : ""}`}
            tabIndex={selected ? 0 : -1}
            aria-disabled={it.disabled ? true : undefined}
            aria-current={selected ? "true" : undefined}
            onPointerEnter={() => {
              if (!it.disabled && it.id !== value) onChange(it.id);
            }}
            onFocus={() => {
              if (!it.disabled && it.id !== value) onChange(it.id);
            }}
            onClick={() => activate(it)}
            data-testid={`menu-${it.id}`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

export interface KeyHintProps {
  /** e.g. [{ key: "Enter", action: "Select" }, { key: "Esc", action: "Back" }] → "ENTER SELECT  /  ESC BACK". */
  hints: { key: string; action: string }[];
  className?: string;
}

/** Tracked-caps key legend for screen footers. */
export function KeyHint({ hints, className }: KeyHintProps) {
  return (
    <p className={["br-keyhint", className ?? ""].filter(Boolean).join(" ")} data-testid="key-hint">
      {hints.map((h, i) => (
        <span key={h.key + h.action} className="br-keyhint__item">
          {i > 0 ? (
            <span className="br-keyhint__sep" aria-hidden="true">
              /
            </span>
          ) : null}
          <kbd className="br-keyhint__key">{h.key}</kbd>
          <span className="br-keyhint__action">{h.action}</span>
        </span>
      ))}
    </p>
  );
}

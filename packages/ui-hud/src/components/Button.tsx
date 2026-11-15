import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { playSound } from "../sound/sound";
import { Icon, type IconName } from "./Icon";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "lg";
  icon?: IconName;
  /** Locked: shows a lock icon, stays focusable (aria-disabled), swallows clicks. */
  locked?: boolean;
  disabled?: boolean;
  /** Set false to suppress the automatic "press" sound (e.g. when the caller plays its own). */
  sound?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  locked = false,
  disabled = false,
  sound = true,
  className,
  children,
  onClick,
  type = "button",
  ...rest
}: ButtonProps) {
  const inert = locked || disabled;
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (inert) {
      e.preventDefault();
      return;
    }
    if (sound) playSound("press");
    onClick?.(e);
  };
  const cls = [
    "br-btn",
    `br-btn--${variant}`,
    `br-btn--${size}`,
    locked ? "is-locked" : "",
    disabled ? "is-disabled" : "",
    !children ? "br-btn--icon-only" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const shownIcon: IconName | undefined = locked ? "locked" : icon;
  return (
    <button
      {...rest}
      type={type}
      className={cls}
      // Locked stays focusable + discoverable (aria-disabled); disabled is a real native disabled.
      disabled={disabled}
      aria-disabled={locked ? true : undefined}
      data-locked={locked ? "true" : undefined}
      onClick={handleClick}
    >
      {shownIcon ? <Icon name={shownIcon} size={size === "lg" ? 24 : 16} /> : null}
      {children ? <span className="br-btn__label">{children}</span> : null}
      {locked ? <span className="br-visually-hidden"> (locked)</span> : null}
    </button>
  );
}

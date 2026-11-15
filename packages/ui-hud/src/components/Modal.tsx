import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

export interface ModalProps {
  open: boolean;
  title: string;
  onClose(): void;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
  /** Mono line above the title. */
  kicker?: string;
  "data-testid"?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getClientRects().length > 0,
  );
}

/** Focus-trapped dialog: aria-modal, background made inert, ESC closes, focus restored on close. */
export function Modal({ open, title, onClose, children, footer, size = "md", kicker, ...rest }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = rootRef.current;
    // Make every other top-level body child inert (and remember which ones we touched).
    const touched: HTMLElement[] = [];
    if (root) {
      for (const el of Array.from(document.body.children)) {
        if (el === root || !(el instanceof HTMLElement) || el.inert) continue;
        if (el.getAttribute("aria-live") || el.dataset.brLive === "true") continue; // keep the live region audible
        el.inert = true;
        touched.push(el);
      }
    }
    const dialog = dialogRef.current;
    if (dialog) {
      const list = focusables(dialog);
      let first = list.find((el) => !el.classList.contains("br-modal__close")) ?? list[0];
      // Never open scrolled away from the top: if the first control sits below the fold of the
      // scrolling body, start on the footer's primary action instead and keep the body at its top.
      const body = bodyRef.current;
      if (first && body?.contains(first)) {
        const b = body.getBoundingClientRect();
        const r = first.getBoundingClientRect();
        if (r.bottom > b.bottom || r.top < b.top) {
          first = list.find((el) => !el.classList.contains("br-modal__close") && !body.contains(el)) ?? first;
        }
      }
      (first ?? dialog).focus({ preventScroll: first ? !body?.contains(first) : true });
      if (body && !(first && body.contains(first))) body.scrollTop = 0;
    }
    // Bubble phase + defaultPrevented check: a child that consumes Escape (e.g. the ROI editor
    // deselecting a point) keeps the dialog open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      for (const el of touched) el.inert = false;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // The body is the only scrolling part: keep it reachable from a focused header/footer button.
    const body = bodyRef.current;
    if (body && !e.defaultPrevented && body.scrollHeight > body.clientHeight + 1) {
      const t = e.target as HTMLElement;
      const plain = t === dialogRef.current || (t.tagName === "BUTTON" && !body.contains(t) && !t.getAttribute("role"));
      const page = Math.max(80, body.clientHeight - 64);
      const delta =
        e.key === "PageDown"
          ? page
          : e.key === "PageUp"
            ? -page
            : plain && e.key === "ArrowDown"
              ? 64
              : plain && e.key === "ArrowUp"
                ? -64
                : 0;
      if (delta !== 0 && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) {
        e.preventDefault();
        body.scrollTop += delta;
        return;
      }
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const list = focusables(dialogRef.current);
    if (list.length === 0) {
      e.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="br-modal-root" ref={rootRef}>
      <div className="br-modal__scrim" aria-hidden="true" onClick={() => onCloseRef.current()} />
      <div
        ref={dialogRef}
        className={`br-modal br-modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid={rest["data-testid"] ?? "modal"}
      >
        <div className="br-modal__inner">
          <header className="br-modal__header">
            <div className="br-modal__titles">
              {kicker ? <p className="br-kicker">{kicker}</p> : null}
              <h2 id={titleId} className="br-h2 br-modal__title">
                {title}
              </h2>
            </div>
            <Button variant="ghost" icon="close" className="br-modal__close" onClick={() => onCloseRef.current()}>
              Close <span className="br-mono br-modal__esc">[ESC]</span>
            </Button>
          </header>
          <div className="br-modal__body" ref={bodyRef}>
            {children}
          </div>
          {footer ? <footer className="br-modal__footer">{footer}</footer> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

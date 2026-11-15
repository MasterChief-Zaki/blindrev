/** Brand toast (guide p9): matte card, bottom-right, icon + title + one line. Self-mounting — no provider needed.
 *  The host carries data-br-live so an open Modal does not make it inert. Screen readers get the text through
 *  `announce()` at the call site; the toast itself is visual only (aria-hidden) to avoid double speech. */
export interface ToastOptions {
  title: string;
  body?: string;
  tone?: "ok" | "alert";
  /** Milliseconds on screen. Default 4200. */
  duration?: number;
}

const CHECK =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z"/><path d="m8.4 12.2 2.5 2.5 4.8-5.2"/></svg>';
const ALERT =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 21 19H3z"/><path d="M12 10v4"/><path d="M12 16.6v.1"/></svg>';

function host(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let el = document.querySelector<HTMLElement>(".br-toasts");
  if (!el) {
    el = document.createElement("div");
    el.className = "br-toasts";
    el.dataset.brLive = "true";
    el.dataset.testid = "toasts";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
  }
  return el;
}

/** Show a toast. Returns a function that dismisses it early. */
export function toast(opts: ToastOptions): () => void {
  const root = host();
  if (!root) return () => {};
  const el = document.createElement("div");
  el.className = `br-toast br-toast--${opts.tone ?? "ok"}`;
  el.dataset.testid = "toast";
  const mark = document.createElement("span");
  mark.className = "br-toast__mark";
  mark.innerHTML = opts.tone === "alert" ? ALERT : CHECK;
  const title = document.createElement("span");
  title.className = "br-toast__title";
  title.textContent = opts.title;
  el.append(mark, title);
  if (opts.body) {
    const body = document.createElement("span");
    body.className = "br-toast__body";
    body.textContent = opts.body;
    el.append(body);
  }
  // Keep at most three on screen.
  while (root.children.length >= 3) root.firstElementChild?.remove();
  root.appendChild(el);
  let done = false;
  const dismiss = () => {
    if (done) return;
    done = true;
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 220);
  };
  el.addEventListener("click", dismiss);
  setTimeout(dismiss, opts.duration ?? 4200);
  return dismiss;
}

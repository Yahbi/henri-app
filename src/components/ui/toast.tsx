"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

/**
 * Toast severity. Aligned with common toast-library conventions
 * (react-hot-toast, sonner) — these are *notifications of what
 * happened*, not action intents.
 *
 * Semantic distinction from `Badge`:
 *   - Toast `"error"` = "something failed, surfacing to the user"
 *   - Badge `"destructive"` = "this action will destroy data"
 *
 * They both happen to render red but mean different things. Per the
 * design-system audit (2026-04-23), we explicitly keep these names
 * separate rather than collapsing to a single `destructive` token,
 * because the Toast message is describing an OUTCOME while the Badge
 * is describing a PENDING INTENT. If you need a toast for a confirmed
 * destructive action ("X leads archived"), use `type: "success"`
 * with the consequence spelled out in the title.
 */
type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

/* ------------------------------------------------------------------
   Context
   ------------------------------------------------------------------ */

const ToastContext = React.createContext<ToastContextValue | undefined>(
  undefined
);

/* ------------------------------------------------------------------
   Hook
   ------------------------------------------------------------------ */

function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

/* ------------------------------------------------------------------
   Provider
   ------------------------------------------------------------------ */

const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const addToast = React.useCallback((toast: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = React.useMemo(
    () => ({ toasts, addToast, removeToast }),
    [toasts, addToast, removeToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
};
ToastProvider.displayName = "ToastProvider";

/* ------------------------------------------------------------------
   Individual Toast Item
   ------------------------------------------------------------------ */

const typeStyles: Record<ToastType, string> = {
  success: "border-l-4 border-l-emerald-500",
  error: "border-l-4 border-l-destructive",
  warning: "border-l-4 border-l-amber-500",
  info: "border-l-4 border-l-primary",
};

const typeIcons: Record<ToastType, React.ReactNode> = {
  success: (
    <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
    <svg className="h-5 w-5 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 9l-6 6M9 9l6 6" />
    </svg>
  ),
  warning: (
    <svg className="h-5 w-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86l-8.58 14.86A1 1 0 002.59 21h18.82a1 1 0 00.88-1.28L13.71 3.86a1 1 0 00-1.42 0z" />
    </svg>
  ),
  info: (
    <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-4m0-4h.01" />
    </svg>
  ),
};

const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss,
}) => {
  const [exiting, setExiting] = React.useState(false);
  const duration = toast.duration ?? 5000;

  React.useEffect(() => {
    const exitTimer = setTimeout(() => setExiting(true), duration - 300);
    const removeTimer = setTimeout(() => onDismiss(toast.id), duration);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [toast.id, duration, onDismiss]);

  return (
    <div
      className={cn(
        "pointer-events-auto w-full max-w-sm rounded-lg bg-card border border-border shadow-lg",
        typeStyles[toast.type],
        exiting ? "animate-toast-slide-out" : "animate-toast-slide-in"
      )}
      role="alert"
    >
      <div className="flex items-start gap-3 p-4">
        <div className="flex-shrink-0 mt-0.5">{typeIcons[toast.type]}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-card-foreground">
            {toast.title}
          </p>
          {toast.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {toast.description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setExiting(true);
            setTimeout(() => onDismiss(toast.id), 300);
          }}
          className="flex-shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------
   Toast Container (renders all active toasts)
   ------------------------------------------------------------------ */

const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 w-full max-w-sm"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
};
ToastContainer.displayName = "ToastContainer";

export { ToastProvider, ToastContainer, useToast };
export type { Toast, ToastType };

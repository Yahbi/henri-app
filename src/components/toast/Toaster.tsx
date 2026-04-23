"use client";

/**
 * Tiny 60-line toast framework — no sonner / react-hot-toast dependency.
 *
 * Usage:
 *   1. Mount `<Toaster />` once near the top of a layout tree.
 *   2. In any client component, call `toast("Sent to alice@example.com")` or
 *      `toast.error("Send failed — network error")`.
 *
 * The Toaster renders a fixed top-right stack with auto-dismiss after 4s.
 * Zero-dep, small footprint, no FOIT, no animation dependencies.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

type ToastKind = "success" | "error";
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

let nextId = 1;
// Shared pub/sub — lives on the module so the `toast()` imperative API
// can dispatch from outside React without prop-drilling context.
const listeners = new Set<(t: ToastItem) => void>();

function publish(kind: ToastKind, text: string) {
  const id = nextId++;
  const item: ToastItem = { id, kind, text };
  listeners.forEach((l) => l(item));
}

export function toast(text: string) {
  publish("success", text);
}
toast.success = (text: string) => publish("success", text);
toast.error = (text: string) => publish("error", text);

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (item: ToastItem) => {
      setItems((prev) => [...prev, item]);
      setTimeout(() => {
        setItems((prev) => prev.filter((p) => p.id !== item.id));
      }, 4000);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[100] flex flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex min-w-[240px] max-w-sm items-start gap-2 rounded-lg border p-3 text-sm shadow-lg backdrop-blur-md ${
            t.kind === "success"
              ? "border-primary/30 bg-card text-foreground"
              : "border-destructive/40 bg-card text-destructive"
          }`}
        >
          {t.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p className="flex-1 leading-snug">{t.text}</p>
        </div>
      ))}
    </div>
  );
}

"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Send } from "lucide-react";
import { useLeads } from "@/hooks/useLeads";
import { useAddLeadNote } from "@/hooks/useLeads";
import { useUser } from "@/hooks/useUser";
import { Skeleton } from "@/components/ui/skeleton";
import type { Lead } from "@/types/lead";

interface Message {
  role: "outbound" | "inbound";
  text: string;
  time: string;
}

function parseNotes(notes: string | null | undefined): Message[] {
  if (!notes) return [];
  // Parse note lines that look like "2026-04-01T12:00:00Z [out]: message" or "[in]: message"
  const lines = notes.split("\n").filter(Boolean);
  return lines.flatMap((line): Message[] => {
    const match = line.match(/^(\d{4}-\d{2}-\d{2}T[^[]+)?\[(out|in)\]:\s*(.+)$/);
    if (match) {
      return [{ role: match[2] === "out" ? "outbound" : "inbound", text: match[3].trim(), time: match[1]?.trim() ?? "" }];
    }
    // Plain note lines show as outbound
    return [{ role: "outbound", text: line, time: "" }];
  });
}

function formatTime(isoStr: string) {
  if (!isoStr) return "";
  try {
    return new Date(isoStr).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

export default function MessagesPage() {
  const { user } = useUser();
  const { data: leads, isLoading } = useLeads();
  const addNote = useAddLeadNote();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const contactedLeads = useMemo<Lead[]>(
    () => (leads ?? []).filter((l) => ["contacted", "quoted", "proposal", "won"].includes(l.status)),
    [leads]
  );

  const selected = contactedLeads.find((l) => l.id === selectedId) ?? null;
  const messages = useMemo(() => parseNotes(selected?.notes), [selected]);

  useEffect(() => {
    if (contactedLeads.length > 0 && !selectedId) {
      setSelectedId(contactedLeads[0].id);
    }
  }, [contactedLeads, selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!draft.trim() || !selected || !user) return;
    const timestamp = new Date().toISOString();
    const newLine = `${timestamp} [out]: ${draft.trim()}`;
    const existing = selected.notes ? `${selected.notes}\n${newLine}` : newLine;
    await addNote.mutateAsync({ leadId: selected.id, note: existing });
    setDraft("");
  }

  return (
    <div className="flex h-full">
      {/* Semantic page heading for screen readers — the tab's split-pane
          layout already shows the brand + section in the sidebar, so the
          visible <h2> stays where it was. Plugs a11y gap G8. */}
      <h1 className="sr-only">Messages — Lead conversations</h1>

      {/* Conversation list */}
      <div className="w-[260px] shrink-0 border-r border-border bg-card flex flex-col">
        <div className="px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-foreground">Messages</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Lead conversations</p>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {isLoading ? (
            [...Array(4)].map((_, i) => (
              <div key={i} className="px-4 py-3 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))
          ) : contactedLeads.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No conversations yet. Contact a lead to start a thread.
            </div>
          ) : (
            contactedLeads.map((lead) => {
              const msgs = parseNotes(lead.notes);
              const last = msgs[msgs.length - 1];
              return (
                <button
                  key={lead.id}
                  onClick={() => setSelectedId(lead.id)}
                  className={`w-full text-left px-4 py-3 transition-colors ${
                    selectedId === lead.id ? "bg-primary-04" : "hover:bg-bg-subtle"
                  }`}
                >
                  <p className="text-xs font-semibold text-foreground truncate">
                    {lead.owner_name ?? [lead.owner_first, lead.owner_last].filter(Boolean).join(" ") ?? lead.address}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {last?.text ?? "No messages yet"}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 flex flex-col bg-background">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Select a conversation
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-5 py-3 border-b border-border shrink-0">
              <p className="text-sm font-semibold text-foreground">{selected.address}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selected.owner_name ?? [selected.owner_first, selected.owner_last].filter(Boolean).join(" ")}
                {selected.phone ? ` · ${selected.phone}` : ""}
              </p>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {messages.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-8">
                  No messages logged yet. Log your first note below.
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "outbound" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-xs rounded-xl px-3 py-2 text-xs ${
                      msg.role === "outbound"
                        ? "bg-primary text-white"
                        : "bg-card border border-border text-foreground"
                    }`}>
                      <p>{msg.text}</p>
                      {msg.time && (
                        <p className={`text-[10px] mt-0.5 ${msg.role === "outbound" ? "text-white/70" : "text-muted-foreground"}`}>
                          {formatTime(msg.time)}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Compose */}
            <div className="px-5 py-3 border-t border-border shrink-0 flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Log a note about this lead..."
                className="flex-1 px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={handleSend}
                disabled={!draft.trim() || addNote.isPending}
                className="p-2 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                aria-label="Log note"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

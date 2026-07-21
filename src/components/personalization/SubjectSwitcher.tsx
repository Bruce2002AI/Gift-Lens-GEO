"use client";

import { useState } from "react";
import { Check, Plus, Sparkles, User, Users, X } from "lucide-react";
import type { SubjectSummary } from "@/lib/agent/types";

/**
 * The profile switcher — who the conversation is about.
 *
 * "You" is always first and can never be removed. Named people follow, each
 * their own profile; the active one is highlighted, and only its profile shows
 * in the panel below. New people can be added by hand, but the agent also
 * creates them on its own as the shopper talks — those carry an "AI" mark.
 */
export function SubjectSwitcher({
  subjects,
  activeSubjectId,
  busy,
  onSelect,
  onCreate,
  onDelete,
}: {
  subjects: SubjectSummary[];
  activeSubjectId: string;
  busy: boolean;
  onSelect: (subjectId: string) => void;
  onCreate: (name: string, relationship: string | null) => void;
  onDelete: (subject: SubjectSummary) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const submitNew = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, relationship.trim() || null);
    setName("");
    setRelationship("");
    setAdding(false);
  };

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          <Users size={13} aria-hidden />
          Shopping for
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => setAdding((a) => !a)}
          aria-expanded={adding}
          className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-plum transition-colors hover:border-plum/50 hover:bg-sand disabled:opacity-40"
        >
          <Plus size={12} aria-hidden />
          New profile
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5" role="list" aria-label="Profiles">
        {subjects.map((s) => {
          const active = s.subjectId === activeSubjectId;
          if (confirmId === s.subjectId) {
            return (
              <span
                key={s.subjectId}
                className="inline-flex items-center gap-1.5 rounded-full border border-danger/40 bg-danger/5 px-2.5 py-1 text-xs"
              >
                <span className="text-ink">Remove {s.name}?</span>
                <button
                  type="button"
                  aria-label={`Confirm removing ${s.name}`}
                  onClick={() => {
                    onDelete(s);
                    setConfirmId(null);
                  }}
                  className="rounded p-0.5 text-danger hover:bg-danger/10"
                >
                  <Check size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="Keep profile"
                  onClick={() => setConfirmId(null)}
                  className="rounded p-0.5 text-ink-soft hover:bg-sand"
                >
                  <X size={13} aria-hidden />
                </button>
              </span>
            );
          }
          return (
            <span
              key={s.subjectId}
              role="listitem"
              className={`group inline-flex items-center gap-1 rounded-full border transition ${
                active
                  ? "border-plum bg-plum text-white"
                  : "border-line bg-white text-ink hover:border-plum/40"
              }`}
            >
              <button
                type="button"
                disabled={busy || active}
                onClick={() => onSelect(s.subjectId)}
                aria-pressed={active}
                title={
                  s.kind === "self"
                    ? "Your own profile"
                    : `${s.name}${s.relationship ? ` — your ${s.relationship}` : ""}${
                        s.createdBy === "agent" ? " (added by the agent)" : ""
                      }`
                }
                className="inline-flex items-center gap-1.5 py-1 pl-2.5 pr-1 text-xs font-medium disabled:cursor-default"
              >
                {s.kind === "self" ? <User size={12} aria-hidden /> : null}
                <span>{s.name}</span>
                {s.relationship && (
                  <span className={active ? "text-white/70" : "text-ink-soft"}>· {s.relationship}</span>
                )}
                {s.createdBy === "agent" && (
                  <Sparkles size={11} aria-hidden className={active ? "text-white/80" : "text-plum"} />
                )}
              </button>
              {s.kind === "person" ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${s.name}'s profile`}
                  onClick={() => setConfirmId(s.subjectId)}
                  className={`mr-1 rounded-full p-0.5 transition-colors disabled:opacity-40 ${
                    active ? "text-white/70 hover:bg-white/20" : "text-ink-soft hover:text-danger"
                  }`}
                >
                  <X size={12} aria-hidden />
                </button>
              ) : (
                <span className="pr-1.5" aria-hidden />
              )}
            </span>
          );
        })}
      </div>

      {adding && (
        <form
          className="mt-2.5 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-sand/40 p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            submitNew();
          }}
        >
          <div className="min-w-0 flex-1">
            <label htmlFor="new-subject-name" className="mb-0.5 block text-[11px] font-medium text-ink-soft">
              Name
            </label>
            <input
              id="new-subject-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Priya"
              className="field-input !py-1.5 text-sm"
            />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="new-subject-rel" className="mb-0.5 block text-[11px] font-medium text-ink-soft">
              Relationship <span className="font-normal">(optional)</span>
            </label>
            <input
              id="new-subject-rel"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              placeholder="sister, colleague…"
              className="field-input !py-1.5 text-sm"
            />
          </div>
          <button type="submit" disabled={!name.trim() || busy} className="btn-primary !py-1.5 text-sm">
            Add
          </button>
        </form>
      )}
    </div>
  );
}

export default SubjectSwitcher;

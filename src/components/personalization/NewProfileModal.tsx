"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

const RELATIONSHIPS = ["Partner", "Parent", "Sibling", "Friend", "Colleague", "Child"];

/**
 * "Who are you shopping for?" — creates a person profile up front (name +
 * relationship + optional interests). The profile fills itself in as the
 * shopper chats; this modal just captures the basics.
 */
export function NewProfileModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, relationship: string | null, interests: string) => void;
}) {
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState<string | null>(null);
  const [interests, setInterests] = useState("");
  const [wasOpen, setWasOpen] = useState(open);

  // Reset the form when it (re)opens — render-time pattern, no effect.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setRelationship(null);
      setInterests("");
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const start = () => {
    onCreate(name.trim() || "Someone new", relationship, interests.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/40 p-4">
      <div
        className="absolute inset-0"
        role="presentation"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Who are you shopping for?"
        className="animate-rise relative z-[1] w-[460px] max-w-full rounded-[28px] bg-white p-[30px] text-left shadow-[0_40px_90px_-20px_rgba(28,34,48,.4)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 grid h-[34px] w-[34px] place-items-center rounded-full text-ink-soft transition-colors hover:bg-paper hover:text-ink"
        >
          <X size={17} aria-hidden />
        </button>

        <h3 className="font-(family-name:--font-display) text-[23px] font-semibold tracking-[-0.01em]">
          Who are you shopping for?
        </h3>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] text-ink-soft">
          Just the basics — the profile fills itself in as you chat.
        </p>

        <div className="mt-5">
          <label htmlFor="np-name" className="mb-[7px] block text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            What do you call them
          </label>
          <input
            id="np-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My brother, Priya, Dad..."
            className="w-full rounded-xl border border-line bg-paper px-[13px] py-2.5 text-[14px] text-ink outline-none transition-colors focus:border-plum focus:bg-white"
          />
        </div>

        <div className="mt-5">
          <span className="mb-[7px] block text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            They are your
          </span>
          <div className="flex flex-wrap gap-[7px]">
            {RELATIONSHIPS.map((r) => {
              const sel = relationship === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRelationship(sel ? null : r)}
                  aria-pressed={sel}
                  className={`rounded-full border px-3.5 py-2 text-[13px] font-medium transition-all ${
                    sel
                      ? "border-transparent bg-butter font-semibold text-ink"
                      : "border-line bg-paper text-ink hover:bg-butter-soft hover:border-transparent"
                  }`}
                >
                  {r}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5">
          <label htmlFor="np-interests" className="mb-[7px] block text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            What are they into{" "}
            <span className="font-medium normal-case tracking-normal">(optional)</span>
          </label>
          <input
            id="np-interests"
            value={interests}
            onChange={(e) => setInterests(e.target.value)}
            placeholder="Formula 1, filter coffee, pottery..."
            className="w-full rounded-xl border border-line bg-paper px-[13px] py-2.5 text-[14px] text-ink outline-none transition-colors focus:border-plum focus:bg-white"
          />
        </div>

        <button
          type="button"
          onClick={start}
          className="mt-4 w-full rounded-full bg-plum py-[13px] text-[14.5px] font-semibold text-white transition-colors hover:bg-plum-dark"
        >
          Start shopping for them
        </button>
      </div>
    </div>
  );
}

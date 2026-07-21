"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { RefreshCw, Sparkles } from "lucide-react";
import { CompletionRing } from "@/components/personalization/CompletionRing";
import {
  LivingProfileForm,
  filledKeysFromFacts,
} from "@/components/personalization/LivingProfileForm";
import { PrivacyPanel } from "@/components/personalization/PrivacyPanel";
import { RecordEditor } from "@/components/personalization/RecordEditor";
import { useToast } from "@/components/ui/ToastProvider";
import { humanizeKey } from "@/lib/personalization/ledger-bridge";
import {
  completionForLens,
  findField,
  resolveFieldForKey,
  type ProfileField,
} from "@/lib/personalization/schema";
import {
  LENS_LABELS,
  RECORD_KINDS,
  RECORD_KIND_LENS,
  needsConfirmation,
  type ConsentScope,
  type FactPatch,
  type FactValue,
  type OutcomeEvent,
  type ProfileFact,
  type ProfileLens,
  type ProfileRecord,
  type RecordKind,
} from "@/lib/personalization/types";

/**
 * The Personalization Center — everything the expert remembers about you,
 * shown in your words, editable and deletable.
 *
 * This reads the profile you OWN (facts grouped by the lens they were given
 * to), not the consent-filtered "what can this lens see" view, because the
 * point of the page is managing your own data rather than auditing visibility.
 *
 * The page is the only thing here that talks to the network: the form and the
 * record editors are presentational, so every mutation arrives as a callback
 * and leaves as one request whose response is folded back into state.
 */

/** Tab order — shared first, since it informs every other lens. */
const TAB_LENSES: readonly ProfileLens[] = [
  "shared",
  "gift",
  "skincare",
  "style",
  "nutrition",
];

interface ApiEnvelope {
  ok?: boolean;
  error?: string;
  fact?: ProfileFact;
  facts?: ProfileFact[];
  record?: ProfileRecord;
  records?: ProfileRecord[];
  outcomes?: OutcomeEvent[];
}

async function getJson(url: string): Promise<ApiEnvelope> {
  const res = await fetch(url);
  const data = (await res.json().catch(() => ({}))) as ApiEnvelope;
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? "Something went wrong loading your profile.");
  }
  return data;
}

/** One mutation, with the server's own error text preserved for the toast. */
async function sendJson(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
  fallback = "That change could not be saved.",
): Promise<ApiEnvelope> {
  const res = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = (await res.json().catch(() => ({}))) as ApiEnvelope;
  if (!res.ok || !data.ok) throw new Error(data.error ?? fallback);
  return data;
}

interface ProfilePayload {
  facts: ProfileFact[];
  records: ProfileRecord[];
  outcomes: OutcomeEvent[];
}

/** Pure I/O: fetches the profile without touching React state. */
async function fetchProfile(): Promise<ProfilePayload> {
  const [f, r, o] = await Promise.all([
    getJson("/api/personalization/facts"),
    getJson("/api/personalization/records"),
    getJson("/api/personalization/outcomes"),
  ]);
  return {
    facts: f.facts ?? [],
    records: r.records ?? [],
    outcomes: o.outcomes ?? [],
  };
}

const IDENTITY = (category: string, key: string) => `${category}.${key}`;

/**
 * Which field a stored fact belongs to, mirroring the form's own resolution so
 * "the row that is saving" and "the fact being saved" agree — including when
 * the agent filed it under an alias (`recipient.loves` → Their interests).
 */
function fieldForFact(fact: ProfileFact): ProfileField | null {
  return (
    findField(fact.lens, fact.category, fact.key) ??
    resolveFieldForKey(fact.lens, IDENTITY(fact.category, fact.key))
  );
}

/** The busy identity a fact's row is keyed on. */
function busyKeyForFact(fact: ProfileFact): string {
  const field = fieldForFact(fact);
  if (field && field.lens === fact.lens) {
    return IDENTITY(field.category, field.key);
  }
  return IDENTITY(fact.category, fact.key);
}

function isEmpty(value: FactValue | null): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "number") return Number.isNaN(value);
  return false;
}

export function PersonalizationCenter({ embedded = false }: { embedded?: boolean }) {
  const { status } = useSession();
  const { toast } = useToast();

  const [facts, setFacts] = useState<ProfileFact[]>([]);
  const [records, setRecords] = useState<ProfileRecord[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLens, setActiveLens] = useState<ProfileLens>("shared");
  /** `"category.key"` of the field currently saving. */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<RecordKind | null>(null);
  const [resetting, setResetting] = useState(false);

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Bumped by "Try again" to re-run the load effect.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchProfile();
        if (cancelled) return;
        setFacts(data.facts);
        setRecords(data.records);
        setOutcomes(data.outcomes);
        setError(null);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Could not load your profile.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, reloadKey]);

  /** Record kinds this lens owns. The shared tab owns none. */
  const lensKinds = useMemo(
    () => RECORD_KINDS.filter((kind) => RECORD_KIND_LENS[kind] === activeLens),
    [activeLens],
  );

  const completion = useMemo(
    () => completionForLens(activeLens, filledKeysFromFacts(facts, activeLens)),
    [facts, activeLens],
  );

  /** Fold a server-confirmed fact back into the list, replacing by id. */
  const applyFact = useCallback((next: ProfileFact) => {
    setFacts((prev) => {
      const seen = prev.some((f) => f.id === next.id);
      return seen ? prev.map((f) => (f.id === next.id ? next : f)) : [next, ...prev];
    });
  }, []);

  // -------------------------------------------------------------------------
  // Facts
  // -------------------------------------------------------------------------

  /**
   * Saving a field. An emptied control is a deletion, not an empty value — a
   * stored `""` would read to the agent as "they answered, and the answer is
   * nothing".
   */
  const handleSave = useCallback(
    async (field: ProfileField, value: FactValue | null) => {
      const identity = IDENTITY(field.category, field.key);
      // The fact this control is showing, which may live under an alias key.
      const existing = facts.find(
        (f) => f.lens === field.lens && busyKeyForFact(f) === identity,
      );

      setBusyKey(identity);
      try {
        if (isEmpty(value)) {
          if (!existing) return;
          await sendJson(
            `/api/personalization/facts/${existing.id}`,
            "DELETE",
            undefined,
            "That could not be cleared.",
          );
          setFacts((prev) => prev.filter((f) => f.id !== existing.id));
          toast(`Cleared “${field.label}”.`, "success");
          return;
        }

        const data = await sendJson("/api/personalization/facts", "POST", {
          lens: field.lens,
          category: field.category,
          key: field.key,
          value,
          source: "explicit",
          confidence: 1,
          sensitivity: field.sensitivity ?? "standard",
          consentScope: "lens_only",
        });
        if (!data.fact) throw new Error("That change could not be saved.");
        applyFact(data.fact);

        // The shopper has now answered this field directly, so an older fact
        // the agent filed under an alias would only render as a duplicate.
        if (existing && existing.id !== data.fact.id) {
          const staleId = existing.id;
          setFacts((prev) => prev.filter((f) => f.id !== staleId));
          void fetch(`/api/personalization/facts/${staleId}`, { method: "DELETE" });
        }
      } catch (err) {
        toast(
          err instanceof Error ? err.message : "That change could not be saved.",
          "error",
        );
        // Roll back to whatever the server last told us.
        setFacts((prev) =>
          existing ? prev.map((f) => (f.id === existing.id ? existing : f)) : prev,
        );
      } finally {
        setBusyKey(null);
      }
    },
    [applyFact, facts, toast],
  );

  /** Optimistic PATCH: apply locally, reconcile with the response, roll back. */
  const patchFact = useCallback(
    async (
      fact: ProfileFact,
      patch: FactPatch,
      optimistic: ProfileFact,
      successMessage: string,
    ) => {
      setBusyKey(busyKeyForFact(fact));
      applyFact(optimistic);
      try {
        const data = await sendJson(
          `/api/personalization/facts/${fact.id}`,
          "PATCH",
          patch,
        );
        if (!data.fact) throw new Error("That change could not be saved.");
        applyFact(data.fact);
        toast(successMessage, "success");
      } catch (err) {
        applyFact(fact);
        toast(
          err instanceof Error ? err.message : "That change could not be saved.",
          "error",
        );
      } finally {
        setBusyKey(null);
      }
    },
    [applyFact, toast],
  );

  const handleConfirm = useCallback(
    (fact: ProfileFact) => {
      void patchFact(
        fact,
        { confirm: true },
        {
          ...fact,
          source: "explicit",
          confidence: 1,
          lastConfirmedAt: new Date().toISOString(),
        },
        "Confirmed — thanks.",
      );
    },
    [patchFact],
  );

  const handleConsentChange = useCallback(
    (fact: ProfileFact, scope: ConsentScope) => {
      void patchFact(
        fact,
        { consentScope: scope },
        { ...fact, consentScope: scope },
        scope === "approved_cross_lens"
          ? "Now used across every lens."
          : "Kept to this lens only.",
      );
    },
    [patchFact],
  );

  const handleDeleteFact = useCallback(
    async (fact: ProfileFact) => {
      setBusyKey(busyKeyForFact(fact));
      setFacts((prev) => prev.filter((f) => f.id !== fact.id));
      try {
        await sendJson(
          `/api/personalization/facts/${fact.id}`,
          "DELETE",
          undefined,
          "That fact could not be deleted.",
        );
        toast(`Deleted “${humanizeKey(fact.category, fact.key)}”.`, "success");
      } catch (err) {
        // Put it back rather than pretending it went.
        setFacts((prev) => (prev.some((f) => f.id === fact.id) ? prev : [fact, ...prev]));
        toast(
          err instanceof Error ? err.message : "That fact could not be deleted.",
          "error",
        );
      } finally {
        setBusyKey(null);
      }
    },
    [toast],
  );

  const handleConfirmAll = useCallback(() => {
    // Sequential rather than parallel: each PATCH is a separate write, and a
    // burst of them would trip the route's own rate guard.
    void (async () => {
      // Same set the form badges as "Inferred", so the count on the button and
      // the work done here can never disagree.
      const pending = facts.filter(
        (f) => f.lens === activeLens && needsConfirmation(f),
      );
      for (const fact of pending) {
        try {
          const data = await sendJson(
            `/api/personalization/facts/${fact.id}`,
            "PATCH",
            { confirm: true },
          );
          if (data.fact) applyFact(data.fact);
        } catch {
          // Reported once below rather than once per fact.
        }
      }
      if (pending.length > 0) toast("Confirmed what we'd guessed.", "success");
    })();
  }, [activeLens, applyFact, facts, toast]);

  // -------------------------------------------------------------------------
  // Records
  // -------------------------------------------------------------------------

  const handleRecordCreate = useCallback(
    async (kind: RecordKind, label: string, data: Record<string, FactValue>) => {
      setBusyKind(kind);
      try {
        const res = await sendJson("/api/personalization/records", "POST", {
          kind,
          label,
          data,
        });
        if (!res.record) throw new Error("That entry could not be saved.");
        const created = res.record;
        setRecords((prev) => [created, ...prev]);
        toast(`Saved “${created.label}”.`, "success");
      } catch (err) {
        toast(
          err instanceof Error ? err.message : "That entry could not be saved.",
          "error",
        );
        // Rethrown so the editor stays open with everything still typed in it.
        throw err;
      } finally {
        setBusyKind(null);
      }
    },
    [toast],
  );

  const handleRecordUpdate = useCallback(
    async (
      kind: RecordKind,
      record: ProfileRecord,
      label: string,
      data: Record<string, FactValue>,
    ) => {
      setBusyKind(kind);
      const previous = record;
      setRecords((prev) =>
        prev.map((r) => (r.id === record.id ? { ...r, label, data } : r)),
      );
      try {
        const res = await sendJson(
          `/api/personalization/records/${record.id}`,
          "PATCH",
          { kind, label, data },
        );
        if (!res.record) throw new Error("That entry could not be saved.");
        const saved = res.record;
        setRecords((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
        toast(`Updated “${saved.label}”.`, "success");
      } catch (err) {
        setRecords((prev) => prev.map((r) => (r.id === previous.id ? previous : r)));
        toast(
          err instanceof Error ? err.message : "That entry could not be saved.",
          "error",
        );
        throw err;
      } finally {
        setBusyKind(null);
      }
    },
    [toast],
  );

  const handleRecordDelete = useCallback(
    async (kind: RecordKind, record: ProfileRecord) => {
      setBusyKind(kind);
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
      try {
        await sendJson(
          `/api/personalization/records/${record.id}`,
          "DELETE",
          undefined,
          "That entry could not be deleted.",
        );
        toast(`Deleted “${record.label}”.`, "success");
      } catch (err) {
        setRecords((prev) =>
          prev.some((r) => r.id === record.id) ? prev : [record, ...prev],
        );
        toast(
          err instanceof Error ? err.message : "That entry could not be deleted.",
          "error",
        );
        throw err;
      } finally {
        setBusyKind(null);
      }
    },
    [toast],
  );

  const handleReset = useCallback(async () => {
    setResetting(true);
    try {
      await sendJson(
        "/api/personalization/reset",
        "POST",
        undefined,
        "Your data could not be deleted.",
      );
      setFacts([]);
      setRecords([]);
      setOutcomes([]);
      toast("Everything we stored has been deleted.", "success");
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Your data could not be deleted.",
        "error",
      );
    } finally {
      setResetting(false);
    }
  }, [toast]);

  /** Arrow/Home/End move between tabs, per the WAI-ARIA tabs pattern. */
  function onTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TAB_LENSES.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    setActiveLens(TAB_LENSES[next]);
    tabRefs.current[next]?.focus();
  }

  // -------------------------------------------------------------------------
  // Signed out
  // -------------------------------------------------------------------------
  if (status === "unauthenticated") {
    return (
      <div className={embedded ? "" : "mx-auto max-w-3xl px-4 py-16 sm:px-6"}>
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-plum-wash text-plum">
            <Sparkles size={22} aria-hidden />
          </span>
          <h1 className="font-(family-name:--font-display) text-2xl font-semibold">
            Sign in to see what we remember
          </h1>
          <p className="max-w-md text-sm text-ink-soft">
            Your personalization profile is tied to your account, so you&apos;ll
            need to sign in to review, edit or delete it.
          </p>
          <Link
            href="/login?callbackUrl=/personalization"
            className="btn-primary mt-1 text-sm"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  // Derived rather than stored, so the first load needs no setState in an effect.
  const initialising =
    status === "loading" || (status === "authenticated" && !loaded && !error);

  return (
    <div className={embedded ? "" : "mx-auto max-w-5xl px-4 py-8 sm:px-6"}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <h1
            className={`font-(family-name:--font-display) font-semibold ${
              embedded ? "text-xl" : "text-3xl"
            }`}
          >
            Personalization Center
          </h1>
          <p className={`mt-1 max-w-xl text-ink-soft ${embedded ? "text-sm" : ""}`}>
            What the expert remembers about you, and what it&apos;s allowed to use
            it for. Everything here is editable — correct it, or delete it.
          </p>
        </div>
        {!initialising && !error && !embedded && (
          <CompletionRing
            value={completion.percent}
            label={`${LENS_LABELS[activeLens]} profile`}
          />
        )}
      </header>

      {/* Tabs */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div
          role="tablist"
          aria-label="Profile lenses"
          className="flex min-w-max gap-2 border-b border-line pb-2"
        >
          {TAB_LENSES.map((lens, i) => {
            const selected = lens === activeLens;
            const count = facts.filter((f) => f.lens === lens).length;
            return (
              <button
                key={lens}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`lens-tab-${lens}`}
                aria-selected={selected}
                aria-controls={`lens-panel-${lens}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveLens(lens)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  selected
                    ? "bg-plum text-white"
                    : "border border-line bg-white text-ink-soft hover:border-plum hover:text-plum"
                }`}
              >
                {LENS_LABELS[lens]}
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-xs ${
                      selected ? "bg-white/20 text-white" : "bg-sand text-ink-soft"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Panel */}
      <div
        role="tabpanel"
        id={`lens-panel-${activeLens}`}
        aria-labelledby={`lens-tab-${activeLens}`}
        tabIndex={0}
        className="mt-6 focus-visible:outline-none"
      >
        {error && !initialising ? (
          <div className="card flex flex-col items-center gap-3 p-10 text-center">
            <p className="font-medium text-danger">{error}</p>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => {
                // Clearing the error flips the view back to the skeleton;
                // the bumped key re-runs the load effect.
                setError(null);
                setReloadKey((k) => k + 1);
              }}
            >
              <RefreshCw size={14} aria-hidden />
              Try again
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* The whole lens as one editable form — already filled in wherever
                the agent learned something, blank where it hasn't. */}
            <LivingProfileForm
              key={activeLens}
              lens={activeLens}
              facts={facts}
              loading={initialising}
              busyKey={busyKey}
              onSave={handleSave}
              onConfirm={handleConfirm}
              onDelete={handleDeleteFact}
              onConsentChange={handleConsentChange}
              onConfirmAll={handleConfirmAll}
            />

            {!initialising &&
              lensKinds.map((kind) => (
                <RecordEditor
                  key={kind}
                  kind={kind}
                  records={records.filter((r) => r.kind === kind)}
                  busy={busyKind === kind}
                  onCreate={(label, data) => handleRecordCreate(kind, label, data)}
                  onUpdate={(record, label, data) =>
                    handleRecordUpdate(kind, record, label, data)
                  }
                  onDelete={(record) => handleRecordDelete(kind, record)}
                />
              ))}

            {!initialising && facts.length === 0 && records.length === 0 && (
              <div className="card flex flex-col items-center gap-2 p-8 text-center">
                <p className="font-(family-name:--font-display) text-xl">
                  Nothing stored yet
                </p>
                <p className="max-w-sm text-sm text-ink-soft">
                  Fill anything in above, or just start chatting — the expert
                  remembers as you go.
                </p>
                <Link href="/shop" className="btn-primary mt-2 text-sm">
                  Start a conversation
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      <PrivacyPanel
        onReset={() => void handleReset()}
        busy={resetting}
        counts={{
          facts: facts.length,
          records: records.length,
          outcomes: outcomes.length,
        }}
      />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { LivingProfileForm } from "@/components/personalization/LivingProfileForm";
import { useToast } from "@/components/ui/ToastProvider";
import type { ExpertEvent } from "@/lib/agent/types";
import type { ProfileField } from "@/lib/personalization/schema";
import {
  isProfileLens,
  type ConsentScope,
  type FactPatch,
  type FactValue,
  type ProfileFact,
  type ProfileLens,
} from "@/lib/personalization/types";

/**
 * The Living Profile, alongside the conversation.
 *
 * The shopper never has to leave the chat to see what we remember: this panel
 * is always visible, always editable, and it fills itself in as the agent
 * learns — `profile` stream events arrive as `learned` and merge into what was
 * fetched, so a fact the model just wrote appears in its control mid-turn.
 *
 * It owns the I/O so the shop page doesn't have to: one fetch, four mutations,
 * and a presentational form underneath.
 */

/**
 * One fact as it travels on the `profile` stream event.
 *
 * Derived from `ExpertEvent` rather than redeclared, so a change to the wire
 * shape is a type error here instead of a silent mismatch.
 */
export type ProfileFactWire = Extract<ExpertEvent, { type: "profile" }>["facts"][number];

interface ProfilePanelProps {
  lens: ProfileLens | null;
  /** Facts accumulated from `profile` events this session. */
  learned: ProfileFactWire[];
  /** Whose profile this shows — `self` (default) or a person's subject id. */
  subjectId?: string;
  /** Embedded in the details drawer: drop the card + title chrome. */
  bare?: boolean;
}

const IDENTITY = (category: string, key: string) => `${category}.${key}`;

function isEmpty(value: FactValue | null): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "number") return Number.isNaN(value);
  return false;
}

/**
 * Lift a wire fact into a `ProfileFact`.
 *
 * `userId` is absent on the wire (the stream is already scoped to the signed-in
 * shopper) and nothing in the UI reads it, so it is filled with an empty string
 * rather than inviting a nullable field into the shared type.
 */
function toFact(wire: ProfileFactWire): ProfileFact | null {
  if (!isProfileLens(wire.lens)) return null;
  return { ...wire, lens: wire.lens, userId: "" };
}

function newer(a: ProfileFact, b: ProfileFact): ProfileFact {
  return Date.parse(b.updatedAt) >= Date.parse(a.updatedAt) ? b : a;
}

/**
 * Merge the agent's facts into the fetched list by id.
 *
 * Merge, never replace: a `profile` event carries only what changed this turn,
 * so replacing would erase the rest of the profile every time the agent learned
 * one thing. Where both sides hold the same fact, the newer `updatedAt` wins —
 * which keeps an edit the shopper just made from being undone by a stale event.
 */
function mergeFacts(fetched: ProfileFact[], learned: ProfileFactWire[]): ProfileFact[] {
  if (learned.length === 0) return fetched;
  const byId = new Map(fetched.map((f) => [f.id, f]));
  for (const wire of learned) {
    const fact = toFact(wire);
    if (!fact) continue;
    const existing = byId.get(fact.id);
    byId.set(fact.id, existing ? newer(existing, fact) : fact);
  }
  return [...byId.values()];
}

export function ProfilePanel({ lens, learned, subjectId = "self", bare = false }: ProfilePanelProps) {
  const { status } = useSession();
  const { toast } = useToast();

  const [fetched, setFetched] = useState<ProfileFact[]>([]);
  // Which subject `fetched` was loaded for. Tracking the id (not a bare boolean)
  // means a switch to another person shows the loading skeleton during the new
  // fetch instead of flashing an empty "0 of N filled" form for someone who
  // actually has saved facts.
  const [loadedSubject, setLoadedSubject] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const authed = status === "authenticated";

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    (async () => {
      try {
        // No `?lens=` — the panel shows the profile you OWN for this subject,
        // the same view the Center manages, not the consent-filtered one.
        const res = await fetch(
          `/api/personalization/facts?subjectId=${encodeURIComponent(subjectId)}`,
        );
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          facts?: ProfileFact[];
        };
        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? "We couldn't load this profile.");
        }
        if (cancelled) return;
        setFetched(json.facts ?? []);
        setError(null);
        setLoadedSubject(subjectId);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "We couldn't load this profile.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed, reloadKey, subjectId]);

  // Show only the ACTIVE subject's facts. The fetch is already subject-scoped,
  // but filtering during render means the previous person's data never flashes
  // in the gap before the new fetch resolves (and a backstop switch can stream
  // another person's facts in right after the active subject changes), without
  // resetting state inside an effect.
  const scopedFetched = useMemo(
    () => fetched.filter((f) => f.subjectId === subjectId),
    [fetched, subjectId],
  );
  const scopedLearned = useMemo(
    () => learned.filter((f) => (f.subjectId ?? "self") === subjectId),
    [learned, subjectId],
  );
  const facts = useMemo(
    () => mergeFacts(scopedFetched, scopedLearned),
    [scopedFetched, scopedLearned],
  );

  const applyFact = useCallback((next: ProfileFact) => {
    setFetched((prev) => {
      const seen = prev.some((f) => f.id === next.id);
      return seen ? prev.map((f) => (f.id === next.id ? next : f)) : [next, ...prev];
    });
  }, []);

  const handleSave = useCallback(
    async (field: ProfileField, value: FactValue | null) => {
      const identity = IDENTITY(field.category, field.key);
      const existing = facts.find(
        (f) =>
          f.lens === field.lens && f.category === field.category && f.key === field.key,
      );
      setBusyKey(identity);
      try {
        if (isEmpty(value)) {
          if (!existing) return;
          const res = await fetch(`/api/personalization/facts/${existing.id}`, {
            method: "DELETE",
          });
          if (!res.ok) throw new Error("That could not be cleared.");
          setFetched((prev) => prev.filter((f) => f.id !== existing.id));
          return;
        }

        const res = await fetch("/api/personalization/facts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjectId,
            lens: field.lens,
            category: field.category,
            key: field.key,
            value,
            source: "explicit",
            confidence: 1,
            sensitivity: field.sensitivity ?? "standard",
            consentScope: "lens_only",
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          fact?: ProfileFact;
        };
        if (!res.ok || !json.ok || !json.fact) {
          throw new Error(json.error ?? "That change could not be saved.");
        }
        applyFact(json.fact);
      } catch (err) {
        // Roll back to the last thing the server told us, and say so.
        if (existing) applyFact(existing);
        toast(
          err instanceof Error ? err.message : "That change could not be saved.",
          "error",
        );
      } finally {
        setBusyKey(null);
      }
    },
    [applyFact, facts, toast, subjectId],
  );

  const patchFact = useCallback(
    async (fact: ProfileFact, patch: FactPatch, optimistic: ProfileFact) => {
      applyFact(optimistic);
      try {
        const res = await fetch(`/api/personalization/facts/${fact.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          fact?: ProfileFact;
        };
        if (!res.ok || !json.ok || !json.fact) {
          throw new Error(json.error ?? "That change could not be saved.");
        }
        applyFact(json.fact);
      } catch (err) {
        applyFact(fact);
        toast(
          err instanceof Error ? err.message : "That change could not be saved.",
          "error",
        );
      }
    },
    [applyFact, toast],
  );

  const handleConfirm = useCallback(
    (fact: ProfileFact) => {
      void patchFact(fact, { confirm: true }, {
        ...fact,
        source: "explicit",
        confidence: 1,
        lastConfirmedAt: new Date().toISOString(),
      });
    },
    [patchFact],
  );

  const handleConsentChange = useCallback(
    (fact: ProfileFact, scope: ConsentScope) => {
      void patchFact(fact, { consentScope: scope }, { ...fact, consentScope: scope });
    },
    [patchFact],
  );

  const handleDelete = useCallback(
    (fact: ProfileFact) => {
      setFetched((prev) => prev.filter((f) => f.id !== fact.id));
      void (async () => {
        try {
          const res = await fetch(`/api/personalization/facts/${fact.id}`, {
            method: "DELETE",
          });
          if (!res.ok) throw new Error("That could not be deleted.");
        } catch (err) {
          // Put it back rather than pretending it went.
          setFetched((prev) => (prev.some((f) => f.id === fact.id) ? prev : [fact, ...prev]));
          toast(
            err instanceof Error ? err.message : "That could not be deleted.",
            "error",
          );
        }
      })();
    },
    [toast],
  );

  // Nowhere to store an anonymous shopper's profile, so nothing is offered.
  if (!authed || !lens) return null;

  return (
    <LivingProfileForm
      compact
      bare={bare}
      lens={lens}
      facts={facts}
      loading={loadedSubject !== subjectId && !error}
      error={error}
      onRetry={() => {
        setError(null);
        setReloadKey((k) => k + 1);
      }}
      busyKey={busyKey}
      onSave={handleSave}
      onConfirm={handleConfirm}
      onDelete={handleDelete}
      onConsentChange={handleConsentChange}
    />
  );
}

export default ProfilePanel;

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LivingProfileForm } from "@/components/personalization/LivingProfileForm";
import type { ProfileFact } from "@/lib/personalization/types";

/**
 * The always-visible profile form is where everything the agent learns becomes
 * visible and correctable, so these guard the promises the UI makes:
 * agent-learned values appear in their control, guesses are labelled as
 * guesses, health data is locked to its lens, and nothing learned is hidden.
 */

function fact(overrides: Partial<ProfileFact> = {}): ProfileFact {
  return {
    id: "f1",
    userId: "u1",
    subjectId: "self",
    lens: "style",
    category: "sizes",
    key: "top",
    value: "M",
    source: "explicit",
    confidence: 1,
    sensitivity: "standard",
    consentScope: "lens_only",
    quote: null,
    lastConfirmedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const noop = () => {};

function renderForm(facts: ProfileFact[], extra: Record<string, unknown> = {}) {
  return render(
    <LivingProfileForm
      lens="style"
      facts={facts}
      onSave={noop}
      onConfirm={noop}
      onDelete={noop}
      onConsentChange={noop}
      {...extra}
    />,
  );
}

describe("LivingProfileForm", () => {
  it("shows a value the agent learned in its own control", () => {
    renderForm([fact({ value: "M" })]);
    // The stored value is bound to the field, not shown as raw JSON.
    expect(screen.getByDisplayValue("M")).toBeInTheDocument();
  });

  it("renders an empty state that never blocks the shopper", () => {
    renderForm([]);
    expect(screen.getByText(/fills in as you chat/i)).toBeInTheDocument();
  });

  it("labels a guess as inferred and offers to confirm it", () => {
    renderForm([
      fact({ source: "inferred", confidence: 0.5, lastConfirmedAt: null }),
    ]);
    expect(screen.getByText(/inferred/i)).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /confirm/i }).length,
    ).toBeGreaterThan(0);
  });

  it("does not label an explicit, confirmed value as inferred", () => {
    renderForm([fact()]);
    expect(screen.queryByText(/^inferred$/i)).not.toBeInTheDocument();
  });

  it("locks health data to its lens and says why", () => {
    renderForm([
      fact({
        lens: "style",
        category: "sizes",
        key: "top",
        sensitivity: "health",
        value: "M",
      }),
    ]);
    expect(screen.getByText(/private to this lens/i)).toBeInTheDocument();
    // The cross-lens control must be disabled, not merely ignored.
    const switches = screen.getAllByRole("switch");
    expect(switches.some((s) => s.hasAttribute("disabled"))).toBe(true);
  });

  it("surfaces facts that match no schema field instead of hiding them", () => {
    renderForm([
      fact({ id: "orphan", category: "totally", key: "unknown", value: "kept" }),
    ]);
    expect(screen.getByText(/other things we/i)).toBeInTheDocument();
    expect(screen.getByText(/kept/)).toBeInTheDocument();
  });

  it("reports completion for the lens", () => {
    renderForm([fact()]);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow");
    expect(Number(bar.getAttribute("aria-valuemax"))).toBeGreaterThan(0);
  });

  it("enables 'Use what you already know' only when there are guesses to confirm", () => {
    const onConfirmAll = vi.fn();
    // Nothing inferred → the bulk-confirm affordance is present but inert, so
    // its position doesn't jump around as facts arrive.
    const { unmount } = renderForm([fact()], { onConfirmAll });
    expect(
      screen.getByRole("button", { name: /use what you already know/i }),
    ).toBeDisabled();
    unmount();

    renderForm([fact({ source: "inferred", lastConfirmedAt: null })], {
      onConfirmAll,
    });
    expect(
      screen.getByRole("button", { name: /use what you already know/i }),
    ).toBeEnabled();
  });

  it("explains why each field is asked for", () => {
    renderForm([fact()]);
    expect(screen.getAllByText(/why we ask/i).length).toBeGreaterThan(0);
  });

  it("renders loading and error states", () => {
    const { container, unmount } = renderForm([], { loading: true });
    // Loading is announced politely and shows shimmer placeholders.
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    unmount();

    const onRetry = vi.fn();
    renderForm([], { error: "Could not load your profile.", onRetry });
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(/could not load your profile/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";
import { extractFieldsFromText } from "@/lib/personalization/extract";

/**
 * Code-side form filling. The model records what it understood; this catches
 * the plainly-stated things it skipped on a busy turn. Everything here must
 * stay conservative — a wrong guess is worse than a blank field, because the
 * shopper has to notice and undo it.
 */

function byKey(ups: ReturnType<typeof extractFieldsFromText>) {
  return Object.fromEntries(ups.map((u) => [`${u.category}.${u.key}`, u.value]));
}

describe("extractFieldsFromText", () => {
  it("fills a single-select field from a plain statement", () => {
    const ups = extractFieldsFromText("skincare", "my skin is oily and breaks out");
    expect(byKey(ups)["skin.type"]).toBe("Oily");
  });

  it("collects every match for a multi-select field", () => {
    const ups = extractFieldsFromText(
      "style",
      "I wear minimal and smart casual things, mostly for work",
    );
    expect(byKey(ups)["style.preference"]).toEqual(
      expect.arrayContaining(["Minimal", "Smart casual"]),
    );
    expect(byKey(ups)["occasions.common"]).toEqual(expect.arrayContaining(["Work"]));
  });

  it("matches a multi-word option as a phrase", () => {
    const ups = extractFieldsFromText("nutrition", "we eat a lot of south indian food");
    expect(byKey(ups)["cuisines.preferred"]).toEqual(
      expect.arrayContaining(["South Indian"]),
    );
  });

  it("matches an option with a parenthetical annotation on its head", () => {
    const ups = extractFieldsFromText("skincare", "keep it minimal please");
    // "Minimal (2-3 steps)" is matched via "Minimal".
    expect(String(byKey(ups)["routine.length"])).toMatch(/^Minimal/);
  });

  it("everything it writes is inferred, lens-local and hedged", () => {
    const ups = extractFieldsFromText("skincare", "my skin is oily");
    expect(ups.length).toBeGreaterThan(0);
    for (const u of ups) {
      expect(u.source).toBe("inferred");
      expect(u.confidence).toBeLessThan(1);
      expect(u.consentScope).toBe("lens_only");
    }
  });

  it("carries the schema's own sensitivity so health stays health", () => {
    const ups = extractFieldsFromText("nutrition", "I am vegetarian");
    const diet = ups.find((u) => u.key === "pattern");
    expect(diet?.sensitivity).toBe("health");
  });

  it("never fills a field that is already known", () => {
    const filled = new Set(["skin.type"]);
    const ups = extractFieldsFromText("skincare", "my skin is oily", filled);
    expect(ups.find((u) => u.key === "type")).toBeUndefined();
  });

  it("refuses ambiguous single-select matches rather than guessing", () => {
    // Two mutually exclusive fits named in one sentence -> record neither.
    const ups = extractFieldsFromText("style", "I like slim but sometimes relaxed");
    expect(byKey(ups)["fit.preference"]).toBeUndefined();
  });

  it("does not match on substrings inside other words", () => {
    // "Formal" must not fire on "informally"; "Gym" must not fire on "gymnasium…"
    const ups = extractFieldsFromText("style", "dressed informally");
    expect(byKey(ups)["style.preference"]).toBeUndefined();
  });

  it("skips generic vocabulary that would misfire", () => {
    const ups = extractFieldsFromText("style", "that seems fine and normal to me");
    expect(ups).toHaveLength(0);
  });

  it("ignores empty or trivial input", () => {
    expect(extractFieldsFromText("gift", "")).toHaveLength(0);
    expect(extractFieldsFromText("gift", "ok")).toHaveLength(0);
  });

  it("tolerates a trailing plural", () => {
    // "I prefer serums" should still match the option "Serum".
    const ups = extractFieldsFromText("skincare", "I prefer serums over creams");
    expect(byKey(ups)["form.preference"]).toEqual(expect.arrayContaining(["Serum"]));
  });

  it("still refuses substring matches despite plural tolerance", () => {
    // "Gel" must not fire on "gelatin"; "Top" must not fire on "topic".
    const ups = extractFieldsFromText("skincare", "there is gelatin in it");
    expect(byKey(ups)["form.preference"]).toBeUndefined();
  });

  it("is case-insensitive", () => {
    const ups = extractFieldsFromText("nutrition", "I'm VEGAN by the way");
    expect(byKey(ups)["diet.pattern"]).toBe("Vegan");
  });

  describe("free-text allergies (the safety-critical backstop)", () => {
    it("captures 'allergic to X and Y' as a health, lens-local fact", () => {
      const ups = extractFieldsFromText("nutrition", "I'm allergic to peanuts and shellfish");
      const allergy = ups.find((u) => u.key === "list");
      expect(allergy?.value).toEqual(["peanuts", "shellfish"]);
      expect(allergy?.sensitivity).toBe("health");
      expect(allergy?.consentScope).toBe("lens_only");
      expect(allergy?.source).toBe("inferred");
    });

    it("captures a reaction phrase: 'fragrance makes me itch'", () => {
      const ups = extractFieldsFromText("skincare", "fragrance makes me itch");
      expect(byKey(ups)["allergies.list"]).toEqual(["fragrance"]);
    });

    it("captures 'can't eat X' and 'sensitive to X'", () => {
      expect(
        byKey(extractFieldsFromText("nutrition", "I can't eat gluten"))["allergies.list"],
      ).toEqual(["gluten"]);
      expect(
        byKey(extractFieldsFromText("skincare", "my skin is sensitive to retinol"))[
          "allergies.list"
        ],
      ).toEqual(["retinol"]);
    });

    it("strips leading articles", () => {
      const ups = extractFieldsFromText("nutrition", "allergic to all nuts");
      expect(byKey(ups)["allergies.list"]).toEqual(["nuts"]);
    });

    it("ignores non-allergen objects", () => {
      // "allergic to being late" -> "being" is filtered; nothing usable.
      expect(
        extractFieldsFromText("nutrition", "I'm allergic to being late").find(
          (u) => u.key === "list",
        ),
      ).toBeUndefined();
    });

    it("does not fire on a positive 'makes me' phrase", () => {
      expect(
        extractFieldsFromText("skincare", "this serum makes me happy").find(
          (u) => u.key === "list",
        ),
      ).toBeUndefined();
    });

    it("only runs for lenses that have an allergies field", () => {
      // Gift has no allergies field, so nothing is captured there.
      expect(
        extractFieldsFromText("gift", "she is allergic to latex").find(
          (u) => u.key === "list",
        ),
      ).toBeUndefined();
    });

    it("does not overwrite an allergies list already on file", () => {
      const filled = new Set(["allergies.list"]);
      expect(
        extractFieldsFromText("nutrition", "allergic to peanuts", filled).find(
          (u) => u.key === "list",
        ),
      ).toBeUndefined();
    });
  });
});

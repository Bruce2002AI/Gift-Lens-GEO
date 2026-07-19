import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RichText } from "@/components/expert/RichText";

describe("RichText — the chat markdown renderer", () => {
  it("renders **bold** and *italic* as real elements, not literal asterisks", () => {
    const { container } = render(<RichText text="Your **goal** is a *relaxed* look." />);
    expect(container.querySelector("strong")?.textContent).toBe("goal");
    expect(container.querySelector("em")?.textContent).toBe("relaxed");
    expect(container.textContent).not.toContain("*");
  });

  it("turns a '- ' run into a single <ul> with one <li> per line", () => {
    const { container } = render(
      <RichText text={"I'll shop for:\n- Shirts\n- Trousers\n- Shoes"} />,
    );
    const lists = container.querySelectorAll("ul");
    expect(lists).toHaveLength(1);
    expect(lists[0].querySelectorAll("li")).toHaveLength(3);
    expect(lists[0].querySelectorAll("li")[1].textContent).toBe("Trousers");
  });

  it("renders a numbered run as an <ol>", () => {
    const { container } = render(<RichText text={"1. First\n2. Second"} />);
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("keeps plain prose as a paragraph and never injects raw HTML", () => {
    const { container } = render(
      <RichText text={"Just a warm line.\n<script>alert(1)</script>"} />,
    );
    expect(container.querySelector("script")).toBeNull();
    // The tags survive only as inert text, never as elements.
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("handles bold inside a bullet item", () => {
    const { container } = render(<RichText text={"- **Budget:** under 3000"} />);
    const li = container.querySelector("li");
    expect(li?.querySelector("strong")?.textContent).toBe("Budget:");
  });

  it("nests indented sub-bullets under a numbered item", () => {
    const { container } = render(
      <RichText
        text={"1. Give one gift, such as:\n  - A photo book\n  - A memory jar\n2. Plan a date"}
      />,
    );
    const topList = container.querySelector("ol");
    expect(topList).not.toBeNull();
    const firstLi = topList!.querySelector("li");
    const nested = firstLi!.querySelector("ul");
    expect(nested).not.toBeNull();
    expect(nested!.querySelectorAll("li")).toHaveLength(2);
    expect(topList!.querySelectorAll(":scope > li")).toHaveLength(2);
  });

  it("renders a blockquote for a '>' line", () => {
    const { container } = render(
      <RichText text={"Say this:\n> I'm really sorry I forgot your birthday."} />,
    );
    const bq = container.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq!.textContent).toContain("really sorry");
  });
});

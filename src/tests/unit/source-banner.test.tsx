import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceBanner } from "@/components/catalog/SourceBanner";

describe("SourceBanner (mock/live labeling)", () => {
  it("labels live data as live", () => {
    render(<SourceBanner source="live" />);
    expect(screen.getByText(/live shopify global catalog/i)).toBeInTheDocument();
  });

  it("shows the persistent demo banner for mock data", () => {
    render(<SourceBanner source="mock" />);
    expect(
      screen.getByText(/demo catalog data — connect shopify global catalog/i),
    ).toBeInTheDocument();
  });

  it("explains mixed results", () => {
    render(<SourceBanner source="mixed" />);
    expect(screen.getByText(/partially demo data/i)).toBeInTheDocument();
  });

  it("labels heuristic AI mode", () => {
    render(<SourceBanner source="live" aiMode="heuristic" />);
    expect(screen.getByText(/heuristic mode/i)).toBeInTheDocument();
  });

  it("renders nothing without a source", () => {
    const { container } = render(<SourceBanner source={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

import { PersonalizationCenter } from "@/components/personalization/PersonalizationCenter";

/**
 * The Personalization Center route. The whole experience lives in
 * `PersonalizationCenter` so it can also open in a drawer from the nav without
 * a full navigation.
 */
export default function PersonalizationPage() {
  return <PersonalizationCenter />;
}

import type { Metadata } from "next";
import { ConnectionsExplorer } from "./components/ConnectionsExplorer";

export const metadata: Metadata = {
  title: "Rivals Connections — Team-Up Network",
  description:
    "Explore Marvel Rivals team-up connections and generate high-synergy six-hero teams.",
};

export default function Home() {
  return <ConnectionsExplorer />;
}

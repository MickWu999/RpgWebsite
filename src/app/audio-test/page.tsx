import type { Metadata } from "next";
import AudioTest from "./AudioTest";

export const metadata: Metadata = { title: "聲音測試", robots: { index: false, follow: false } };

export default function Page() {
  return <AudioTest />;
}

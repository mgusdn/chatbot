import type { Metadata } from "next";
import { KeepsakeLetterView } from "@/components/keepsake/KeepsakeLetterView";

export const metadata: Metadata = {
  title: "푸바오 기념 편지",
  description: "프바오와 나눈 마음을 담은 기념 편지",
};

export default async function KeepsakeLetterPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <KeepsakeLetterView shareToken={token} />;
}

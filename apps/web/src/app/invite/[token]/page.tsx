import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<never> {
  const { token } = await params;
  redirect(/^[0-9a-f]{64}$/.test(token) ? `/helper#${token}` : "/helper");
}

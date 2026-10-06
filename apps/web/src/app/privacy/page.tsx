import { notFound } from "next/navigation";
import { PrivacyNotice } from "@/apps/privacy";
import { LEGAL_NOTICE_CONFIG, canPublishPrivacyNotice } from "@/config/legal";

export const metadata = {
  title: "Privacy",
  robots: { index: false, follow: false },
};

export default function PrivacyRoute() {
  if (!canPublishPrivacyNotice(LEGAL_NOTICE_CONFIG)) notFound();
  return <PrivacyNotice config={LEGAL_NOTICE_CONFIG} preview={false} />;
}

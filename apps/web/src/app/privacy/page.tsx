import { PrivacyNotice } from "@/apps/privacy";
import { LEGAL_CONTACT } from "@/config/legal";

export const metadata = {
  title: "Privacy notice",
  description:
    "What this site collects from children, how we use it, how long we keep it, and the rights of parents.",
};

export default function PrivacyRoute() {
  return <PrivacyNotice contact={LEGAL_CONTACT} />;
}

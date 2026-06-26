import { ProfilePage } from "@/apps/profile";
import { SITE } from "@/config/site";

export const metadata = {
  title: `My Profile | ${SITE.name}`,
  description: "View your game progress and account settings",
};

export default function ProfileRoute() {
  return <ProfilePage />;
}

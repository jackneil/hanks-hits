import { ProfilePage } from "@/apps/profile";

export const metadata = {
  title: "My Profile",
  description: "View your game progress and account settings",
};

export default function ProfileRoute() {
  return <ProfilePage />;
}

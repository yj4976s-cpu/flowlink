import { AdminCommunityPostsClient } from "@/components/admin/community-posts/AdminCommunityPostsClient";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function AdminCommunityPostsPage() {
  return <AdminRouteGuard><div className="site-shell"><Header /><AdminCommunityPostsClient /><Footer /></div></AdminRouteGuard>;
}

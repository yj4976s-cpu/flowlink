import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CommunityDetail } from "@/components/community/CommunityDetail";
export default async function CommunityDetailPage({ params }: PageProps<"/community/[postId]">) { const { postId } = await params; return <div className="site-shell"><Header/><CommunityDetail postId={postId}/><Footer/></div>; }

import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CommunityEditor } from "@/components/community/CommunityEditor";
export default async function CommunityEditPage({ params }: PageProps<"/community/[postId]/edit">) { const { postId } = await params; return <div className="site-shell"><Header/><CommunityEditor postId={postId}/><Footer/></div>; }

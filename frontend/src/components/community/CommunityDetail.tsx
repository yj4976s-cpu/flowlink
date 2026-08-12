"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/common/Icon";
import { getCurrentUser, type AuthUser } from "@/lib/authApi";
import { createCommunityComment, deleteCommunityComment, deleteCommunityPost, getCommunityPost, listCommunityComments, resolveCommunityImageUrl, type CommunityCategory, type CommunityComment, type CommunityPost } from "@/lib/communityApi";
import styles from "./Community.module.css";

const labels: Record<CommunityCategory, string> = {
  FIELD_STORY: "목격 제보",
  QUESTION: "도움 요청",
  EXPERIENCE: "반환·이용 경험",
  OPINION: "자유 이야기",
};

const colorClasses = {
  red: styles.contentColorRed,
  orange: styles.contentColorOrange,
  accent: styles.contentColorOrange,
  yellow: styles.contentColorYellow,
  blue: styles.contentColorBlue,
  green: styles.contentColorGreen,
  mint: styles.contentColorMint,
  purple: styles.contentColorPurple,
  pink: styles.contentColorPink,
  gray: styles.contentColorGray,
  muted: styles.contentColorGray,
};

type InlineTone = keyof typeof colorClasses;

const sizeClasses = {
  small: styles.contentSizeSmall,
  normal: styles.contentSizeNormal,
  large: styles.contentSizeLarge,
  heading: styles.contentSizeHeading,
};

type InlineSize = keyof typeof sizeClasses;

function renderInlineContent(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|\[color=(#[0-9a-fA-F]{6})\]([\s\S]*?)\[\/color\]|\[(red|orange|accent|yellow|blue|green|mint|purple|pink|gray|muted)\]([\s\S]*?)\[\/\5\]|\[(small|normal|large|heading)\]([\s\S]*?)\[\/\7\])/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));

    if (match[2]) {
      nodes.push(<strong key={`${keyPrefix}-${match.index}`}>{match[2]}</strong>);
    } else if (match[3]) {
      nodes.push(<span key={`${keyPrefix}-${match.index}`} style={{ color: match[3], fontWeight: 850 }}>{match[4]}</span>);
    } else if (match[5]) {
      nodes.push(<span key={`${keyPrefix}-${match.index}`} className={colorClasses[match[5] as InlineTone]}>{match[6]}</span>);
    } else {
      nodes.push(<span key={`${keyPrefix}-${match.index}`} className={sizeClasses[match[7] as InlineSize]}>{match[8]}</span>);
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.length ? nodes : ["\u00A0"];
}

function renderFormattedContent(value: string) {
  return value.split("\n").map((line, index) => {
    if (line.startsWith("> ")) {
      return <blockquote key={index}>{renderInlineContent(line.slice(2), `quote-${index}`)}</blockquote>;
    }

    if (line.startsWith("- ")) {
      return <p key={index} className={styles.formattedList}>{renderInlineContent(line.slice(2), `list-${index}`)}</p>;
    }

    return <p key={index}>{renderInlineContent(line, `line-${index}`)}</p>;
  });
}

export function CommunityDetail({ postId }: { postId: string }) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [commentError, setCommentError] = useState("");
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [content, setContent] = useState("");
  const [replyTargetId, setReplyTargetId] = useState<number | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [pending, setPending] = useState(false);
  const [replyPendingId, setReplyPendingId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void Promise.allSettled([getCommunityPost(postId, controller.signal), listCommunityComments(postId, controller.signal)])
      .then(([postResult, commentResult]) => {
        if (postResult.status === "fulfilled") setPost(postResult.value);
        else setPageError("게시글을 불러오지 못했어요.");

        if (commentResult.status === "fulfilled") setComments(commentResult.value);
        else setCommentError("댓글을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [postId]);

  useEffect(() => { void getCurrentUser().then(setUser).catch(() => setUser(null)); }, []);

  useEffect(() => {
    if (!confirm) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirm(false);
        deleteTrigger.current?.focus();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [confirm]);

  const repliesByParent = useMemo(() => {
    const result = new Map<number, CommunityComment[]>();
    comments.forEach((comment) => {
      if (!comment.parent_comment_id) return;
      result.set(comment.parent_comment_id, [...(result.get(comment.parent_comment_id) || []), comment]);
    });
    return result;
  }, [comments]);

  const rootComments = comments.filter((comment) => !comment.parent_comment_id);

  const addComment = async (text: string, parentCommentId?: number) => {
    if (!user) {
      router.push(`/login?next=/community/${postId}`);
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;

    setCommentError("");
    const isReply = parentCommentId != null;
    if (isReply) setReplyPendingId(parentCommentId);
    else setPending(true);

    try {
      const item = await createCommunityComment(postId, trimmed, parentCommentId);
      setComments((current) => [...current, item]);
      if (isReply) {
        setReplyContent("");
        setReplyTargetId(null);
      } else {
        setContent("");
      }
      setPost((current) => current ? { ...current, comment_count: current.comment_count + 1 } : current);
    } catch (cause) {
      setCommentError(cause instanceof Error ? cause.message : "댓글을 등록하지 못했어요.");
    } finally {
      if (isReply) setReplyPendingId(null);
      else setPending(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void addComment(content);
  };

  const submitReply = (event: FormEvent, parentCommentId: number) => {
    event.preventDefault();
    void addComment(replyContent, parentCommentId);
  };

  const removeComment = async (commentId: number) => {
    setCommentError("");
    try {
      const removingIds = new Set([commentId, ...comments.filter((item) => item.parent_comment_id === commentId).map((item) => item.id)]);
      await deleteCommunityComment(commentId);
      setComments((current) => current.filter((item) => !removingIds.has(item.id)));
      setPost((current) => current ? { ...current, comment_count: Math.max(0, current.comment_count - removingIds.size) } : current);
    } catch {
      setCommentError("댓글을 삭제하지 못했어요.");
    }
  };

  const removePost = async () => {
    if (!post) return;
    try {
      await deleteCommunityPost(post.id);
      router.replace("/community");
    } catch {
      setPageError("게시글을 삭제하지 못했어요.");
      setConfirm(false);
    }
  };

  if (loading) return <main className={styles.detailPage}><div className={styles.detailLoading}>이야기를 불러오고 있어요.</div></main>;
  if (!post) return <main className={styles.detailPage}><div className={styles.state}><h1>{pageError || "게시글을 찾을 수 없어요."}</h1><Link href="/community">커뮤니티로 돌아가기</Link></div></main>;

  const canEdit = user?.id === post.user_id;
  const canDelete = canEdit || user?.role === "ADMIN";

  return (
    <main className={styles.detailPage}>
      <Link className={styles.backLink} href="/community"><Icon name="arrow" size={15} />커뮤니티</Link>
      <article className={styles.detailArticle}>
        <header>
          <div><span>{post.is_notice ? "FLOWLINK NOTICE" : "USER STORY"}</span><em>{labels[post.category]}</em>{post.place_name && <small><Icon name="location" size={13} />{post.place_name}</small>}</div>
          {canDelete && <div className={styles.postMenu} ref={menuRef}><button ref={deleteTrigger} type="button" aria-label="게시글 메뉴" aria-expanded={menu} onClick={() => setMenu((value) => !value)}>•••</button>{menu && <div>{canEdit && <Link href={`/community/${post.id}/edit`}>수정</Link>}<button type="button" onClick={() => { setMenu(false); setConfirm(true); }}>삭제</button></div>}</div>}
        </header>
        <h1>{post.title}</h1>
        <p className={styles.meta}>{post.nickname} · {new Date(post.created_at).toLocaleString("ko-KR")}</p>
        <div className={styles.body}>{renderFormattedContent(post.content)}</div>
        {post.image_url && <img className={styles.detailImage} src={resolveCommunityImageUrl(post.image_url) || ""} alt="게시글 첨부 이미지" />}
      </article>
      <section className={styles.comments}>
        <header><h2>댓글 <span>{comments.length}</span></h2><p>질문과 추가 제보를 댓글로 이어가 보세요.</p></header>
        <form className={styles.commentForm} onSubmit={submit}>
          <input value={content} maxLength={1000} onChange={(event) => { setContent(event.target.value); setCommentError(""); }} placeholder={user ? "댓글을 입력해 주세요..." : "로그인 후 댓글을 작성할 수 있어요."} aria-label="댓글 내용" />
          <button type="submit" disabled={pending || !content.trim()}>{pending ? "등록 중" : "등록"}</button>
        </form>
        {commentError && <p className={styles.commentError} role="alert">{commentError}</p>}
        <div className={styles.commentList}>
          {rootComments.length ? rootComments.map((comment) => {
            const replies = repliesByParent.get(comment.id) || [];
            const canRemove = user?.id === comment.user_id || user?.role === "ADMIN";
            return (
              <article className={styles.commentItem} key={comment.id}>
                <div><strong>{comment.nickname}</strong><span>{new Date(comment.created_at).toLocaleString("ko-KR")}</span></div>
                <p>{comment.content}</p>
                <footer>
                  <button type="button" onClick={() => { setReplyTargetId(replyTargetId === comment.id ? null : comment.id); setReplyContent(""); setCommentError(""); }}>답글</button>
                  {canRemove && <button type="button" onClick={() => void removeComment(comment.id)}>삭제</button>}
                </footer>
                {replyTargetId === comment.id && (
                  <form className={styles.replyForm} onSubmit={(event) => submitReply(event, comment.id)}>
                    <input value={replyContent} maxLength={1000} onChange={(event) => { setReplyContent(event.target.value); setCommentError(""); }} placeholder={`${comment.nickname}님에게 답글 남기기`} aria-label="답글 내용" />
                    <button type="submit" disabled={replyPendingId === comment.id || !replyContent.trim()}>{replyPendingId === comment.id ? "등록 중" : "답글 등록"}</button>
                  </form>
                )}
                {replies.length > 0 && <div className={styles.replyList}>{replies.map((reply) => <article key={reply.id}><div><strong>{reply.nickname}</strong><span>{new Date(reply.created_at).toLocaleString("ko-KR")}</span></div><p>{reply.content}</p>{(user?.id === reply.user_id || user?.role === "ADMIN") && <button type="button" onClick={() => void removeComment(reply.id)}>삭제</button>}</article>)}</div>}
              </article>
            );
          }) : <p className={styles.noComments}>아직 댓글이 없어요. 첫 댓글을 남겨보세요.</p>}
        </div>
      </section>
      {confirm && <div className={styles.deleteBackdrop} onMouseDown={(event) => event.target === event.currentTarget && setConfirm(false)}><section role="alertdialog" aria-modal="true" aria-labelledby="delete-post-title"><h2 id="delete-post-title">게시글을 삭제할까요?</h2><p>삭제한 글은 다시 확인하기 어려울 수 있어요.</p><div><button className="button button-secondary" type="button" onClick={() => setConfirm(false)}>취소</button><button className="button button-primary" type="button" onClick={() => void removePost()}>삭제</button></div></section></div>}
    </main>
  );
}

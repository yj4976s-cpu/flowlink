"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/common/Icon";
import { getCurrentUser, type AuthUser } from "@/lib/authApi";
import { createCommunityPost, getCommunityPost, resolveCommunityImageUrl, updateCommunityPost, type CommunityCategory } from "@/lib/communityApi";
import { CommunityPlaceSearch, type CommunityPlace } from "./CommunityPlaceSearch";
import styles from "./Community.module.css";

const regionOptions: CommunityPlace[] = [
  { placeName: "서울", address: "서울특별시", latitude: 37.5665, longitude: 126.978 },
  { placeName: "경기", address: "경기도", latitude: 37.4138, longitude: 127.5183 },
  { placeName: "인천", address: "인천광역시", latitude: 37.4563, longitude: 126.7052 },
  { placeName: "부산", address: "부산광역시", latitude: 35.1796, longitude: 129.0756 },
  { placeName: "대구", address: "대구광역시", latitude: 35.8714, longitude: 128.6014 },
  { placeName: "대전", address: "대전광역시", latitude: 36.3504, longitude: 127.3845 },
  { placeName: "광주", address: "광주광역시", latitude: 35.1595, longitude: 126.8526 },
  { placeName: "울산", address: "울산광역시", latitude: 35.5384, longitude: 129.3114 },
  { placeName: "세종", address: "세종특별자치시", latitude: 36.4801, longitude: 127.289 },
  { placeName: "강원", address: "강원특별자치도", latitude: 37.8228, longitude: 128.1555 },
  { placeName: "충북", address: "충청북도", latitude: 36.6357, longitude: 127.4917 },
  { placeName: "충남", address: "충청남도", latitude: 36.6588, longitude: 126.6728 },
  { placeName: "전북", address: "전북특별자치도", latitude: 35.8203, longitude: 127.1088 },
  { placeName: "전남", address: "전라남도", latitude: 34.8161, longitude: 126.4629 },
  { placeName: "경북", address: "경상북도", latitude: 36.4919, longitude: 128.8889 },
  { placeName: "경남", address: "경상남도", latitude: 35.4606, longitude: 128.2132 },
  { placeName: "제주", address: "제주특별자치도", latitude: 33.4996, longitude: 126.5312 },
];

const writingPrompts = [
  "언제쯤 봤나요?",
  "정확히 어느 근처였나요?",
  "물건 색상이나 특징은요?",
  "주변에 기억나는 단서가 있나요?",
];

type ContentFormat = "bold" | "small" | "normal" | "large" | "heading" | "red" | "orange" | "yellow" | "green" | "mint" | "blue" | "purple" | "pink" | "gray" | "customColor" | "quote" | "list";

const colorFormats = ["red", "orange", "yellow", "green", "mint", "blue", "purple", "pink", "gray"] as const;
const sizeFormats = ["small", "normal", "large", "heading"] as const;
type ColorFormat = (typeof colorFormats)[number];
type SizeFormat = (typeof sizeFormats)[number];

const editorColorClasses: Record<ColorFormat, string> = {
  red: styles.contentColorRed,
  orange: styles.contentColorOrange,
  yellow: styles.contentColorYellow,
  green: styles.contentColorGreen,
  mint: styles.contentColorMint,
  blue: styles.contentColorBlue,
  purple: styles.contentColorPurple,
  pink: styles.contentColorPink,
  gray: styles.contentColorGray,
};

const editorSizeClasses: Record<SizeFormat, string> = {
  small: styles.contentSizeSmall,
  normal: styles.contentSizeNormal,
  large: styles.contentSizeLarge,
  heading: styles.contentSizeHeading,
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function renderEditorInlineMarkup(value: string) {
  let html = escapeHtml(value);
  html = html.replace(/\*\*([^*]+)\*\*/g, `<strong>$1</strong>`);
  html = html.replace(/\[color=(#[0-9a-fA-F]{6})\]([\s\S]*?)\[\/color\]/g, `<span data-color="$1" style="color:$1;font-weight:850">$2</span>`);
  html = html.replace(/\[accent\]([\s\S]*?)\[\/accent\]/g, `<span data-color="orange" class="${editorColorClasses.orange}">$1</span>`);
  html = html.replace(/\[muted\]([\s\S]*?)\[\/muted\]/g, `<span data-color="gray" class="${editorColorClasses.gray}">$1</span>`);
  for (const color of colorFormats) {
    html = html.replace(new RegExp(`\\[${color}\\]([\\s\\S]*?)\\[\\/${color}\\]`, "g"), `<span data-color="${color}" class="${editorColorClasses[color]}">$1</span>`);
  }
  for (const size of sizeFormats) {
    html = html.replace(new RegExp(`\\[${size}\\]([\\s\\S]*?)\\[\\/${size}\\]`, "g"), `<span data-size="${size}" class="${editorSizeClasses[size]}">$1</span>`);
  }
  return html;
}

function markupToEditorHtml(value: string) {
  if (!value) return "";
  return value.split("\n").map((line) => {
    if (line.startsWith("> ")) return `<blockquote>${renderEditorInlineMarkup(line.slice(2))}</blockquote>`;
    if (line.startsWith("- ")) return `<div class="${styles.formattedList}">${renderEditorInlineMarkup(line.slice(2))}</div>`;
    return `<div>${renderEditorInlineMarkup(line) || "<br>"}</div>`;
  }).join("");
}

function editorHtmlToMarkup(root: HTMLElement) {
  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (!(node instanceof HTMLElement)) return "";
    if (node.tagName === "BR") return "\n";
    const childText = Array.from(node.childNodes).map(serialize).join("");
    if (node.tagName === "STRONG" || node.tagName === "B") return `**${childText}**`;
    if (node.tagName === "BLOCKQUOTE") return childText.split("\n").filter(Boolean).map((line) => `> ${line}`).join("\n");
    if (node.tagName === "LI") return `- ${childText}`;
    const color = node.dataset.color;
    if (color) {
      if (/^#[0-9a-fA-F]{6}$/.test(color)) return `[color=${color}]${childText}[/color]`;
      if ((colorFormats as readonly string[]).includes(color)) return `[${color}]${childText}[/${color}]`;
    }
    const size = node.dataset.size;
    if (size && (sizeFormats as readonly string[]).includes(size)) return `[${size}]${childText}[/${size}]`;
    return childText;
  };

  return Array.from(root.childNodes).map((node) => {
    const value = serialize(node);
    if (node instanceof HTMLElement && (node.tagName === "DIV" || node.tagName === "P")) return value;
    return value;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function CommunityEditor({ postId }: { postId?: string }) {
  const router = useRouter();
  const imageInput = useRef<HTMLInputElement>(null);
  const contentInput = useRef<HTMLDivElement>(null);
  const colorInput = useRef<HTMLInputElement>(null);
  const editorSelection = useRef<Range | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [category, setCategory] = useState<CommunityCategory>("FIELD_STORY");
  const [placeText, setPlaceText] = useState("");
  const [place, setPlace] = useState<CommunityPlace | null>(null);
  const [regionOpen, setRegionOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [editorHtml, setEditorHtml] = useState("");
  const [notice, setNotice] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [existingImage, setExistingImage] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    void getCurrentUser().then((current) => active && setUser(current)).catch(() => active && setUser(null)).finally(() => active && setAuthReady(true));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!postId) return;
    const controller = new AbortController();
    void getCommunityPost(postId, controller.signal).then((post) => {
      setCategory(post.category);
      setPlaceText(post.place_name || "");
      setPlace(post.latitude != null && post.longitude != null ? { placeName: post.place_name || post.address || "선택 위치", address: post.address || post.place_name || "", latitude: post.latitude, longitude: post.longitude } : null);
      setTitle(post.title);
      setContent(post.content);
      setEditorHtml(markupToEditorHtml(post.content));
      setNotice(post.is_notice);
      setExistingImage(post.image_url);
    }).catch(() => setError("게시글을 불러오지 못했어요."));
    return () => controller.abort();
  }, [postId]);

  useEffect(() => {
    if (!regionOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest(`.${styles.regionPicker}`)) setRegionOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [regionOpen]);

  const selectRegion = (item: CommunityPlace) => {
    setPlace(item);
    setPlaceText(item.placeName);
    setRegionOpen(false);
  };

  const addPrompt = (prompt: string) => {
    setContent((current) => {
      const next = current ? `${current}\n${prompt} ` : `${prompt} `;
      setEditorHtml(markupToEditorHtml(next));
      return next;
    });
  };

  const syncContentFromEditor = () => {
    if (!contentInput.current) return;
    setContent(editorHtmlToMarkup(contentInput.current));
  };

  const saveEditorSelection = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.anchorNode || !contentInput.current?.contains(selection.anchorNode)) return;
    editorSelection.current = selection.getRangeAt(0).cloneRange();
  };

  const restoreEditorSelection = () => {
    const range = editorSelection.current;
    if (!range) return false;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  };

  const wrapCurrentSelection = (options: { color?: ColorFormat | string; size?: SizeFormat }) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!contentInput.current?.contains(range.commonAncestorContainer)) return;

    const span = document.createElement("span");
    if (options.color) {
      span.dataset.color = options.color;
      if ((colorFormats as readonly string[]).includes(options.color)) {
        span.className = editorColorClasses[options.color as ColorFormat];
      } else {
        span.style.color = options.color;
        span.style.fontWeight = "850";
      }
    }
    if (options.size) {
      span.dataset.size = options.size;
      span.classList.add(editorSizeClasses[options.size]);
    }

    if (range.collapsed) span.textContent = "강조할 내용";
    else span.append(range.extractContents());

    range.deleteContents();
    range.insertNode(span);
    range.selectNodeContents(span);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const applyContentFormat = (format: ContentFormat) => {
    contentInput.current?.focus();
    restoreEditorSelection();
    const selection = window.getSelection();
    const hasSelection = Boolean(selection?.rangeCount && selection.toString());

    if (!hasSelection && contentInput.current) {
      const fallback = format === "quote" ? "참고할 내용" : format === "list" ? "정리할 내용" : "강조할 내용";
      const span = document.createElement(format === "quote" ? "blockquote" : "span");
      span.textContent = fallback;
      contentInput.current.append(span);
      const range = document.createRange();
      range.selectNodeContents(span);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    if (format === "bold") document.execCommand("bold");
    else if (format === "quote") document.execCommand("formatBlock", false, "blockquote");
    else if (format === "list") document.execCommand("insertUnorderedList");
    else if (format === "customColor") colorInput.current?.click();
    else if ((colorFormats as readonly string[]).includes(format)) wrapCurrentSelection({ color: format as ColorFormat });
    else if ((sizeFormats as readonly string[]).includes(format)) wrapCurrentSelection({ size: format as SizeFormat });
    normalizeEditorMarkup();
    syncContentFromEditor();
    saveEditorSelection();
  };

  const applyCustomColor = (value: string) => {
    contentInput.current?.focus();
    restoreEditorSelection();
    wrapCurrentSelection({ color: value });
    normalizeEditorMarkup();
    syncContentFromEditor();
    saveEditorSelection();
  };

  const normalizeEditorMarkup = () => {
    if (!contentInput.current) return;
    contentInput.current.querySelectorAll("font[color]").forEach((node) => {
      const element = node as HTMLElement;
      const color = element.getAttribute("color") || "";
      const span = document.createElement("span");
      span.style.color = color;
      span.dataset.color = color;
      span.innerHTML = element.innerHTML;
      element.replaceWith(span);
    });
    contentInput.current.querySelectorAll("font[size]").forEach((node) => {
      const element = node as HTMLElement;
      const size = element.getAttribute("size") || "3";
      const span = document.createElement("span");
      const mappedSize: SizeFormat = size === "2" ? "small" : size === "5" ? "large" : size === "6" ? "heading" : "normal";
      span.dataset.size = mappedSize;
      span.className = editorSizeClasses[mappedSize];
      span.innerHTML = element.innerHTML;
      element.replaceWith(span);
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const latestContent = contentInput.current ? editorHtmlToMarkup(contentInput.current) : content;
    setContent(latestContent);
    if (!title.trim() || !latestContent.trim()) { setError("제목과 내용을 입력해 주세요."); return; }
    if (!user) { router.push(`/login?next=${encodeURIComponent(postId ? `/community/${postId}/edit` : "/community/new")}`); return; }
    if (image && image.size > 5 * 1024 * 1024) { setError("사진은 5MB 이하만 첨부할 수 있어요."); return; }
    setPending(true);
    setError("");
    try {
      const payload = { category, title: title.trim(), content: latestContent.trim(), place_name: place?.placeName, address: place?.roadAddress || place?.address, latitude: place?.latitude, longitude: place?.longitude, is_notice: user.role === "ADMIN" && notice, image: image || undefined, remove_image: removeImage };
      const result = postId ? await updateCommunityPost(postId, payload) : await createCommunityPost(payload);
      router.replace(`/community/${result.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "게시글을 저장하지 못했어요.");
    } finally {
      setPending(false);
    }
  };

  if (!authReady) return <main className={styles.editorPage}><div className={styles.editorLoading}>작성 화면을 준비하고 있어요.</div></main>;
  if (!user) return <main className={styles.editorPage}><div className={styles.authState}><Icon name="user" size={28} /><h1>로그인 후 이야기를 작성할 수 있어요.</h1><Link className="button button-primary" href={`/login?next=${encodeURIComponent(postId ? `/community/${postId}/edit` : "/community/new")}`}>로그인하기</Link><Link href="/community">커뮤니티로 돌아가기</Link></div></main>;

  return (
    <main className={styles.editorPage}>
      <header className={styles.editorHero}>
        <p>COMMUNITY POST</p>
        <h1>{postId ? "이야기를 다듬어주세요" : "이야기를 나눠주세요"}</h1>
        <span>작은 목격담도 누군가에게는 결정적인 단서가 될 수 있어요. 장소와 상황을 차분히 남겨주세요.</span>
      </header>
      <div className={styles.lostGuide}><div><strong>물건을 찾고 계신가요?</strong><span>분실 신고를 등록하면 발견물과 자동으로 비교할 수 있어요.</span></div><Link href="/lost-reports/new">분실 신고하기 <Icon name="arrow" size={14} /></Link></div>
      <form onSubmit={submit} className={styles.editorForm}>
        <section><div className={styles.step}><span>01</span><div><h2>어떤 이야기인가요?</h2><p>분실 신고 대신 지역에서 나누고 싶은 이야기 유형을 골라주세요.</p></div></div><div className={styles.editorCategories}>{[["FIELD_STORY", "목격 제보", "지역에서 직접 본 변화"], ["QUESTION", "도움 요청", "지역이나 FlowLink에 관한 질문"], ["EXPERIENCE", "반환·이용 경험", "발견과 반환 과정의 경험"], ["OPINION", "자유 이야기", "위치 없이 나누는 생각과 의견"]].map(([value, label, description]) => <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value as CommunityCategory)}><Icon name={value === "FIELD_STORY" ? "location" : value === "QUESTION" ? "info" : "spark"} size={19} /><span><strong>{label}</strong><small>{description}</small></span></button>)}</div>{user.role === "ADMIN" && <label className={styles.noticeToggle}><input type="checkbox" checked={notice} onChange={(event) => setNotice(event.target.checked)} /><span>FLOWLINK NOTICE로 게시</span></label>}</section>
        <section><div className={styles.step}><span>02</span><div><h2>어디에 관한 이야기인가요? <i>선택</i></h2><p>장소를 선택하면 지역 피드와 지도에서 함께 확인할 수 있어요.</p></div></div><div className={styles.editorPlaceTools}><CommunityPlaceSearch value={placeText} optional onChange={setPlaceText} onSelect={setPlace} /><div className={styles.regionPicker}><button type="button" aria-expanded={regionOpen} onClick={() => setRegionOpen((value) => !value)}><Icon name="location" size={16} /><span>{place?.placeName || "주요 지역 선택"}</span><Icon name="chevron" size={15} /></button>{regionOpen && <div className={styles.regionMenu}><strong>주요 지역</strong><div>{regionOptions.map((item) => <button type="button" key={item.placeName} onClick={() => selectRegion(item)}>{item.placeName}</button>)}</div></div>}</div></div></section>
        <section><div className={styles.step}><span>03</span><div><h2>어떤 이야기를 나누고 싶나요?</h2><p>기억나는 단서를 하나씩 눌러 넣거나, 자유롭게 이어서 작성해 주세요.</p></div></div><div className={styles.storyComposer}><div className={styles.storyInputs}><label className={styles.editorField}><span>제목</span><input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="예: 잠실 선착장 근처에서 우산을 봤어요" required /></label><div className={styles.promptChips} aria-label="작성 도움 문구">{writingPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => addPrompt(prompt)}><Icon name="plus" size={14} />{prompt}</button>)}</div><div className={styles.formatToolbar} aria-label="내용 서식 도구"><div className={styles.formatGroup}><span>글자</span><button type="button" className={styles.formatButtonStrong} onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("bold")}>B</button></div><div className={styles.formatGroup}><span>크기</span><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("small")}>작게</button><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("normal")}>보통</button><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("large")}>크게</button><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("heading")}>제목</button></div><div className={styles.formatGroup}><span>색상</span><button type="button" className={styles.colorSwatch} data-tone="red" aria-label="빨간색 적용" onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("red")} /><button type="button" className={styles.colorSwatch} data-tone="orange" aria-label="주황색 적용" onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("orange")} /><button type="button" className={styles.colorSwatch} data-tone="yellow" aria-label="노란색 적용" onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("yellow")} /><button type="button" className={styles.colorSwatch} data-tone="green" aria-label="초록색 적용" onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("green")} /><button type="button" className={styles.colorSwatch} data-tone="mint" aria-label="민트색 적용" onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("mint")} /><button type="button" className={styles.colorSwatch} data-tone="blue" aria-label="파란색 적용" onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("blue")} /><button type="button" className={styles.colorSwatch} data-tone="purple" aria-label="보라색 적용" onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("purple")} /><button type="button" className={styles.colorSwatch} data-tone="pink" aria-label="분홍색 적용" onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("pink")} /><button type="button" className={styles.colorSwatch} data-tone="gray" aria-label="회색 적용" onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("gray")} /><button type="button" className={styles.customColorButton} onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("customColor")}>직접</button><input ref={colorInput} className={styles.hiddenColorInput} type="color" aria-label="직접 색상 선택" onChange={(event) => applyCustomColor(event.target.value)} /></div><div className={styles.formatGroup}><span>문단</span><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("quote")}>인용</button><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyContentFormat("list")}>목록</button></div></div><div className={styles.editorField}><span>내용</span><div ref={contentInput} className={styles.richEditor} contentEditable role="textbox" aria-multiline="true" aria-label="게시글 내용" data-placeholder={"예시)\n오늘 오후 4시쯤 잠실 선착장 근처에서 주황색 우산을 봤어요.\n손잡이에 검은색 끈이 있었고, 난간 쪽 물가 가까이에 떠 있었습니다."} suppressContentEditableWarning onInput={syncContentFromEditor} onKeyUp={saveEditorSelection} onMouseUp={saveEditorSelection} onFocus={saveEditorSelection} dangerouslySetInnerHTML={{ __html: editorHtml }} /><small>{content.length} / 10,000</small></div></div><aside className={styles.storyHelper} aria-label="작성 체크포인트"><span>WRITING GUIDE</span><strong>이렇게 적으면 더 잘 이어져요</strong><ul><li data-done={Boolean(place)}>장소나 대략적인 구역</li><li data-done={content.length >= 20}>시간·상황·물건 특징</li><li data-done={Boolean(image || existingImage)}>사진이 있다면 첨부</li></ul><p>정확한 보관 장소나 개인정보는 쓰지 않아도 괜찮아요.</p></aside></div></section>
        <section><div className={styles.step}><span>04</span><div><h2>사진을 함께 보여줄까요? <i>선택</i></h2><p>JPEG, PNG, WebP · 최대 5MB · 1장</p></div></div><input ref={imageInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0] || null; setImage(file); setRemoveImage(false); }} />{(image || (existingImage && !removeImage)) ? <div className={styles.imagePreview}><img src={image ? URL.createObjectURL(image) : resolveCommunityImageUrl(existingImage) || undefined} alt="첨부 이미지 미리보기" /><button type="button" aria-label="첨부 이미지 삭제" onClick={() => { setImage(null); setRemoveImage(true); if (imageInput.current) imageInput.current.value = ""; }}><Icon name="close" size={17} /></button></div> : <button className={styles.imageAdd} type="button" onClick={() => imageInput.current?.click()}><Icon name="camera" size={20} />사진 추가</button>}</section>
        {error && <p className={styles.formError} role="alert">{error}</p>}
        <footer><Link className="button button-secondary" href={postId ? `/community/${postId}` : "/community"}>취소</Link><button className="button button-primary" type="submit" disabled={pending}>{pending ? "저장하는 중..." : postId ? "수정하기" : "게시하기"}</button></footer>
      </form>
    </main>
  );
}

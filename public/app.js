// Firestore-backed anonymous flow.
//
// Every message gets a permanent sequential number ("seq"), assigned via a
// counter transaction when it's posted. This makes numbering trivial (no
// need to compute totals) and lets us jump directly to any message on any
// page with a single query — no walking through page cursors.
//
// Page 1 is live (real-time via onSnapshot). Older pages are fetched once
// on demand. Search scans the whole collection (capped) and filters
// client-side, since Firestore has no built-in full-text search.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getFirestore,
    collection,
    doc,
    addDoc,
    runTransaction,
    query,
    orderBy,
    limit,
    startAt,
    startAfter,
    getDocs,
    onSnapshot,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig, COLLECTION_NAME } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const feedEl = document.getElementById("feed");
const containerEl = document.getElementById("container");
const formEl = document.getElementById("message-form");
const inputEl = document.getElementById("message-input");
const countEl = document.getElementById("post-count");
const submitBtn = formEl.querySelector("button[type='submit']");
const firstBtn = document.getElementById("pager-first");
const prevBtn = document.getElementById("pager-prev");
const nextBtn = document.getElementById("pager-next");
const lastBtn = document.getElementById("pager-last");
const pagerGotoEl = document.getElementById("pager-goto");
const pagerTotalEl = document.getElementById("pager-total");
const pagerLiveTagEl = document.getElementById("pager-live-tag");
const pagerEl = document.getElementById("pager");
const themeToggle = document.getElementById("theme-toggle");
const layoutToggle = document.getElementById("layout-toggle");
const searchEl = document.getElementById("search-input");
const searchToggleBtn = document.getElementById("search-toggle");
const searchWrapEl = document.getElementById("search-wrap");
const previewEl = document.getElementById("preview-tooltip");
const faviconEl = document.getElementById("favicon");

const MAX_MESSAGE_LENGTH = 500;
const PAGE_SIZE = 30; // how many posts per page
const SEARCH_SCAN_CAP = 2000; // max messages scanned per search, to bound cost

let currentPage = 1;
let hasNextPage = false;
let liveUnsubscribe = null;
let lastRenderedPosts = []; // cache of the current page's posts (newest first)
let lastRenderedLive = true;
let totalCount = 0; // = seq of the newest message
let searchQuery = "";
let searchToken = 0; // used to ignore stale/out-of-order search results
let searchDebounceTimer = null;

// ---------- theme + layout preferences ----------

let theme = localStorage.getItem("nnf-theme") || "dark";
let layout = localStorage.getItem("nnf-layout") || "classic";

function applyTheme() {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggle.textContent = theme === "dark" ? "Dark" : "Light";
}

function applyLayout() {
    containerEl.classList.toggle("layout-chat", layout === "chat");
    layoutToggle.textContent = layout === "chat" ? "Chat" : "Classic";
}

themeToggle.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    localStorage.setItem("nnf-theme", theme);
    applyTheme();
});

layoutToggle.addEventListener("click", () => {
    layout = layout === "chat" ? "classic" : "chat";
    localStorage.setItem("nnf-layout", layout);
    applyLayout();
    render(lastRenderedPosts, { live: lastRenderedLive });
});

applyTheme();
applyLayout();

// ---------- rendering helpers ----------

function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Lines starting with a single "> " get greentext. ">>123" is a reply
// reference (quotelink) instead, rendered as a clickable jump-to-post link.
function renderBody(text) {
    return text
        .split("\n")
        .map((line) => {
            let safe = escapeHtml(line);
            const isQuoteLine = /^>>\d+/.test(line.trim());

            safe = safe.replace(
                /&gt;&gt;(\d+)/g,
                (match, num) => `<a href="#post-${num}" class="quotelink" data-target="${num}">&gt;&gt;${num}</a>`
            );

            if (isQuoteLine) return safe;
            return line.trim().startsWith(">")
                ? `<span class="greentext">${safe}</span>`
                : safe;
        })
        .join("\n");
}

function formatTime(date) {
    if (!date) return "sending...";
    return date.toLocaleString("en-US", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function docToPost(docSnap) {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        text: data.text ?? "",
        seq: data.seq ?? null,
        createdAt: data.createdAt ? data.createdAt.toDate() : null,
    };
}

function postArticleHtml(post) {
    const no = post.seq ?? "?";
    return `
        <article class="post" id="post-${no}">
            <div class="post-meta">
                <span>Anonymous</span>
                <span class="post-id">#${no}</span>
                <span>${formatTime(post.createdAt)}</span>
                <button type="button" class="reply-btn" data-no="${no}">Reply</button>
            </div>
            <div class="post-body">${renderBody(post.text)}</div>
        </article>`;
}

function scrollAndHighlight(target) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.remove("highlight");
    void target.offsetWidth; // restart the animation
    target.classList.add("highlight");
}

// ---------- normal (paginated / live) view ----------

// posts is always newest-first as fetched from Firestore.
function render(posts, { live }) {
    lastRenderedPosts = posts;
    lastRenderedLive = live;

    if (posts.length === 0 && currentPage === 1) {
        feedEl.innerHTML = `<p class="empty-state">No one has posted yet. Be the first.</p>`;
    } else {
        const ordered = layout === "chat" ? [...posts].reverse() : posts;
        feedEl.innerHTML = ordered.map(postArticleHtml).join("");
    }

    const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);

    countEl.textContent = live ? `page ${currentPage} · live` : `page ${currentPage}`;
    pagerGotoEl.value = currentPage;
    pagerGotoEl.max = totalPages;
    pagerTotalEl.textContent = totalPages;
    pagerLiveTagEl.style.display = live ? "" : "none";

    firstBtn.disabled = currentPage === 1;
    prevBtn.disabled = currentPage === 1;
    nextBtn.disabled = !hasNextPage;
    lastBtn.disabled = currentPage === totalPages;
    pagerEl.style.display = "";

    if (layout === "chat" && currentPage === 1) {
        requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
    }
}

function detachLive() {
    if (liveUnsubscribe) {
        liveUnsubscribe();
        liveUnsubscribe = null;
    }
}

// Page 1 stays subscribed in real time.
function goLive() {
    detachLive();
    currentPage = 1;

    const q = query(
        collection(db, COLLECTION_NAME),
        orderBy("seq", "desc"),
        limit(PAGE_SIZE + 1)
    );

    liveUnsubscribe = onSnapshot(
        q,
        (snapshot) => {
            const docs = snapshot.docs;
            hasNextPage = docs.length > PAGE_SIZE;
            const pageDocs = docs.slice(0, PAGE_SIZE);

            if (pageDocs.length > 0) {
                const newTop = pageDocs[0].data().seq ?? totalCount;
                if (previousTopSeq !== null && newTop > previousTopSeq && document.hidden) {
                    unseenCount += newTop - previousTopSeq;
                    updateTabNotice();
                }
                previousTopSeq = newTop;
                totalCount = newTop;
            }

            render(pageDocs.map(docToPost), { live: true });
        },
        (error) => {
            console.error("Firestore listen error:", error);
            feedEl.innerHTML = `<p class="empty-state">Couldn't load the feed. Check your Firebase config and Firestore rules.</p>`;
        }
    );
}

// Any older page can be fetched directly — no cursor chain needed, since we
// know exactly which seq range each page covers.
async function goToPage(n) {
    if (n < 1) return;
    detachLive();

    try {
        const topSeq = Math.max(totalCount - (n - 1) * PAGE_SIZE, 1);
        const snapshot = await getDocs(
            query(
                collection(db, COLLECTION_NAME),
                orderBy("seq", "desc"),
                startAt(topSeq),
                limit(PAGE_SIZE + 1)
            )
        );
        const docs = snapshot.docs;
        hasNextPage = docs.length > PAGE_SIZE;
        const pageDocs = docs.slice(0, PAGE_SIZE);

        currentPage = n;
        render(pageDocs.map(docToPost), { live: false });
    } catch (error) {
        console.error("Failed to load page:", error);
        feedEl.innerHTML = `<p class="empty-state">Couldn't load this page.</p>`;
    }
}

firstBtn.addEventListener("click", () => {
    if (currentPage !== 1) goLive();
});

prevBtn.addEventListener("click", () => {
    if (currentPage <= 1) return;
    if (currentPage - 1 === 1) {
        goLive();
    } else {
        goToPage(currentPage - 1);
    }
});

nextBtn.addEventListener("click", () => {
    if (!hasNextPage) return;
    goToPage(currentPage + 1);
});

lastBtn.addEventListener("click", () => {
    const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);
    if (currentPage !== totalPages) goToPage(totalPages);
});

function goToTypedPage() {
    const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);
    let n = Math.round(Number(pagerGotoEl.value));
    if (!Number.isFinite(n)) n = currentPage;
    n = Math.min(Math.max(n, 1), totalPages);
    pagerGotoEl.value = n;
    if (n === currentPage) return;
    if (n === 1) goLive();
    else goToPage(n);
}

pagerGotoEl.addEventListener("change", goToTypedPage);
pagerGotoEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        pagerGotoEl.blur();
    }
});

// ---------- posting ----------

async function addPost(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    submitBtn.disabled = true;
    try {
        const counterRef = doc(db, "counters", "messages");
        const newMsgRef = doc(collection(db, COLLECTION_NAME));

        await runTransaction(db, async (tx) => {
            const counterSnap = await tx.get(counterRef);
            const nextSeq = (counterSnap.exists() ? counterSnap.data().count : 0) + 1;
            tx.set(counterRef, { count: nextSeq });
            tx.set(newMsgRef, {
                text: trimmed.slice(0, MAX_MESSAGE_LENGTH),
                createdAt: serverTimestamp(),
                seq: nextSeq,
            });
        });

        if (currentPage !== 1 || searchQuery) {
            clearSearch();
            goLive();
        }
    } catch (error) {
        console.error("Failed to post message:", error);
        alert("Couldn't post your message. Check the console.");
    } finally {
        submitBtn.disabled = false;
    }
}

formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    addPost(inputEl.value);
    inputEl.value = "";
    resizeInput();
    inputEl.focus();
});

// Enter sends the message, Shift+Enter inserts a new line.
inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        formEl.requestSubmit();
    }
});

function resizeInput() {
    inputEl.style.height = "auto";
    inputEl.style.height = `${inputEl.scrollHeight}px`;
}

inputEl.addEventListener("input", resizeInput);

// ---------- reply + jump-to-post ----------

feedEl.addEventListener("click", (e) => {
    const replyBtn = e.target.closest(".reply-btn");
    if (replyBtn) {
        insertReplyRef(replyBtn.dataset.no);
        return;
    }

    const quoteLink = e.target.closest(".quotelink");
    if (quoteLink) {
        e.preventDefault();
        hidePreview();
        jumpToPost(quoteLink.dataset.target);
    }
});

function insertReplyRef(seq) {
    const ref = `>>${seq}\n`;
    const start = inputEl.selectionStart ?? inputEl.value.length;
    const end = inputEl.selectionEnd ?? inputEl.value.length;
    inputEl.value = inputEl.value.slice(0, start) + ref + inputEl.value.slice(end);
    resizeInput();
    inputEl.focus();
    const pos = start + ref.length;
    inputEl.setSelectionRange(pos, pos);
}

// Jumps to a post by its number, loading whichever page it's on if it's
// not already visible (one direct query — no page-by-page walking).
async function jumpToPost(seqStr) {
    const seq = Number(seqStr);
    if (!Number.isFinite(seq)) return;

    let target = document.getElementById(`post-${seq}`);
    if (target) {
        scrollAndHighlight(target);
        return;
    }

    if (searchQuery) clearSearch();

    const page = Math.max(Math.floor((totalCount - seq) / PAGE_SIZE) + 1, 1);
    if (page === 1) {
        goLive();
    } else {
        await goToPage(page);
    }

    // give the DOM a tick to update after render()
    requestAnimationFrame(() => {
        target = document.getElementById(`post-${seq}`);
        if (target) scrollAndHighlight(target);
    });
}

// ---------- search (scans the whole collection, capped) ----------

function clearSearch() {
    searchQuery = "";
    searchEl.value = "";
    searchToken++;
}

searchToggleBtn.addEventListener("click", () => {
    const isOpen = searchWrapEl.classList.toggle("open");
    if (isOpen) {
        searchEl.focus();
    } else {
        clearSearch();
        render(lastRenderedPosts, { live: lastRenderedLive });
    }
});

searchEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        searchWrapEl.classList.remove("open");
        clearSearch();
        render(lastRenderedPosts, { live: lastRenderedLive });
        searchEl.blur();
    }
});

searchEl.addEventListener("input", () => {
    searchQuery = searchEl.value.trim();
    clearTimeout(searchDebounceTimer);

    if (!searchQuery) {
        searchToken++;
        render(lastRenderedPosts, { live: lastRenderedLive });
        return;
    }

    searchDebounceTimer = setTimeout(runSearch, 400);
});

async function runSearch() {
    const myToken = ++searchToken;
    const needle = searchQuery.toLowerCase();

    pagerEl.style.display = "none";
    feedEl.innerHTML = `<p class="empty-state">Searching…</p>`;
    countEl.textContent = "searching";

    const matches = [];
    let lastDoc = null;
    let scanned = 0;

    try {
        while (scanned < SEARCH_SCAN_CAP) {
            const constraints = [collection(db, COLLECTION_NAME), orderBy("seq", "desc"), limit(300)];
            if (lastDoc) constraints.push(startAfter(lastDoc));

            const snap = await getDocs(query(...constraints));
            if (myToken !== searchToken) return; // superseded by a newer search
            if (snap.empty) break;

            for (const d of snap.docs) {
                scanned++;
                const data = d.data();
                if (data.text && data.text.toLowerCase().includes(needle)) {
                    matches.push(docToPost(d));
                }
            }

            lastDoc = snap.docs[snap.docs.length - 1];
            if (snap.docs.length < 300) break; // reached the oldest message
        }
    } catch (error) {
        console.error("Search failed:", error);
        if (myToken === searchToken) {
            feedEl.innerHTML = `<p class="empty-state">Search failed. Try again.</p>`;
        }
        return;
    }

    if (myToken !== searchToken) return;

    countEl.textContent = `${matches.length} result${matches.length === 1 ? "" : "s"}`;

    if (matches.length === 0) {
        feedEl.innerHTML = `<p class="empty-state">No matches found${scanned >= SEARCH_SCAN_CAP ? ` in the most recent ${SEARCH_SCAN_CAP} posts` : ""}.</p>`;
        return;
    }

    feedEl.innerHTML = matches.map(postArticleHtml).join("");
}

// ---------- hover preview for >>N links ----------

let previewTimer = null;
let previewCurrentSeq = null;
const previewCache = new Map();

function positionPreview(rect) {
    const margin = 8;
    let left = rect.left;
    let top = rect.bottom + margin;

    // keep it on screen
    const maxLeft = window.innerWidth - 290;
    if (left > maxLeft) left = Math.max(maxLeft, 8);
    if (top + 220 > window.innerHeight) top = Math.max(rect.top - 220 - margin, 8);

    previewEl.style.left = `${left}px`;
    previewEl.style.top = `${top}px`;
}

function hidePreview() {
    clearTimeout(previewTimer);
    previewCurrentSeq = null;
    previewEl.hidden = true;
}

function renderPreview(seq, bodyHtml) {
    if (previewCurrentSeq !== seq) return; // moved on to a different link already
    previewEl.innerHTML = `<div class="preview-meta">Anonymous #${seq}</div><div class="post-body">${bodyHtml}</div>`;
    previewEl.hidden = false;
}

async function showPreview(link) {
    const seq = link.dataset.target;
    previewCurrentSeq = seq;
    positionPreview(link.getBoundingClientRect());

    // already on screen? use it directly, no fetch needed
    const existing = document.getElementById(`post-${seq}`);
    if (existing) {
        renderPreview(seq, existing.querySelector(".post-body").innerHTML);
        return;
    }

    if (previewCache.has(seq)) {
        renderPreview(seq, previewCache.get(seq));
        return;
    }

    previewEl.innerHTML = `<div class="preview-meta">Anonymous #${seq}</div><div class="post-body">Loading…</div>`;
    previewEl.hidden = false;

    try {
        const snap = await getDocs(
            query(collection(db, COLLECTION_NAME), orderBy("seq", "desc"), startAt(Number(seq)), limit(1))
        );
        if (previewCurrentSeq !== seq) return; // hovered elsewhere while this was loading

        if (snap.empty || snap.docs[0].data().seq !== Number(seq)) {
            previewEl.innerHTML = `<div class="post-body">Message not found.</div>`;
            return;
        }

        const bodyHtml = renderBody(snap.docs[0].data().text || "");
        previewCache.set(seq, bodyHtml);
        renderPreview(seq, bodyHtml);
    } catch (error) {
        console.error("Preview fetch failed:", error);
        if (previewCurrentSeq === seq) {
            previewEl.innerHTML = `<div class="post-body">Couldn't load preview.</div>`;
        }
    }
}

feedEl.addEventListener("mouseover", (e) => {
    const link = e.target.closest(".quotelink");
    if (!link || link.dataset.target === previewCurrentSeq) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => showPreview(link), 250);
});

feedEl.addEventListener("mouseout", (e) => {
    const link = e.target.closest(".quotelink");
    if (!link || link.contains(e.relatedTarget)) return;
    hidePreview();
});

// ---------- background tab notification ----------
// While the tab is hidden and new messages come in, badge the favicon and
// prefix the title with a count — cleared the moment the tab is looked at.

const originalTitle = document.title;
let unseenCount = 0;
let previousTopSeq = null;

function makeFavicon(withBadge) {
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#0c0d0a";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#e0b34d";
    ctx.font = "bold 20px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(">", size / 2 - 2, size / 2 + 1);

    if (withBadge) {
        ctx.beginPath();
        ctx.arc(size - 7, 7, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#c94f4f";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#0c0d0a";
        ctx.stroke();
    }

    return canvas.toDataURL("image/png");
}

function setFavicon(withBadge) {
    faviconEl.href = makeFavicon(withBadge);
}

function updateTabNotice() {
    document.title = unseenCount > 0 ? `(${unseenCount}) ${originalTitle}` : originalTitle;
    setFavicon(unseenCount > 0);
}

setFavicon(false);

// ---------- lifecycle ----------

// Pause the realtime listener while the tab is in the background — an idle
// tab left open all day would otherwise keep racking up reads for nothing.
// Note: the listener now stays active even while the tab is hidden, so that
// new-message notifications (favicon badge + title count) keep working.
// This trades a small amount of extra background reads for that — still
// cheap at this scale, but worth knowing if usage ever grows a lot.
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
        unseenCount = 0;
        updateTabNotice();
        if (currentPage === 1 && !liveUnsubscribe && !searchQuery) {
            goLive();
        }
    }
});

goLive();
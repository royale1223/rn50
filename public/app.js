const slides = Array.from(document.querySelectorAll(".slide"));
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const slideCounter = document.getElementById("slideCounter");
const dots = document.getElementById("dots");

let index = 0;

function renderDots() {
  dots.innerHTML = "";
  slides.forEach((s, i) => {
    const d = document.createElement("div");
    d.className = "dot" + (i === index ? " is-active" : "");
    d.title = s.dataset.title || `Slide ${i + 1}`;
    d.addEventListener("click", () => goTo(i));
    dots.appendChild(d);
  });
}

function goTo(i) {
  index = Math.max(0, Math.min(slides.length - 1, i));
  slides.forEach((s, j) => s.classList.toggle("is-active", j === index));
  slideCounter.textContent = `${index + 1} / ${slides.length}`;
  const atFirst = index === 0;
  const atLast = index === slides.length - 1;

  prevBtn.disabled = atFirst;
  nextBtn.disabled = atLast;

  // Hide Next on last slide (as requested)
  nextBtn.style.display = atLast ? "none" : "inline-flex";

  renderDots();

  // keep URL share-friendly
  history.replaceState(null, "", `#${index + 1}`);
}

prevBtn.addEventListener("click", () => goTo(index - 1));
nextBtn.addEventListener("click", () => goTo(index + 1));

// swipe (deck navigation)
// Important: don't hijack swipes that are meant for horizontal carousels (mediaStrip)
let touchX = null;
let touchY = null;
let swipeEnabled = true;

window.addEventListener(
  "touchstart",
  (e) => {
    const t = e.target;
    swipeEnabled = !(t && t.closest && (t.closest(".mediaStrip") || t.closest("input") || t.closest("textarea")));
    if (!swipeEnabled) {
      touchX = null;
      touchY = null;
      return;
    }
    touchX = e.touches?.[0]?.clientX ?? null;
    touchY = e.touches?.[0]?.clientY ?? null;
  },
  { passive: true },
);

window.addEventListener(
  "touchend",
  (e) => {
    if (!swipeEnabled) return;
    const endX = e.changedTouches?.[0]?.clientX ?? null;
    const endY = e.changedTouches?.[0]?.clientY ?? null;
    if (touchX == null || endX == null || touchY == null || endY == null) return;

    const dx = endX - touchX;
    const dy = endY - touchY;

    // Only treat as slide navigation if it's a mostly-horizontal swipe
    if (Math.abs(dx) < 60) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.2) return;

    if (dx < 0) goTo(index + 1);
    else goTo(index - 1);

    touchX = null;
    touchY = null;
  },
  { passive: true },
);

// keyboard
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") goTo(index + 1);
  if (e.key === "ArrowLeft") goTo(index - 1);
});

// start slide from URL
const hashNum = Number(String(location.hash || "").replace("#", ""));
if (Number.isFinite(hashNum) && hashNum >= 1 && hashNum <= slides.length) {
  index = hashNum - 1;
}
goTo(index);

// Try to force autoplay on mobile (iOS sometimes needs a gesture)
(function ensureHeroAutoplay() {
  const v = document.getElementById("heroVideo");
  if (!v) return;

  const tryPlay = async () => {
    try {
      // ensure these are set (in case browser toggled)
      v.muted = true;
      v.playsInline = true;
      await v.play();
    } catch {
      // ignore; will retry on first gesture
    }
  };

  // On mobile Chrome, immediately trying to autoplay can trigger a large video download
  // and make the page feel like it's "not loading". Defer autoplay until first user gesture,
  // and respect data-saver / slow connections.
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const saveData = !!conn?.saveData;
  const effectiveType = String(conn?.effectiveType || "");
  const slowNet = saveData || /(^|\b)(2g|3g|slow-2g)(\b|$)/.test(effectiveType);

  const once = () => {
    if (!slowNet) tryPlay();
    window.removeEventListener("touchstart", once);
    window.removeEventListener("click", once);
  };
  window.addEventListener("touchstart", once, { passive: true });
  window.addEventListener("click", once, { passive: true });
})();

// Poll
const pollStatus = document.getElementById("pollStatus");
const pollButtons = Array.from(document.querySelectorAll(".pollBtn"));
const otherDateWrap = document.getElementById("otherDateWrap");
const otherDateText = document.getElementById("otherDateText");
const userNameBanner = document.getElementById("userNameBanner");

function showUserName(name) {
  if (!userNameBanner) return;
  if (name && String(name).trim()) {
    // Build DOM safely (avoid innerHTML with user-provided name)
    userNameBanner.innerHTML = "";

    const label = document.createElement("span");
    label.textContent = "Voting as: ";

    const n = document.createElement("span");
    n.textContent = String(name).trim();

    const space = document.createElement("span");
    space.textContent = " ";

    const logout = document.createElement("span");
    logout.id = "logoutLink";
    logout.textContent = "Logout";
    logout.style.color = "rgba(255,255,255,0.65)";
    logout.style.marginLeft = "10px";
    logout.style.textDecoration = "underline";
    logout.style.cursor = "pointer";
    logout.style.fontSize = "12px";

    userNameBanner.appendChild(label);
    userNameBanner.appendChild(n);
    userNameBanner.appendChild(space);
    userNameBanner.appendChild(logout);
    userNameBanner.hidden = false;

    logout.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Clear identity and require OTP again
      localStorage.removeItem("reunion50_phone_token");
      localStorage.removeItem("reunion50_user_name");
      document.getElementById("authGate").style.display = "block";
      setVoteEnabled(false);
      showUserName(null);
      setAuth("Logged out. Please verify to vote.");
      setStatus("Verification required.");
      // refresh results (highlights may clear because token removed)
      fetchResults();
    };
  } else {
    // If verified but no name found (legacy vote), show prompt
    if (getPhoneToken()) {
      userNameBanner.innerHTML = `Voting as: <span style='opacity:0.7'>(Name not saved)</span> <span id='addNameTrigger' style='color:#4ade80;margin-left:5px;text-decoration:underline;cursor:pointer'>Tap to add</span>`;
      userNameBanner.hidden = false;
      // Re-attach listener specifically to the new element
      const trigger = document.getElementById("addNameTrigger");
      if (trigger) {
        trigger.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Force open auth gate and clear old identity so name can be captured
          document.getElementById("authGate").style.display = "block";
          localStorage.removeItem("reunion50_phone_token");
          localStorage.removeItem("reunion50_user_name");
          setVoteEnabled(false);
          setAuth("Please verify again and enter your name.");
          setStatus("Verification required.");
        };
      }
    } else {
      userNameBanner.hidden = true;
    }
  }
}

// Auth elements
const authMsg = document.getElementById("authMsg");
const authName = document.getElementById("authName");
const authPhone = document.getElementById("authPhone");
const authOtp = document.getElementById("authOtp");
const otpSection = document.getElementById("otpSection");
const sendOtpBtn = document.getElementById("sendOtpBtn");
const verifyOtpBtn = document.getElementById("verifyOtpBtn");
const resendOtpBtn = document.getElementById("resendOtpBtn");

function getTapToken() {
  const k = "reunion50_tap_token";
  let t = localStorage.getItem(k);
  if (!t) {
    t = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(k, t);
  }
  return t;
}

function getPhoneToken() {
  return localStorage.getItem("reunion50_phone_token");
}

function setPhoneToken(tok) {
  if (tok) localStorage.setItem("reunion50_phone_token", tok);
}

function setAuth(text, kind = "info") {
  authMsg.textContent = text;
  authMsg.style.color = kind === "error" ? "rgba(255,92,122,0.90)" : "rgba(255,255,255,0.68)";
}

function setStatus(text, kind = "info") {
  pollStatus.textContent = text;
  pollStatus.style.color =
    kind === "error" ? "rgba(255,92,122,0.90)" : "rgba(255,255,255,0.68)";
}

function setVoteEnabled(enabled) {
  // enables both venue + date buttons; per-kind locking is handled by fetchResults
  pollButtons.forEach((b) => (b.disabled = !enabled));
}

async function sendOtp() {
  const originalText = sendOtpBtn.textContent;
  sendOtpBtn.disabled = true;
  sendOtpBtn.textContent = "Sending…";
  setAuth("Sending OTP…");
  try {
    const r = await fetch("/api/auth/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: authName.value, phone: authPhone.value }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Failed to send OTP");
    otpSection.hidden = false;
    setAuth("OTP sent. Enter the 6-digit code.");
    sendOtpBtn.textContent = "Sent";
  } catch (e) {
    const msg = String(e?.message || e);

    // If allowlist blocks this number, treat as logged out (token is no longer valid for use)
    if (msg.toLowerCase().includes("contact an organiser")) {
      localStorage.removeItem("reunion50_phone_token");
      localStorage.removeItem("reunion50_user_name");
      document.getElementById("authGate").style.display = "block";
      showUserName(null);
      setVoteEnabled(false);
      setStatus("Verification required.");
    }

    setAuth(msg, "error");
    sendOtpBtn.disabled = false;
    sendOtpBtn.textContent = originalText;
  }
}

async function verifyOtp() {
  const originalText = verifyOtpBtn.textContent;
  verifyOtpBtn.disabled = true;
  resendOtpBtn.disabled = true;
  verifyOtpBtn.textContent = "Verifying…";
  setAuth("Verifying…");
  try {
    const r = await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: authPhone.value, otp: authOtp.value }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "OTP verify failed");
    setPhoneToken(j.token);
    if (j.name) localStorage.setItem("reunion50_user_name", j.name);
    setAuth("Verified. You can vote now.");
    setVoteEnabled(true);
    verifyOtpBtn.textContent = "Verified";
    // Collapse auth section after success
    setTimeout(() => {
      setVerifiedState();
    }, 1200);
  } catch (e) {
    const msg = String(e?.message || e);

    // If allowlist blocks this number, force logout UI
    if (msg.toLowerCase().includes("contact an organiser")) {
      localStorage.removeItem("reunion50_phone_token");
      localStorage.removeItem("reunion50_user_name");
      document.getElementById("authGate").style.display = "block";
      showUserName(null);
      setVoteEnabled(false);
      setStatus("Verification required.");
    }

    setAuth(msg, "error");
    verifyOtpBtn.disabled = false;
    resendOtpBtn.disabled = false;
    verifyOtpBtn.textContent = originalText;
  }
}

sendOtpBtn?.addEventListener("click", sendOtp);
verifyOtpBtn?.addEventListener("click", verifyOtp);
resendOtpBtn?.addEventListener("click", () => {
  sendOtpBtn.disabled = false;
  sendOtp();
});

function setVerifiedState() {
  setVoteEnabled(true);
  document.getElementById("authGate").style.display = "none";

  showUserName(localStorage.getItem("reunion50_user_name"));
  
  // Show verified status with "Change" link
  pollStatus.innerHTML = `
    <span style="color:#4ade80">Verified</span> 
    <button id="changeAuthBtn" style="background:none; border:none; color:var(--muted); text-decoration:underline; font-size:12px; margin-left:8px; cursor:pointer;">Change</button>
    <br>Please cast your vote.
  `;
  
  document.getElementById("changeAuthBtn")?.addEventListener("click", () => {
    document.getElementById("authGate").style.display = "block";
    setAuth("Verify again to change number.");
    pollStatus.textContent = "Verifying...";
    localStorage.removeItem("reunion50_phone_token");
    localStorage.removeItem("reunion50_user_name");
    showUserName(null);
    setVoteEnabled(false);
  });
}

// Pre-enable voting if token exists
if (getPhoneToken()) {
  setVerifiedState();
} else {
  setVoteEnabled(false);
}

function updateVenueBars(votes) {
  const total = Object.values(votes).reduce((a, b) => a + (b || 0), 0);
  for (const key of ["kadavu", "vythiri", "bolgatty"]) {
    const count = votes[key] || 0;
    const pct = total ? Math.round((count / total) * 100) : 0;
    document.getElementById(`count-${key}`).textContent = String(count);
    document.getElementById(`bar-${key}`).style.width = `${pct}%`;
  }
  return total;
}

function updateDateBars(votes) {
  const keys = ["july18_19", "aug8_9", "other"];
  const total = keys.reduce((a, k) => a + (votes?.[k] || 0), 0);
  for (const key of keys) {
    const count = votes?.[key] || 0;
    const pct = total ? Math.round((count / total) * 100) : 0;
    const c = document.getElementById(`count-${key}`);
    const b = document.getElementById(`bar-${key}`);
    if (c) c.textContent = String(count);
    if (b) b.style.width = `${pct}%`;
  }
  return total;
}

// Celebrate when a vote is cast AND both votes are complete.
// Also celebrate when results transition from incomplete -> complete.
let celebrateAfterNextResults = false;
let wasComplete = false;

function resetCelebrateOverlay() {
  const wrap = document.getElementById("celebrate");
  if (!wrap) return;
  wrap.hidden = true;
  wrap.style.display = "none";
}

// Defensive: iOS/Safari can restore a previous page state (bfcache) where the overlay was visible.
resetCelebrateOverlay();
window.addEventListener("pageshow", () => resetCelebrateOverlay());

function runConfetti(durationMs = 2200) {
  const wrap = document.getElementById("celebrate");
  const canvas = document.getElementById("confettiCanvas");
  if (!wrap || !canvas) return;

  wrap.hidden = false;
  // defensive: some browsers keep [hidden] styles cached weirdly
  wrap.style.display = "grid";

  const ctx = canvas.getContext("2d");
  // Ensure the message card is centered and visible
  const card = wrap.querySelector?.(".celebrate__card");
  if (card) {
    card.style.position = "relative";
    card.style.zIndex = "2";
    card.style.margin = "0 14px";
    card.style.padding = "22px 18px";
    card.style.borderRadius = "18px";
    card.style.border = "1px solid rgba(255,255,255,0.18)";
    card.style.background = "rgba(15,18,32,0.88)";
    card.style.textAlign = "center";
  }
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const colors = ["#7c5cff", "#3dd6d0", "#4ade80", "#ff5c7a", "#fbbf24", "#ffffff"]; 
  const parts = Array.from({ length: 160 }).map(() => ({
    x: Math.random() * window.innerWidth,
    y: -20 - Math.random() * window.innerHeight * 0.3,
    r: 3 + Math.random() * 4,
    vx: -2 + Math.random() * 4,
    vy: 3 + Math.random() * 6,
    rot: Math.random() * Math.PI,
    vr: -0.2 + Math.random() * 0.4,
    c: colors[(Math.random() * colors.length) | 0],
  }));

  let raf = 0;
  const start = performance.now();

  const tick = (t) => {
    const elapsed = t - start;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06; // gravity
      p.rot += p.vr;

      // wrap horizontally
      if (p.x < -40) p.x = window.innerWidth + 40;
      if (p.x > window.innerWidth + 40) p.x = -40;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.r, -p.r, p.r * 2.2, p.r * 1.2);
      ctx.restore();
    }

    if (elapsed < durationMs) {
      raf = requestAnimationFrame(tick);
    } else {
      dismiss();
    }
  };

  window.addEventListener("resize", resize);

  // allow tap to dismiss early (use pointer events for iOS)
  let hardTimer = 0;
  const dismiss = () => {
    if (hardTimer) {
      clearTimeout(hardTimer);
      hardTimer = 0;
    }
    cancelAnimationFrame(raf);
    wrap.hidden = true;
    wrap.style.display = "none";
    window.removeEventListener("resize", resize);
    wrap.removeEventListener("click", dismiss);
    wrap.removeEventListener("touchstart", dismiss);
    wrap.removeEventListener("pointerdown", dismiss);
  };

  // Start the animation
  raf = requestAnimationFrame(tick);

  // Hard auto-dismiss (prevents blocking login if animation stalls)
  hardTimer = window.setTimeout(dismiss, Math.max(3200, durationMs + 1200));

  wrap.addEventListener("click", dismiss);
  wrap.addEventListener("touchstart", dismiss, { passive: true });
  wrap.addEventListener("pointerdown", dismiss);
}

async function fetchResults() {
  try {
    const headers = {};
    const token = getPhoneToken();
    if (token) headers["x-phone-token"] = token;

    const r = await fetch("/api/results", { headers, cache: "no-store" });
    const j = await r.json();
    if (!j.ok) throw new Error("Bad response");
    const venueTotal = updateVenueBars(j.votes);
    const dateTotal = updateDateBars(j.dateVotes);

    if (j.forceLogout) {
      localStorage.removeItem("reunion50_phone_token");
      localStorage.removeItem("reunion50_user_name");
      document.getElementById("authGate").style.display = "block";
      showUserName(null);
      setVoteEnabled(false);
      setAuth("Not verified yet.");
      setStatus("Verification required.");
      return;
    }

    if (j.userName) {
      localStorage.setItem("reunion50_user_name", j.userName);
      showUserName(j.userName);
    }

    // reset selection UI
    pollButtons.forEach((b) => {
      b.classList.remove("is-selected");
      // reset any inline highlight (defensive against CSS cache issues)
      b.style.border = "1px solid var(--border)";
      b.style.background = "rgba(255,255,255,0.08)";
      // remove tag if present
      const t = b.querySelector?.(".tag");
      if (t) t.remove();
    });

    // mark selection (highlight should show even if not verified)
    const verified = document.getElementById("authGate").style.display === "none";

    const votedV = Array.isArray(j.votedVenue) ? j.votedVenue : (j.votedVenue ? [j.votedVenue] : []);
    const votedD = j.votedDate || "";

    for (const btn of pollButtons) {
      const k = btn.dataset.kind;
      const opt = btn.dataset.option;

      // Disable buttons unless verified (but still show highlight)
      btn.disabled = !verified;

      if (k === "venue" && votedV.includes(opt)) {
        btn.classList.add("is-selected");
        btn.style.border = "2px solid #4ade80";
        btn.style.background = "rgba(74, 222, 128, 0.18)";
      }
      if (k === "date" && votedD && opt === votedD) {
        btn.classList.add("is-selected");
        btn.style.border = "2px solid #4ade80";
        btn.style.background = "rgba(74, 222, 128, 0.18)";
      }
    }

    if (document.getElementById("authGate").style.display === "none") {
      const parts = [];
      parts.push(`Venue votes: ${venueTotal}`);
      parts.push(`Date votes: ${dateTotal}`);
      if (j.hasVotedVenue) parts.push(`<span style=\"color:#4ade80\">Venue voted</span>`);
      if (j.hasVotedDate) parts.push(`<span style=\"color:#4ade80\">Date voted</span>`);
      pollStatus.innerHTML = parts.join(" • ");

      const isComplete = !!(j.hasVotedVenue && j.hasVotedDate);

      // Celebrate after a vote is cast, if both votes are complete
      if (celebrateAfterNextResults && isComplete) {
        celebrateAfterNextResults = false;
        runConfetti(2400);
      }

      // Also celebrate if the user just became complete (first time in this page session)
      if (!wasComplete && isComplete) {
        // Avoid double-trigger if vote-trigger already ran above in same tick
        if (!document.getElementById("celebrate")?.hidden) {
          // already showing
        } else {
          runConfetti(2400);
        }
      }

      wasComplete = isComplete;
    }
  } catch (e) {
    console.error(e);
  }
}

function applySelectedStyle(btn, selected) {
  if (!btn) return;
  if (selected) {
    btn.classList.add("is-selected");
    // Inline styles (defensive for iOS paint/cache quirks)
    btn.style.border = "2px solid #4ade80";
    btn.style.background = "rgba(74, 222, 128, 0.18)";
  } else {
    btn.classList.remove("is-selected");
    btn.style.border = "1px solid var(--border)";
    btn.style.background = "rgba(255,255,255,0.08)";
  }
}

async function vote(kind, option) {
  // optimistic UI highlight
  if (kind === "date") {
    // single-select
    for (const b of pollButtons) {
      if (b.dataset.kind === kind) applySelectedStyle(b, false);
    }
    const clicked = pollButtons.find((b) => b.dataset.kind === kind && b.dataset.option === option);
    if (clicked) applySelectedStyle(clicked, true);
  } else {
    // venue: multi-select toggle
    const clicked = pollButtons.find((b) => b.dataset.kind === kind && b.dataset.option === option);
    if (clicked) {
      const willSelect = !clicked.classList.contains("is-selected");
      applySelectedStyle(clicked, willSelect);
    }
  }

  // UI feedback
  pollButtons.filter(b => b.dataset.kind === kind).forEach((b) => (b.disabled = true));
  setStatus(`Submitting ${kind} vote…`);

  const payload = { kind, option, token: getTapToken(), phoneToken: getPhoneToken() };
  if (kind === "date" && option === "other") {
    payload.otherText = otherDateText?.value || "";
  }

  try {
    const r = await fetch("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Vote failed");

    updateVenueBars(j.votes);
    updateDateBars(j.dateVotes);
    setStatus("Vote recorded. Thank you.");

    // If a vote was cast, and both votes are complete, show celebration on next results refresh.
    celebrateAfterNextResults = true;

    // refresh state (also handles "already voted" locks)
    fetchResults();
  } catch (e) {
    // If server says already voted, show clean message and refresh
    const msg = String(e?.message || e);
    if (msg.toLowerCase().includes("already voted")) {
      setStatus(msg);
      fetchResults();
      return;
    }

    setStatus(msg, "error");
    // allow retry if still verified
    const ok = !!getPhoneToken();
    pollButtons.filter(b => b.dataset.kind === kind).forEach((b) => (b.disabled = !ok));
  }
}

pollButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const kind = btn.dataset.kind || "venue";
    const option = btn.dataset.option;
    if (kind === "date" && option === "other") {
      otherDateWrap.style.display = "grid";
    }
    vote(kind, option);
  });
});

// refresh results periodically (only when the Vote slide is active)
let resultsTimer = 0;
function startResultsPolling() {
  if (resultsTimer) return;
  fetchResults();
  resultsTimer = window.setInterval(fetchResults, 5000);
}
function stopResultsPolling() {
  if (!resultsTimer) return;
  clearInterval(resultsTimer);
  resultsTimer = 0;
}

// Start polling only when user is on the Vote slide (last slide)
function updatePollingForSlide() {
  const atVoteSlide = index === slides.length - 1;
  if (atVoteSlide) startResultsPolling();
  else stopResultsPolling();
}

// --- click results to view voter names ---
function showVoterModal({ title, names, error }) {
  const modal = document.getElementById("voterModal");
  const titleEl = document.getElementById("voterModalTitle");
  const countEl = document.getElementById("voterModalCount");
  const listEl = document.getElementById("voterModalList");
  const closeBtn = document.getElementById("voterModalClose");
  const searchEl = document.getElementById("voterModalSearch");

  if (!modal || !titleEl || !countEl || !listEl || !closeBtn || !searchEl) {
    // fallback to alert if modal isn't present
    if (error) return alert(error);
    return alert(`${title}\n\n${(names || []).join("\n")}`);
  }

  const close = () => {
    modal.hidden = true;
    modal.style.display = "none";
    document.body.style.overflow = "";
    searchEl.value = "";
  };

  // attach close handlers (idempotent)
  closeBtn.onclick = close;
  modal.querySelectorAll("[data-close='1']").forEach((el) => (el.onclick = close));

  const all = Array.isArray(names) ? names : [];
  titleEl.textContent = title || "Voters";
  countEl.textContent = error ? "" : `${all.length} voter${all.length === 1 ? "" : "s"}`;

  const render = () => {
    const q = String(searchEl.value || "").trim().toLowerCase();
    const filtered = q ? all.filter((n) => String(n).toLowerCase().includes(q)) : all;
    listEl.innerHTML = "";

    if (error) {
      const div = document.createElement("div");
      div.className = "modal__item";
      div.textContent = error;
      listEl.appendChild(div);
      return;
    }

    if (!filtered.length) {
      const div = document.createElement("div");
      div.className = "modal__item";
      div.textContent = q ? "No matches." : "No votes yet.";
      listEl.appendChild(div);
      return;
    }

    filtered.forEach((n) => {
      const div = document.createElement("div");
      div.className = "modal__item";
      div.textContent = n;
      listEl.appendChild(div);
    });
  };

  searchEl.oninput = render;
  render();

  modal.hidden = false;
  modal.style.display = "grid";
  document.body.style.overflow = "hidden";

  // Escape closes
  const onKey = (ev) => {
    if (ev.key === "Escape") {
      window.removeEventListener("keydown", onKey);
      close();
    }
  };
  window.addEventListener("keydown", onKey);

  // focus search for quick filtering
  setTimeout(() => {
    try { searchEl.focus(); } catch {}
  }, 0);
}

async function showVoters(kind, option, label) {
  try {
    const r = await fetch(`/api/voters?kind=${encodeURIComponent(kind)}&option=${encodeURIComponent(option)}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Failed");
    const names = Array.isArray(j.names) ? j.names : [];
    const title = `${label} (${names.length})`;
    if (!names.length) {
      showVoterModal({ title, names: [] });
      return;
    }
    showVoterModal({ title, names });
  } catch (e) {
    showVoterModal({ title: "Error", names: [], error: `Could not load voter names. ${String(e?.message || e)}` });
  }
}

function bindVoterClick(kind, option, label) {
  const c = document.getElementById(`count-${option}`);
  const fill = document.getElementById(`bar-${option}`);
  const bar = fill?.parentElement || null; // easier to tap than the fill itself

  const handler = () => showVoters(kind, option, label);
  [c, bar, fill].forEach((el) => {
    if (!el) return;
    el.style.cursor = "pointer";
    el.title = "Tap to view voter names";
    el.addEventListener("click", handler);
  });
}

// Venue
bindVoterClick("venue", "kadavu", "Kadavu");
bindVoterClick("venue", "vythiri", "Vythiri");
bindVoterClick("venue", "bolgatty", "Bolgatty");
// Date
bindVoterClick("date", "july18_19", "18–19 Jul");
bindVoterClick("date", "aug8_9", "8–9 Aug");
bindVoterClick("date", "other", "Other date");

// Initial + hook into navigation
updatePollingForSlide();
const _goTo = goTo;
goTo = function(i) {
  _goTo(i);
  updatePollingForSlide();
};

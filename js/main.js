/* =========================================================
   Olive & Oat — interactions & motion
   GSAP + ScrollTrigger handle the few animations; scrolling is native.
   If the libraries fail to load or the visitor prefers reduced motion,
   everything still works without them.
   ========================================================= */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const html = document.documentElement;

  const hasGSAP = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";
  const reduceMotion = !html.classList.contains("force-motion") && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motion = hasGSAP && !reduceMotion;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  if (hasGSAP) {
    gsap.registerPlugin(ScrollTrigger);
    gsap.defaults({ ease: "power3.out", duration: 0.9 });
  }

  const store = {
    // Storage is looked up inside try: it throws when the file is opened from a data: URL or a locked-down viewer
    get(k, s = "localStorage") { try { return window[s].getItem(k); } catch { return null; } },
    set(k, v, s = "localStorage") { try { window[s].setItem(k, v); } catch { /* storage unavailable */ } },
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // saved choice → browser language → English
  let lang = store.get("oo-lang") || ((navigator.language || "en").toLowerCase().startsWith("el") ? "el" : "en");
  if (!I18N[lang]) lang = "en";

  const t = (key, vars = {}) => {
    const str = (I18N[lang] && I18N[lang][key]) ?? I18N.en[key] ?? key;
    return typeof str === "string" ? str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "") : str;
  };
  const euro = (n) => "€" + n.toFixed(2);

  /* =========================================================
     Background film — one continuous Seedance shot behind the whole page.
     Scroll position picks the moment of the film: each section is pinned to
     the scene that belongs to it, and the playhead glides toward that moment
     (frame-rate independent easing) so scrubbing never jumps.
     ========================================================= */
  const filmBox = $(".film");
  const film = $(".film-video");
  // [section, film time in seconds when that section's top reaches the middle of the screen]
  const FILM_MARKS = [
    ["#about", 3.7],               // bread & honey counter
    ["#crew", 7.7],                // through the archway into the kitchen
    [".signatures", 10.1],         // the brunch table
    ["#menu", 11.2],
    ["#gallery", 11.9],
    ["#reviews", 12.4],
    ["#reserve", 13.9],            // out through the curtains onto the terrace
    ["#visit", 14.6],
  ];
  let filmStops = [];
  let filmTarget = 0.2;
  let filmTime = 0.2;
  let filmReady = false;

  function measureFilm() {
    if (!film || !film.duration) return;
    const end = film.duration - 0.05;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    filmStops = [[0, 0.2]];
    FILM_MARKS.forEach(([sel, time]) => {
      const el = $(sel);
      if (!el) return;
      const y = el.getBoundingClientRect().top + window.scrollY - innerHeight * 0.5;
      if (y > filmStops[filmStops.length - 1][0]) filmStops.push([Math.min(y, maxScroll - 1), Math.min(time, end)]);
    });
    filmStops.push([maxScroll, end]);
  }

  function filmTimeAt(y) {
    for (let i = 1; i < filmStops.length; i++) {
      const [y1, t1] = filmStops[i];
      if (y <= y1) {
        const [y0, t0] = filmStops[i - 1];
        return t0 + (t1 - t0) * ((y - y0) / (y1 - y0 || 1));
      }
    }
    return filmStops.length ? filmStops[filmStops.length - 1][1] : 0;
  }

  if (film) {
    film.addEventListener("loadedmetadata", () => { measureFilm(); filmTarget = filmTime = filmTimeAt(window.scrollY); });
    const wakeFilm = () => {
      if (filmReady) return;
      // a muted play()/pause() "wakes" the decoder on iOS so later seeks paint immediately
      const p = film.play();
      const ready = () => { film.pause(); film.currentTime = filmTime; filmReady = true; filmBox.classList.add("is-ready"); };
      p && p.then ? p.then(ready, ready) : ready();
    };
    film.addEventListener("loadeddata", wakeFilm, { once: true });
    window.addEventListener("resize", measureFilm);
    window.addEventListener("load", measureFilm);
    // a cached or fast video can finish loading before this script runs, so its events have already fired
    if (film.readyState >= 1) { measureFilm(); filmTarget = filmTime = filmTimeAt(window.scrollY); }
    if (film.readyState >= 2) wakeFilm();
  }

  function stepFilm(dt) {
    if (!filmReady) return;
    filmTarget = filmTimeAt(window.scrollY);
    filmTime += (filmTarget - filmTime) * (1 - Math.pow(0.86, dt / 16.67));
    if (Math.abs(film.currentTime - filmTime) > 1 / 48 && !film.seeking) film.currentTime = filmTime;
  }

  if (film) {
    // a light frame loop eases the playhead toward the scroll position (seeks only when it actually moves)
    let last = performance.now();
    const loop = (now) => { stepFilm(Math.min(now - last, 100)); last = now; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    if (hasGSAP) ScrollTrigger.addEventListener("refresh", measureFilm);
  }

  const scrollToTarget = (target) => {
    const top = typeof target === "number" ? target : target.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
  };
  const lockScroll = (on) => { html.style.overflow = on ? "hidden" : ""; };

  /* =========================================================
     Cyprus local time, open status, hours
     ========================================================= */
  function cyprusNow() {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Nicosia", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type).value;
    const dayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    return { day: dayIdx, minutes: (+get("hour") % 24) * 60 + +get("minute") };
  }
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

  function renderStatus() {
    const pill = $("#open-status");
    const { day, minutes } = cyprusNow();
    const [open, close] = HOURS[day];
    let text;
    if (minutes >= toMin(open) && minutes < toMin(close)) {
      pill.classList.remove("closed");
      text = t("status.open", { time: close });
    } else {
      pill.classList.add("closed");
      const nextDay = minutes < toMin(open) ? day : (day + 1) % 7;
      const label = nextDay === day ? t("status.today") : nextDay === (day + 1) % 7 ? t("status.tomorrow") : t("days")[nextDay];
      text = t("status.closed", { day: label, time: HOURS[nextDay][0] });
    }
    $(".status-text", pill).textContent = text;
  }

  function renderHours() {
    const { day } = cyprusNow();
    $("#hours-table tbody").innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `
      <tr class="${d === day ? "today" : ""}"><td>${t("days")[d]}</td><td>${HOURS[d][0]} – ${HOURS[d][1]}</td></tr>`).join("");
  }

  /* =========================================================
     Language
     ========================================================= */
  const langPill = $(".lang-switch .pill");
  function moveLangPill(animate) {
    const btn = $(`.lang-switch button[data-lang="${lang}"]`);
    const props = { x: btn.offsetLeft - 2, width: btn.offsetWidth };
    if (hasGSAP) animate && motion ? gsap.to(langPill, { ...props, duration: 0.4 }) : gsap.set(langPill, props);
    else Object.assign(langPill.style, { transform: `translateX(${props.x}px)`, width: props.width + "px" });
  }

  function applyLanguage() {
    html.lang = lang;
    $$("[data-i18n]").forEach((el) => {
      const val = t(el.dataset.i18n);
      if (/<[a-z]/i.test(val)) el.innerHTML = val;
      else el.textContent = val;
    });
    $$("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    $$("[data-i18n-alt]").forEach((el) => { el.alt = t(el.dataset.i18nAlt); });
    $$("[data-i18n-label]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nLabel)));
    $$(".lang-switch button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));

    renderStatus();
    renderHours();
    renderMenuTabs();
    renderMenu();
    if (!dish.hidden) fillDish();
    renderGallery();
    renderReviews();
    fillGuests();
    fillTimes();
    updateHireLinks();
    document.dispatchEvent(new CustomEvent("site:lang", { detail: lang }));
  }

  function setLanguage(next) {
    if (next === lang) return;
    lang = next;
    store.set("oo-lang", lang);
    $$(".lang-switch button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    moveLangPill(true);
    applyLanguage();
    updateTabPill(false);
    if (motion) gsap.fromTo("#main", { opacity: 0.4 }, { opacity: 1, duration: 0.35, ease: "power1.out", clearProps: "opacity" });
  }
  $$(".lang-switch button").forEach((btn) => btn.addEventListener("click", () => setLanguage(btn.dataset.lang)));

  /* =========================================================
     Header, nav, anchors
     ========================================================= */
  const header = $(".site-header");
  let lastY = 0;
  let navOpen = false;

  function onScroll(y) {
    header.classList.toggle("scrolled", y > 40);
    if (!navOpen && y > 500 && y > lastY + 3) header.classList.add("is-hidden");
    else if (y < lastY - 3 || y < 500) header.classList.remove("is-hidden");
    lastY = y;
  }
  window.addEventListener("scroll", () => onScroll(window.scrollY), { passive: true });
  onScroll(window.scrollY);

  const toggle = $(".nav-toggle");
  const setNav = (open) => {
    navOpen = open;
    document.body.classList.toggle("nav-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    header.classList.remove("is-hidden");
    lockScroll(open);
  };
  toggle.addEventListener("click", () => setNav(!navOpen));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && navOpen) setNav(false); });

  // all in-page links scroll smoothly
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute("href");
    if (id === "#") { e.preventDefault(); return; }
    const target = id === "#top" ? 0 : document.querySelector(id);
    if (target === null) return;
    e.preventDefault();
    if (navOpen) setNav(false);
    scrollToTarget(target);
    if (id === "#main" && target) target.setAttribute("tabindex", "-1"), target.focus({ preventScroll: true });
  });
  $("#to-top").addEventListener("click", () => scrollToTarget(0));

  // highlight current section in nav
  const navLinks = $$(".main-nav ul a");
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + entry.target.id));
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  ["about", "menu", "gallery", "reviews", "visit"].forEach((id) => sectionObserver.observe(document.getElementById(id)));

  /* =========================================================
     Menu (tabs with sliding pill, filters, animated panel)
     ========================================================= */
  let activeCat = MENU[0].id;
  const activeFilters = new Set();
  const tabsEl = $("#menu-tabs");
  const panel = $("#menu-panel");
  let shownItems = [];
  let menuNear = false;
  // "Click" on mouse devices, "Tap" on touch screens
  $("#menu-hint [data-i18n]").dataset.i18n = finePointer ? "menu.hintClick" : "menu.hint";

  function renderMenuTabs() {
    tabsEl.innerHTML = `<span class="tab-pill" aria-hidden="true"></span>` + MENU.map((c) => `
      <button type="button" role="tab" class="menu-tab" id="tab-${c.id}" data-cat="${c.id}"
        aria-selected="${c.id === activeCat}" aria-controls="menu-panel" tabindex="${c.id === activeCat ? 0 : -1}">${esc(c.name[lang])}</button>`).join("");
    updateTabPill(false);
  }

  function updateTabPill(animate) {
    const pill = $(".tab-pill", tabsEl);
    const active = $(".menu-tab[aria-selected='true']", tabsEl);
    if (!pill || !active) return;
    const props = { x: active.offsetLeft, y: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight };
    if (hasGSAP) animate && motion ? gsap.to(pill, { ...props, duration: 0.45 }) : gsap.set(pill, props);
    else Object.assign(pill.style, { transform: `translate(${props.x}px,${props.y}px)`, width: props.width + "px", height: props.height + "px" });
  }

  function renderMenu() {
    const cat = MENU.find((c) => c.id === activeCat);
    const items = cat.items.filter((it) => [...activeFilters].every((f) => it.tags.includes(f)));
    shownItems = items;
    if (menuNear) items.forEach(preloadDish);
    panel.setAttribute("aria-labelledby", "tab-" + activeCat);
    panel.innerHTML = items.length ? items.map((it, i) => {
      const [name, desc] = it[lang];
      const tags = it.tags.map((tg) => `<span class="tag tag-${tg}" title="${esc(t("diet." + tg))}">${tg}</span>`).join("");
      return `
        <div class="menu-item" data-idx="${i}">
          <div class="menu-thumb" aria-hidden="true">
            <img src="${IMG(it.img, 200)}" srcset="${IMGSET(it.img, [100, 160, 240])}" sizes="74px" alt="" loading="lazy">
            <span class="thumb-badge"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
          </div>
          <div class="menu-item-main">
            <div class="menu-item-top">
              <h3><button type="button" class="menu-open" aria-haspopup="dialog">${esc(name)}</button>${tags ? ` <span class="tags">${tags}</span>` : ""}</h3>
              <span class="leader" aria-hidden="true"></span>
              <span class="price">${euro(it.price)}</span>
            </div>
            <p>${esc(desc)}</p>
          </div>
          <button type="button" class="add-btn" data-add="${it.id}" aria-label="${esc(t("order.add", { name }))}"><span class="add-icon" aria-hidden="true"></span><span class="add-label"></span></button>
        </div>`;
    }).join("") : `<p class="menu-empty">${esc(t("menu.empty"))}</p>`;
  }

  // old items lift away → panel height glides → new items rise in
  function transitionMenu() {
    if (!motion) { renderMenu(); return; }
    const old = [...panel.children];
    gsap.killTweensOf(old);
    gsap.killTweensOf(panel);
    const startH = panel.offsetHeight;
    gsap.set(panel, { height: startH, overflow: "hidden" });
    gsap.to(old, {
      opacity: 0, y: -10, duration: 0.25, stagger: 0.015, ease: "power2.in",
      onComplete: () => {
        renderMenu();
        const items = [...panel.children];
        gsap.set(panel, { height: "auto" });
        const endH = panel.offsetHeight;
        gsap.fromTo(panel, { height: startH }, { height: endH, duration: 0.5, clearProps: "height,overflow" });
        gsap.fromTo(items, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.03 });
      },
    });
  }

  function selectTab(id) {
    if (id === activeCat) return;
    activeCat = id;
    $$(".menu-tab", tabsEl).forEach((b) => {
      const on = b.dataset.cat === id;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    updateTabPill(true);
    transitionMenu();
  }
  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".menu-tab");
    if (btn) selectTab(btn.dataset.cat);
  });
  tabsEl.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const idx = MENU.findIndex((c) => c.id === activeCat);
    const next = MENU[(idx + (e.key === "ArrowRight" ? 1 : -1) + MENU.length) % MENU.length].id;
    selectTab(next);
    $(`#tab-${next}`).focus();
  });
  $$("#menu-filters .chip").forEach((chip) => chip.addEventListener("click", () => {
    const f = chip.dataset.filter;
    activeFilters.has(f) ? activeFilters.delete(f) : activeFilters.add(f);
    chip.setAttribute("aria-pressed", String(activeFilters.has(f)));
    transitionMenu();
  }));

  /* =========================================================
     Dish details — the photo unveils upward, text rises after it.
     Prev/next (buttons, arrow keys, swipe) walk the dishes currently listed.
     ========================================================= */
  const dish = $("#dish");
  const dishCard = $(".dish-card", dish);
  const dishBackdrop = $(".dish-backdrop", dish);
  const dishMedia = $(".dish-media", dish);
  const dishImg = $("img", dishMedia);
  const dishBody = $(".dish-body", dish);
  const dishParts = [".dish-cat", "#dish-name", ".dish-tags", ".dish-desc", ".dish-plate", ".dish-foot .price"].map((sel) => $(sel, dish));
  const isSheet = () => window.matchMedia("(max-width: 700px)").matches;
  let dishList = [];
  let dishCat = activeCat;
  let dishIdx = 0;
  let dishBusy = false;
  let dishFocus = null;
  let dishUnlock = null;

  // full-size photos load ahead of time (as soon as the menu is near), so the popup opens on a sharp image
  const hiRes = (it) => IMG(it.img, 1100);
  const hiLoads = new Map();
  const loadHi = (it) => {
    if (!hiLoads.has(it.img)) {
      hiLoads.set(it.img, new Promise((resolve) => {
        const im = new Image();
        im.onload = () => im.decode().then(() => resolve(true), () => resolve(true));
        im.onerror = () => resolve(false);
        im.src = hiRes(it);
      }));
    }
    return hiLoads.get(it.img);
  };
  const preloadDish = (it) => { if (it) loadHi(it); };
  const waitAtMost = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(() => r(false), ms))]);

  function fillDish() {
    const it = dishList[dishIdx];
    const [name, short, long] = it[lang];
    $(".dish-cat", dish).textContent = MENU.find((c) => c.id === dishCat).name[lang];
    $("#dish-name").textContent = name;
    $(".dish-tags", dish).innerHTML = it.tags.map((tg) => `<span class="dish-tag"><span class="tag tag-${tg}">${tg}</span>${esc(t("diet." + tg))}</span>`).join("");
    $(".dish-desc", dish).textContent = long;
    $(".dish-plate span", dish).textContent = short;
    $(".dish-foot .price", dish).textContent = euro(it.price);
    $(".dish-count", dish).textContent = `${dishIdx + 1} / ${dishList.length}`;
    $(".dish-nav", dish).hidden = dishList.length < 2;
    dish.dataset.item = it.id;
    dishImg.alt = name;
  }

  // only ever shows the full-size photo; on a slow connection a soft shimmer covers it until it has loaded
  async function setDishImage() {
    const it = dishList[dishIdx];
    const loaded = loadHi(it);
    const ready = await waitAtMost(loaded, 450);
    if (dishList[dishIdx] !== it) return;
    dishImg.src = hiRes(it);
    dishMedia.classList.toggle("is-loading", !ready);
    if (!ready) loaded.then(() => { if (dishList[dishIdx] === it) dishMedia.classList.remove("is-loading"); });
    preloadDish(dishList[(dishIdx + 1) % dishList.length]);
    preloadDish(dishList[(dishIdx - 1 + dishList.length) % dishList.length]);
  }

  async function openDish(i) {
    if (dishBusy || !shownItems[i]) return;
    dishBusy = true;
    dishFocus = document.activeElement;
    dishList = shownItems;
    dishCat = activeCat;
    dishIdx = i;
    fillDish();
    lockScroll(true);
    dish.hidden = false;
    dishCard.scrollTop = dishBody.scrollTop = 0;
    html.classList.add("dish-seen");
    await setDishImage();
    $(".dish-close", dish).focus({ preventScroll: true });
    if (!motion) { dishBusy = false; return; }
    gsap.fromTo(dishBackdrop, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "power2.out" });
    gsap.fromTo(dishCard, isSheet() ? { yPercent: 100 } : { y: 24, opacity: 0 }, { yPercent: 0, y: 0, opacity: 1, duration: 0.5 });
    dishUnlock = gsap.delayedCall(0.3, () => { dishBusy = false; }); // prev/next may interrupt the rest of the entrance
  }

  function closeDish() {
    if (dish.hidden) return;
    const all = [dishCard, dishBackdrop, dishMedia, dishImg, ...dishBody.children, ...dishParts];
    const done = () => {
      dish.hidden = true;
      lockScroll(false);
      if (hasGSAP) gsap.set(all, { clearProps: "all" });
      dishBusy = false;
      dishFocus && dishFocus.focus({ preventScroll: true });
    };
    if (!motion) { done(); return; }
    dishBusy = true;
    if (dishUnlock) dishUnlock.kill();
    gsap.killTweensOf(all);
    gsap.to(dishCard, { ...(isSheet() ? { yPercent: 100 } : { y: 16, opacity: 0 }), duration: 0.3, ease: "power2.in" });
    gsap.to(dishBackdrop, { opacity: 0, duration: 0.3, delay: 0.05, ease: "power2.in", onComplete: done });
  }

  function stepDish(d) {
    if (dishBusy || dish.hidden || dishList.length < 2) return;
    const next = (dishIdx + d + dishList.length) % dishList.length;
    if (!motion) { dishIdx = next; fillDish(); setDishImage(); return; }
    dishBusy = true;
    gsap.killTweensOf([dishImg, ...dishParts]);
    gsap.to(dishImg, { opacity: 0, duration: 0.2, ease: "power2.in" });
    gsap.to(dishParts, {
      opacity: 0, duration: 0.2, ease: "power2.in",
      onComplete: async () => {
        dishIdx = next;
        fillDish();
        dishCard.scrollTop = dishBody.scrollTop = 0;
        await setDishImage();
        gsap.fromTo(dishImg, { opacity: 0 }, { opacity: 1, duration: 0.4 });
        gsap.fromTo(dishParts, { opacity: 0, x: 12 * d }, { opacity: 1, x: 0, duration: 0.4, stagger: 0.02 });
        dishBusy = false; // the next step may interrupt the fade-in
      },
    });
  }

  panel.addEventListener("click", (e) => {
    if (e.target.closest("[data-add]")) return; // "add to order" is handled by ordering/ordering.mjs
    const item = e.target.closest(".menu-item");
    if (item) openDish(+item.dataset.idx);
  });
  new IntersectionObserver((entries, obs) => {
    if (!entries[0].isIntersecting) return;
    menuNear = true;
    shownItems.forEach(preloadDish);
    obs.disconnect();
  }, { rootMargin: "700px 0px" }).observe(panel);
  panel.addEventListener("pointerover", (e) => {
    const item = e.target.closest(".menu-item");
    if (item) preloadDish(shownItems[+item.dataset.idx]);
  });
  $(".dish-close", dish).addEventListener("click", closeDish);
  dishBackdrop.addEventListener("click", closeDish);
  $(".dish-prev", dish).addEventListener("click", () => stepDish(-1));
  $(".dish-next", dish).addEventListener("click", () => stepDish(1));
  document.addEventListener("keydown", (e) => {
    if (dish.hidden) return;
    if (e.key === "Escape") closeDish();
    if (e.key === "ArrowLeft") stepDish(-1);
    if (e.key === "ArrowRight") stepDish(1);
  });
  let dishTouchX = null;
  dishMedia.addEventListener("touchstart", (e) => { dishTouchX = e.touches[0].clientX; }, { passive: true });
  dishMedia.addEventListener("touchend", (e) => {
    if (dishTouchX === null) return;
    const dx = e.changedTouches[0].clientX - dishTouchX;
    if (Math.abs(dx) > 50) stepDish(dx < 0 ? 1 : -1);
    dishTouchX = null;
  });

  /* =========================================================
     Gallery + lightbox (image flies from its thumbnail)
     ========================================================= */
  function renderGallery() {
    $("#gallery-grid").innerHTML = GALLERY.map((g, i) => `
      <button type="button" class="gallery-item" data-index="${i}" aria-label="${esc(g[lang])}">
        <img src="${IMG(g.id, 800)}" srcset="${IMGSET(g.id, [400, 800, 1200, 1600])}" sizes="${i === 0 ? "(max-width: 900px) 100vw, 50vw" : "(max-width: 900px) 50vw, 25vw"}" alt="${esc(g[lang])}" loading="lazy">
      </button>`).join("");
  }

  const lb = $("#lightbox");
  const lbBackdrop = $(".lb-backdrop", lb);
  const lbFrame = $(".lb-frame", lb);
  const lbImg = $("img", lb);
  const lbCap = $("figcaption", lb);
  const lbUi = $$(".lb-close, .lb-nav, figcaption", lb);
  let lbIndex = 0;
  let lbBusy = false;
  let lastFocus = null;

  const thumbOf = (i) => $(`.gallery-item[data-index="${i}"]`);

  async function setLbImage(i) {
    lbIndex = (i + GALLERY.length) % GALLERY.length;
    const g = GALLERY[lbIndex];
    lbImg.src = thumbOf(lbIndex)?.querySelector("img")?.currentSrc || IMG(g.id, 800); // already cached from the grid → instant
    lbImg.alt = g[lang];
    lbCap.textContent = `${g[lang]}  ·  ${lbIndex + 1} / ${GALLERY.length}`;
    try { await lbImg.decode(); } catch { /* ignore */ }
    const hi = new Image();
    hi.src = IMG(g.id, Math.min(2400, Math.round(1200 * (window.devicePixelRatio || 1))));
    hi.onload = () => { if (lbIndex === GALLERY.indexOf(g)) lbImg.src = hi.src; };
  }

  // transform + clip that make the full image sit exactly on top of a (cropped) thumbnail
  function flipFrom(thumbRect) {
    const to = lbFrame.getBoundingClientRect();
    const s = Math.max(thumbRect.width / to.width, thumbRect.height / to.height);
    const ix = (to.width - thumbRect.width / s) / 2;
    const iy = (to.height - thumbRect.height / s) / 2;
    return {
      x: thumbRect.left + thumbRect.width / 2 - (to.left + (to.width * s) / 2),
      y: thumbRect.top + thumbRect.height / 2 - (to.top + (to.height * s) / 2),
      scale: s,
      clipPath: `inset(${iy}px ${ix}px ${iy}px ${ix}px round ${12 / s}px)`,
    };
  }
  const visibleRect = (el) => { const r = el && el.getBoundingClientRect(); return r && r.bottom > 0 && r.top < innerHeight ? r : null; };

  async function openLb(i) {
    if (lbBusy) return;
    lbBusy = true;
    lastFocus = document.activeElement;
    lockScroll(true);
    lb.hidden = false;
    await setLbImage(i);
    $(".lb-close", lb).focus({ preventScroll: true });
    if (!motion) { lbBusy = false; return; }
    const r = visibleRect(thumbOf(lbIndex));
    gsap.set(lbFrame, { transformOrigin: "0 0" });
    gsap.fromTo(lbBackdrop, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" });
    gsap.fromTo(lbUi, { opacity: 0 }, { opacity: 1, duration: 0.4, delay: 0.3 });
    const from = r ? flipFrom(r) : { scale: 0.9, opacity: 0, clipPath: "inset(0px 0px 0px 0px round 10px)" };
    gsap.fromTo(lbFrame, from, {
      x: 0, y: 0, scale: 1, opacity: 1, clipPath: "inset(0px 0px 0px 0px round 10px)",
      duration: 0.6, ease: "power3.inOut", onComplete: () => { lbBusy = false; },
    });
  }

  function closeLb() {
    if (lb.hidden) return;
    const done = () => {
      lb.hidden = true;
      lockScroll(false);
      if (hasGSAP) gsap.set([lbFrame, lbBackdrop, ...lbUi], { clearProps: "all" });
      lbBusy = false;
      lastFocus && lastFocus.focus({ preventScroll: true });
    };
    if (!motion) { done(); return; }
    lbBusy = true;
    const r = visibleRect(thumbOf(lbIndex));
    gsap.to(lbUi, { opacity: 0, duration: 0.2 });
    gsap.to(lbBackdrop, { opacity: 0, duration: 0.45, delay: 0.1, ease: "power2.inOut" });
    gsap.to(lbFrame, { ...(r ? flipFrom(r) : { scale: 0.9, opacity: 0 }), duration: 0.5, ease: "power3.inOut", onComplete: done });
  }

  function stepLb(d) {
    if (lbBusy) return;
    if (!motion) { setLbImage(lbIndex + d); return; }
    lbBusy = true;
    gsap.to([lbFrame, lbCap], {
      x: -30 * d, opacity: 0, duration: 0.25, ease: "power2.in",
      onComplete: async () => {
        await setLbImage(lbIndex + d);
        gsap.fromTo([lbFrame, lbCap], { x: 30 * d, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, stagger: 0.04, onComplete: () => { lbBusy = false; } });
      },
    });
  }

  $("#gallery-grid").addEventListener("click", (e) => {
    const item = e.target.closest(".gallery-item");
    if (item) openLb(+item.dataset.index);
  });
  $(".lb-close", lb).addEventListener("click", closeLb);
  $(".lb-prev", lb).addEventListener("click", () => stepLb(-1));
  $(".lb-next", lb).addEventListener("click", () => stepLb(1));
  lbBackdrop.addEventListener("click", closeLb);
  document.addEventListener("keydown", (e) => {
    if (lb.hidden) return;
    if (e.key === "Escape") closeLb();
    if (e.key === "ArrowLeft") stepLb(-1);
    if (e.key === "ArrowRight") stepLb(1);
  });
  let touchX = null;
  lb.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) stepLb(dx < 0 ? 1 : -1);
    touchX = null;
  });

  /* =========================================================
     Reviews — one at a time, with a short crossfade between them
     ========================================================= */
  const stage = $("#review-stage");
  const rCurrent = $("#review-current");
  const rProgressEl = $("#review-progress");
  let rIdx = 0;
  let rTl = null;
  let rAuto = null;
  let rInView = false;
  let rHover = false;
  const pad = (n) => String(n).padStart(2, "0");

  function renderReviews() {
    if (rTl) rTl.progress(1).kill();
    stage.innerHTML = REVIEWS.map((r, i) => `
      <figure class="review${i === rIdx ? " is-active" : ""}" aria-hidden="${i !== rIdx}">
        <span class="stars" aria-label="5 stars">★★★★★</span>
        <blockquote>${esc(r[lang])}</blockquote>
        <figcaption class="review-author">
          <span class="avatar" aria-hidden="true">${r.name.split(" ").map((w) => w[0]).join("")}</span>
          <span><strong>${esc(r.name)}</strong><span class="meta">${esc(r.meta[lang])}</span></span>
        </figcaption>
      </figure>`).join("");
    rCurrent.textContent = pad(rIdx + 1);
    $("#review-total").textContent = pad(REVIEWS.length);
  }

  function goReview(to, dir) {
    const next = (to + REVIEWS.length) % REVIEWS.length;
    if (next === rIdx) return;
    if (rTl) rTl.progress(1).kill();
    const slides = $$(".review", stage);
    const out = slides[rIdx];
    const inn = slides[next];
    rIdx = next;
    out.setAttribute("aria-hidden", "true");
    inn.setAttribute("aria-hidden", "false");
    rCurrent.textContent = pad(rIdx + 1);

    if (!motion) {
      out.classList.remove("is-active");
      inn.classList.add("is-active");
      return;
    }

    inn.classList.add("is-active");
    rTl = gsap.timeline({ onComplete: () => { out.classList.remove("is-active"); gsap.set([out, inn], { clearProps: "all" }); } });
    rTl
      .to(out, { opacity: 0, x: -16 * dir, duration: 0.3, ease: "power2.in" }, 0)
      .fromTo(inn, { opacity: 0, x: 16 * dir }, { opacity: 1, x: 0, duration: 0.5 }, 0.2);

    restartAuto();
  }

  function restartAuto() {
    if (rAuto) rAuto.kill();
    if (!motion) return;
    rAuto = gsap.fromTo(rProgressEl, { scaleX: 0 }, { scaleX: 1, duration: 7, ease: "none", paused: !(rInView && !rHover), onComplete: () => goReview(rIdx + 1, 1) });
  }
  const syncAuto = () => { if (rAuto) (rInView && !rHover) ? rAuto.play() : rAuto.pause(); };

  $("#review-prev").addEventListener("click", () => goReview(rIdx - 1, -1));
  $("#review-next").addEventListener("click", () => goReview(rIdx + 1, 1));
  const slider = $(".review-slider");
  slider.addEventListener("mouseenter", () => { rHover = true; syncAuto(); });
  slider.addEventListener("mouseleave", () => { rHover = false; syncAuto(); });
  slider.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") goReview(rIdx - 1, -1);
    if (e.key === "ArrowRight") goReview(rIdx + 1, 1);
  });
  let rTouch = null;
  slider.addEventListener("touchstart", (e) => { rTouch = e.touches[0].clientX; }, { passive: true });
  slider.addEventListener("touchend", (e) => {
    if (rTouch === null) return;
    const dx = e.changedTouches[0].clientX - rTouch;
    if (Math.abs(dx) > 50) dx < 0 ? goReview(rIdx + 1, 1) : goReview(rIdx - 1, -1);
    rTouch = null;
  });

  /* =========================================================
     Reservation form
     ========================================================= */
  const form = $("#reserve-form");
  const dateInput = $("#r-date");
  const timeSelect = $("#r-time");
  const guestSelect = $("#r-guests");

  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 60);
  dateInput.min = isoDate(new Date());
  dateInput.max = isoDate(maxDate);

  function fillGuests() {
    const current = guestSelect.value || "2";
    guestSelect.innerHTML = Array.from({ length: 10 }, (_, i) => i + 1)
      .map((n) => `<option value="${n}">${n} ${n === 1 ? t("form.guest") : t("form.guestsPl")}</option>`).join("");
    guestSelect.value = current;
  }

  function fillTimes() {
    const current = timeSelect.value;
    const slots = [];
    if (dateInput.value) {
      const d = new Date(dateInput.value + "T00:00");
      const [open, close] = HOURS[d.getDay()];
      const isToday = dateInput.value === isoDate(new Date());
      const earliest = cyprusNow().minutes + 30; // 30 minutes notice
      for (let m = toMin(open); m <= toMin(close) - 60; m += 30) {
        if (isToday && m < earliest) continue;
        slots.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
      }
    }
    timeSelect.innerHTML = `<option value="">${t("form.selectTime")}</option>` + slots.map((s) => `<option>${s}</option>`).join("");
    if (slots.includes(current)) timeSelect.value = current;
  }
  dateInput.addEventListener("change", fillTimes);

  const validators = {
    name: (v) => v.trim().length >= 2,
    phone: (v) => /^[+0-9 ()-]{8,}$/.test(v.trim()),
    email: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    date: (v) => !!v && v >= dateInput.min && v <= dateInput.max,
    time: (v) => !!v,
  };
  const validateField = (input) => {
    const fn = validators[input.name];
    if (!fn) return true;
    const ok = fn(input.value);
    input.closest(".field").classList.toggle("invalid", !ok);
    input.setAttribute("aria-invalid", String(!ok));
    return ok;
  };
  $$("input, select", form).forEach((el) => {
    el.addEventListener("blur", () => { if (el.value) validateField(el); });
    el.addEventListener("input", () => { if (el.closest(".field").classList.contains("invalid")) validateField(el); });
  });

  const modal = $("#booking-modal");
  const modalCard = $(".modal-card", modal);
  const modalBackdrop = $(".modal-backdrop", modal);

  function openModal() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    lockScroll(true);
    $("#modal-close").focus({ preventScroll: true });
    if (!motion) return;
    gsap.fromTo(modalBackdrop, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" });
    gsap.fromTo(modalCard, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.45 });
    gsap.fromTo(".modal-check path", { strokeDasharray: 40, strokeDashoffset: 40 }, { strokeDashoffset: 0, duration: 0.5, delay: 0.25, ease: "power2.out" });
  }
  function closeModal() {
    if (modal.hidden) return;
    const done = () => { modal.hidden = true; lockScroll(false); lastFocus && lastFocus.focus({ preventScroll: true }); };
    if (!motion) { done(); return; }
    gsap.to(modalCard, { opacity: 0, y: 12, duration: 0.25, ease: "power2.in" });
    gsap.to(modalBackdrop, { opacity: 0, duration: 0.3, delay: 0.05, ease: "power2.in", onComplete: done });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fields = $$("input, select", form);
    const results = fields.map(validateField);
    const firstBad = fields[results.indexOf(false)];
    if (firstBad) {
      firstBad.focus();
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    const dateStr = new Date(data.date + "T00:00").toLocaleDateString(lang === "el" ? "el-GR" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
    const guests = `${data.guests} ${+data.guests === 1 ? t("form.guest") : t("form.guestsPl")}`;
    $("#modal-text").textContent = t("modal.text", { name: data.name.trim().split(" ")[0], guests, date: dateStr, time: data.time });
    openModal();
    form.reset();
    fillGuests();
    fillTimes();
  });
  $("#modal-close").addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  /* ---------- Newsletter ---------- */
  $("#newsletter").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#nl-email");
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value);
    const msg = $("#nl-msg");
    msg.textContent = ok ? t("footer.nlOk") : t("footer.nlErr");
    if (ok) input.value = "";
  });

  /* =========================================================
     Designer contact panel ("Want a site like this?")
     ========================================================= */
  const hire = $("#hire-panel");
  const hireCard = $(".hire-card", hire);
  const hireBackdrop = $(".hire-backdrop", hire);

  function updateHireLinks() {
    $("#hire-email").href = "mailto:aristidiskamaritis@gmail.com?subject=" + encodeURIComponent(t("hire.emailSubject"));
  }

  function openHire() {
    if (!hire.hidden) return;
    lastFocus = document.activeElement;
    hire.hidden = false;
    document.body.classList.add("hire-open");
    lockScroll(true);
    $(".hire-close", hire).focus({ preventScroll: true });
    if (!motion) return;
    gsap.killTweensOf([hireCard, hireBackdrop]);
    gsap.fromTo(hireBackdrop, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" });
    gsap.fromTo(hireCard, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.45 });
  }
  function closeHire() {
    if (hire.hidden) return;
    const done = () => {
      hire.hidden = true;
      document.body.classList.remove("hire-open");
      lockScroll(false);
      lastFocus && lastFocus.focus({ preventScroll: true });
    };
    if (!motion) { done(); return; }
    gsap.to(hireCard, { opacity: 0, y: 16, duration: 0.25, ease: "power2.in" });
    gsap.to(hireBackdrop, { opacity: 0, duration: 0.3, delay: 0.05, ease: "power2.in", onComplete: done });
  }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-hire]")) openHire(); });
  $(".hire-close", hire).addEventListener("click", closeHire);
  hireBackdrop.addEventListener("click", closeHire);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeHire(); });

  /* =========================================================
     Scroll animations: short fades, nothing that holds content back
     ========================================================= */
  function setupScrollAnimations() {
    const fadeIn = (targets, trigger, vars = {}) =>
      gsap.from(targets, { opacity: 0, y: 20, duration: 0.8, ...vars, scrollTrigger: { trigger, start: "top 90%", once: true } });

    $$("[data-split]:not(.hero-title), [data-anim='fade']").forEach((el) => fadeIn(el, el));
    $$("[data-anim='rise']").forEach((el) => fadeIn(el, el, { y: 30 }));
    $$("[data-anim='stagger']").forEach((el) => fadeIn(el.children, el, { stagger: 0.08 }));

    $$(".img-reveal").forEach((el) => {
      const img = $("img", el);
      gsap.from(img || el, { opacity: 0, scale: img ? 1.04 : 1, duration: 1, ease: "power2.out", scrollTrigger: { trigger: el, start: "top 92%", once: true } });
    });

    ScrollTrigger.create({
      trigger: "#gallery-grid", start: "top 88%", once: true,
      onEnter: () => gsap.from(".gallery-item", { opacity: 0, y: 16, duration: 0.7, stagger: 0.05 }),
    });

    // a little depth on the about photos and the hero copy as you scroll away
    $$("[data-speed]").forEach((el) => {
      const s = parseFloat(el.dataset.speed);
      gsap.fromTo(el, { y: -s * 4 }, { y: s * 4, ease: "none", scrollTrigger: { trigger: el.closest("section"), start: "top bottom", end: "bottom top", scrub: true } });
    });
    gsap.to(".hero-content", { y: -80, opacity: 0, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom 15%", scrub: true } });

    // reviews autoplay only while visible
    ScrollTrigger.create({ trigger: ".review-slider", start: "top 85%", end: "bottom 15%", onToggle: (self) => { rInView = self.isActive; syncAuto(); } });

    window.addEventListener("load", () => ScrollTrigger.refresh());
  }

  /* =========================================================
     Init
     ========================================================= */
  $("#year").textContent = new Date().getFullYear();

  applyLanguage();
  moveLangPill(false);
  restartAuto();

  if (motion) {
    // Build the triggers at the top of the page, then return to where the browser restored us
    // (reload / #menu link). One-time triggers that fire while being created break ScrollTrigger.
    const startY = window.scrollY;
    window.scrollTo(0, 0);
    setupScrollAnimations();
    window.scrollTo(0, startY);
    ScrollTrigger.update();
  }
  const fontsReady = document.fonts ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
  fontsReady.then(() => {
    updateTabPill(false);
    moveLangPill(false);
    if (motion) ScrollTrigger.refresh();
  });

  window.addEventListener("resize", () => {
    updateTabPill(false);
    moveLangPill(false);
  });

  // The floating "Want a site like this?" button steps aside while the hero or footer
  // (which both carry the same link) is on screen, so it never covers content there
  if ("IntersectionObserver" in window) {
    const fabAway = new Set();
    const fabIo = new IntersectionObserver((entries) => {
      entries.forEach((en) => (en.isIntersecting ? fabAway.add(en.target) : fabAway.delete(en.target)));
      document.body.classList.toggle("fab-away", fabAway.size > 0);
    }, { threshold: 0.12 });
    [$(".hero"), $(".site-footer")].forEach((el) => el && fabIo.observe(el));
  }

  setInterval(renderStatus, 60 * 1000);
})();

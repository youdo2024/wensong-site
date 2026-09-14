"use client";
import { useEffect } from "react";

/* 文章動態層：捲動進場時，讓段落／標題／圖表區塊淡入，數字往上跳、長條圖長出來、進度環填滿。
   初始隱藏的樣式都掛在 .js-fx（layout 內聯腳本）底下，
   無 JS 或使用者設定「減少動態」時，內容一律完整顯示（不藏字，SEO 與可讀性不受影響）。 */
export default function ArticleBlocksFx() {
  useEffect(() => {
    /* 告訴 layout 的保險腳本「動畫層有跑起來」，它就不會把 js-fx 拿掉 */
    document.documentElement.classList.add("fx-ready");
    const root = document.querySelector<HTMLElement>("article.post .post-body");
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function countUp(el: HTMLElement, dur = 1100) {
      const target = Number(el.getAttribute("data-count"));
      if (!isFinite(target)) return;
      const prefix = el.getAttribute("data-prefix") || "";
      const suffix = el.getAttribute("data-suffix") || "";
      const dec = Number(el.getAttribute("data-dec")) || 0;
      const t0 = performance.now();
      const fmt = (v: number) =>
        dec > 0
          ? v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })
          : Math.round(v).toLocaleString();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - t, 3);
        el.textContent = prefix + fmt(target * e) + suffix;
        if (t < 1) requestAnimationFrame(step);
        else el.classList.add("num-done"); // 跳完輕輕彈一下
      };
      requestAnimationFrame(step);
    }

    function fillRing(ring: HTMLElement, dur = 1100) {
      const p = Number(getComputedStyle(ring).getPropertyValue("--p")) || 0;
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - t, 3);
        ring.style.setProperty("--pnow", String(p * e));
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    /* 金句打字機：捲到時逐字打出（結束移除游標） */
    function typeText(el: HTMLElement) {
      const full = el.textContent || "";
      if (!full) return;
      el.textContent = "";
      el.classList.add("typing");
      let i = 0;
      const tick = () => {
        i++;
        el.textContent = full.slice(0, i);
        if (i < full.length) setTimeout(tick, 34);
        else el.classList.remove("typing");
      };
      setTimeout(tick, 200);
    }

    function activate(block: HTMLElement) {
      block.classList.add("rv-in");
      if (reduce) {
        const ring = block.querySelector<HTMLElement>(".yb-ring");
        if (ring) ring.style.setProperty("--pnow", getComputedStyle(ring).getPropertyValue("--p") || "0");
        return; // 數字已是最終值，不做跳動
      }
      block.querySelectorAll<HTMLElement>("[data-count]").forEach((n) => countUp(n));
      const ring = block.querySelector<HTMLElement>(".yb-ring");
      if (ring) fillRing(ring);
      if (block.classList.contains("yb-quote")) {
        const q = block.querySelector<HTMLElement>(".yb-quote-text");
        if (q) typeText(q);
      }
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          io.unobserve(el);
          /* 保險那條路可能已經先打開它了，這裡就不要再跑一次打字機與數字跳動 */
          if (el.classList.contains("rv-in")) continue;
          el.classList.add("rv-in");
          if (el.classList.contains("yb-block")) activate(el);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    const vh = window.innerHeight;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(".yb-block"));
    const texts = Array.from(
      root.querySelectorAll<HTMLElement>("h2,h3,blockquote,figure,p,ul,ol")
    ).filter((el) => !el.closest(".yb-block"));

    // 圖表區塊：畫面內的等下一畫格再啟動（開頁也看得到進場動畫），畫面外的進場再動
    blocks.forEach((b) => {
      if (reduce) { activate(b); return; }
      b.classList.add("rv-arm");
      if (b.getBoundingClientRect().top < vh * 0.88) {
        requestAnimationFrame(() => requestAnimationFrame(() => activate(b)));
      } else {
        io.observe(b);
      }
    });

    /*
     * 保險：IntersectionObserver 偶爾不會觸發（站長 2026-09-06 回報文末的金句與店家
     * 資訊卡是空白的，元素在、字卻沒亮）。捲動時自己再檢查一次，只要進到畫面就打開，
     * 全部打開後把監聽拿掉。動畫照常，只是多一條退路。
     */
    const sweep = () => {
      let left = 0;
      for (const b of blocks) {
        if (b.classList.contains("rv-in")) continue;
        if (b.getBoundingClientRect().top < window.innerHeight * 0.95) { activate(b); continue; }
        left++;
      }
      if (left === 0) window.removeEventListener("scroll", sweep);
    };
    window.addEventListener("scroll", sweep, { passive: true });

    // 內文：只對「畫面外」的元素掛淡入（避免載入瞬間閃爍，畫面內的維持原樣）。
    // post-body 前六個直屬元素由「開頁瀑布」CSS 動畫負責，這裡跳過以免動畫打架
    const waterfall = new Set(Array.from(root.children).slice(0, 6));
    if (!reduce) {
      texts.forEach((el) => {
        if (waterfall.has(el)) return;
        if (el.getBoundingClientRect().top < vh * 0.88) return;
        el.classList.add("rv-arm");
        io.observe(el);
      });
    }

    /* ── 互動層：翻卡／問答／展開（div 元件，補上鍵盤可及性） ── */
    root
      .querySelectorAll<HTMLElement>(".yb-flip,.yb-quiz-opt,.yb-fold-btn")
      .forEach((el) => {
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "button");
      });

    function interact(target: HTMLElement) {
      const flip = target.closest<HTMLElement>(".yb-flip");
      if (flip) { flip.classList.toggle("on"); return; }

      const foldBtn = target.closest<HTMLElement>(".yb-fold-btn");
      if (foldBtn) { foldBtn.closest(".yb-fold")?.classList.toggle("open"); return; }

      const opt = target.closest<HTMLElement>(".yb-quiz-opt");
      if (opt) {
        const quiz = opt.closest<HTMLElement>(".yb-quiz");
        if (!quiz || quiz.classList.contains("done")) return;
        quiz.classList.add("done");
        opt.classList.add("pick", opt.dataset.correct === "1" ? "right" : "wrong");
        if (opt.dataset.correct !== "1") {
          quiz.querySelector<HTMLElement>('.yb-quiz-opt[data-correct="1"]')?.classList.add("right");
        }
        quiz.querySelector(".yb-quiz-exp")?.classList.add("show");
      }
    }
    const onClick = (e: MouseEvent) => interact(e.target as HTMLElement);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target as HTMLElement;
      if (t.closest(".yb-flip,.yb-quiz-opt,.yb-fold-btn")) { e.preventDefault(); interact(t); }
    };
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKey);

    /* ── 圖片燈箱：點內文圖片放大（連結內的圖不劫持），再點或 Esc 關閉 ── */
    const onImgClick = (e: MouseEvent) => {
      const img = (e.target as HTMLElement).closest?.("img");
      if (!img || !root.contains(img) || img.closest("a")) return;
      const box = document.createElement("div");
      box.className = "yb-lightbox";
      const big = document.createElement("img");
      big.src = (img as HTMLImageElement).src;
      big.alt = (img as HTMLImageElement).alt || "";
      box.appendChild(big);
      const close = () => { box.remove(); document.removeEventListener("keydown", onEsc); };
      const onEsc = (ke: KeyboardEvent) => { if (ke.key === "Escape") close(); };
      box.addEventListener("click", close);
      document.addEventListener("keydown", onEsc);
      document.body.appendChild(box);
    };
    root.addEventListener("click", onImgClick);

    /* ── 滑桿比對：拖曳（或觸控）移動分界線 ── */
    const dragCleanups: (() => void)[] = [];
    root.querySelectorAll<HTMLElement>(".yb-slide-stage").forEach((stage) => {
      const move = (clientX: number) => {
        const r = stage.getBoundingClientRect();
        const pct = Math.max(4, Math.min(96, ((clientX - r.left) / r.width) * 100));
        stage.style.setProperty("--x", `${pct}%`);
      };
      let dragging = false;
      const down = (e: PointerEvent) => { dragging = true; stage.setPointerCapture(e.pointerId); move(e.clientX); };
      const mv = (e: PointerEvent) => { if (dragging) { e.preventDefault(); move(e.clientX); } };
      const up = () => { dragging = false; };
      stage.addEventListener("pointerdown", down);
      stage.addEventListener("pointermove", mv);
      stage.addEventListener("pointerup", up);
      stage.addEventListener("pointercancel", up);
      dragCleanups.push(() => { stage.removeEventListener("pointerdown", down); stage.removeEventListener("pointermove", mv); stage.removeEventListener("pointerup", up); stage.removeEventListener("pointercancel", up); });
    });

    /* ── 刮刮樂：蓋一層牛皮紙 canvas，刮除過半自動掀開 ── */
    root.querySelectorAll<HTMLElement>(".yb-scratch-area").forEach((area) => {
      if (area.querySelector("canvas")) return;
      const setup = () => {
        if (area.querySelector("canvas")) return;
        const w = area.clientWidth, h = area.clientHeight;
        if (w < 40 || !h) return; // 版面還沒有真實尺寸（例如分頁在背景）就先不畫
        const cv = document.createElement("canvas");
        cv.className = "yb-scratch-cv";
        cv.width = w * 2; cv.height = h * 2;
        const ctx = cv.getContext("2d");
        if (!ctx) return;
        ctx.scale(2, 2);
        ctx.fillStyle = "#E3D3AC";
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 60; i++) { /* 紙纖維雜點 */
          ctx.fillStyle = i % 2 ? "rgba(58,50,38,.05)" : "rgba(255,253,246,.5)";
          ctx.fillRect(Math.random() * w, Math.random() * h, Math.random() * 26, 1.2);
        }
        ctx.fillStyle = "#7C7060";
        ctx.font = "13px 'Noto Serif TC', serif";
        ctx.textAlign = "center";
        ctx.fillText("刮 開 牛 皮 紙 看 答 案", w / 2, h / 2 + 4);
        area.appendChild(cv);
        let strokes = 0;
        const scratch = (e: PointerEvent) => {
          if (e.buttons === 0 && e.pointerType === "mouse") return;
          const r = cv.getBoundingClientRect();
          ctx.globalCompositeOperation = "destination-out";
          ctx.beginPath();
          ctx.arc(e.clientX - r.left, e.clientY - r.top, 22, 0, Math.PI * 2);
          ctx.fill();
          if (++strokes % 12 === 0) { /* 每 12 筆抽樣一次刮除比例 */
            const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
            let clear = 0;
            for (let i = 3; i < d.length; i += 160) { if (d[i] === 0) clear++; }
            if (clear / (d.length / 160) > 0.45) area.classList.add("done");
          }
        };
        cv.addEventListener("pointermove", scratch);
        cv.addEventListener("pointerdown", scratch);
      };
      if (reduce) { area.classList.add("done"); return; }
      /* 拿得到尺寸才畫刮層；分頁在背景、字體晚載入等情況由 ResizeObserver 補跑 */
      const ro = new ResizeObserver(() => setup());
      ro.observe(area);
      requestAnimationFrame(setup);
      dragCleanups.push(() => ro.disconnect());
    });

    /* ── 投票：投一票→顯示全站統計；投過的（localStorage）載入時直接顯示結果 ── */
    function paintPoll(poll: HTMLElement, cts: number[], mine: number) {
      const total = cts.reduce((a, b) => a + b, 0) || 1;
      poll.classList.add("done");
      poll.querySelectorAll<HTMLElement>(".yb-poll-opt").forEach((o, i) => {
        const pct = Math.round(((cts[i] || 0) / total) * 100);
        o.querySelector<HTMLElement>(".yb-poll-fill")?.style.setProperty("--w", `${pct}%`);
        const pctEl = o.querySelector<HTMLElement>(".yb-poll-pct");
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (i === mine) o.classList.add("mine");
      });
    }
    root.querySelectorAll<HTMLElement>(".yb-poll").forEach((poll) => {
      const key = poll.dataset.poll || "";
      if (!key) return;
      const saved = localStorage.getItem(`yb-poll:${key}`);
      if (saved !== null) {
        fetch(`/api/poll?key=${encodeURIComponent(key)}`).then((r) => r.json()).then((d) => paintPoll(poll, d.counts || [], Number(saved))).catch(() => {});
      }
    });
    const onPollClick = (e: MouseEvent) => {
      const opt = (e.target as HTMLElement).closest<HTMLElement>(".yb-poll-opt");
      if (!opt) return;
      const poll = opt.closest<HTMLElement>(".yb-poll");
      if (!poll || poll.classList.contains("done")) return;
      const key = poll.dataset.poll || "";
      const idx = Number(opt.dataset.opt);
      poll.classList.add("done"); // 先鎖住避免連點
      fetch("/api/poll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, opt: idx }) })
        .then((r) => r.json())
        .then((d) => { localStorage.setItem(`yb-poll:${key}`, String(idx)); paintPoll(poll, d.counts || [], idx); })
        .catch(() => poll.classList.remove("done"));
    };
    root.addEventListener("click", onPollClick);

    /* ── 卡片 3D 微傾：滑鼠掃過數字卡／重點卡輕微立體傾斜（桌機、非減少動態） ── */
    const tiltOK = !reduce && window.matchMedia("(hover:hover)").matches;
    const onTilt = (e: MouseEvent) => {
      if (!tiltOK) return;
      const card = (e.target as HTMLElement).closest<HTMLElement>(".yb-stat-card,.yb-card");
      if (!card) return;
      const r = card.getBoundingClientRect();
      const rx = ((e.clientY - r.top) / r.height - 0.5) * -7;
      const ry = ((e.clientX - r.left) / r.width - 0.5) * 7;
      card.style.transform = `perspective(600px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-2px)`;
    };
    const onTiltOut = (e: MouseEvent) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".yb-stat-card,.yb-card");
      if (card) card.style.transform = "";
    };
    root.addEventListener("mousemove", onTilt);
    root.addEventListener("mouseout", onTiltOut);

    /* ══ TW5304 綠蠵龜互動（文章含 .tw-art 才綁；SVG 由這裡注入，消毒器不放行 svg 標籤） ══ */
    const twCleanups: Array<() => void> = [];
    if (root.querySelector(".tw-art")) {
      const NS = "http://www.w3.org/2000/svg";
      const TURT_SVG = `<svg viewBox="0 0 40 30" aria-hidden="true"><ellipse cx="20" cy="15" rx="12" ry="9" fill="none" stroke="#2C4A6B" stroke-width="1.6"/><circle cx="33" cy="15" r="4" fill="none" stroke="#2C4A6B" stroke-width="1.6"/><path d="M10 8 Q3 3 1 8 M10 22 Q3 27 1 22" fill="none" stroke="#2C4A6B" stroke-width="1.4"/></svg>`;
      const DOG_SVG = `<svg viewBox="0 0 30 24" aria-hidden="true"><path d="M4 16 L4 9 Q4 6 8 6 L17 6 Q21 6 22 9 L26 8 L24 13 L24 18" fill="none" stroke="#A33B2A" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 18 L7 21 M12 18 L12 21 M19 18 L19 21" stroke="#A33B2A" stroke-width="1.6"/><circle cx="25" cy="10" r=".9" fill="#A33B2A"/></svg>`;

      /* 千點存活：一千個點淡出，只留一個 */
      const dotsBox = root.querySelector<HTMLElement>(".tw-dots");
      if (dotsBox && !dotsBox.childElementCount) {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < 1000; i++) frag.appendChild(document.createElement("i"));
        dotsBox.appendChild(frag);
      }
      const dotSay = root.querySelector<HTMLElement>('[data-tw="dotsay"]');
      const runDots = () => {
        if (!dotsBox) return;
        const cells = Array.from(dotsBox.children) as HTMLElement[];
        cells.forEach((c) => (c.className = ""));
        if (dotSay) dotSay.textContent = "一千隻小海龜同時朝海裡爬……";
        const keep = cells[437];
        let idx = 0;
        const finish = () => {
          keep?.classList.add("on");
          if (dotSay) dotSay.textContent = "常被引用的估計是，一千隻小海龜裡大約只有 1 隻能長到成年。TW5304 是那一隻。";
        };
        if (reduce) { cells.forEach((c) => { if (c !== keep) c.classList.add("gone"); }); finish(); return; }
        const step = () => {
          for (let k = 0; k < 40 && idx < cells.length; k++, idx++) if (cells[idx] !== keep) cells[idx].classList.add("gone");
          if (idx < cells.length) requestAnimationFrame(step);
          else finish();
        };
        step();
      };

      /* 沙溫：溫度晶片 → 40 顆蛋的雌雄比例（紅＝雌、靛＝雄；轉折帶約 29°C） */
      const hatchBox = root.querySelector<HTMLElement>(".tw-hatch");
      if (hatchBox && !hatchBox.childElementCount) {
        for (let i = 0; i < 40; i++) hatchBox.appendChild(document.createElement("b"));
      }
      const tempSay = root.querySelector<HTMLElement>('[data-tw="tempsay"]');
      const drawTemp = (t: number) => {
        if (!hatchBox) return;
        const pF = Math.max(0, Math.min(1, (t - 27.5) / 3));
        const nF = Math.round(pF * 40);
        (Array.from(hatchBox.children) as HTMLElement[]).forEach((b, i) => (b.className = i < nF ? "f" : "m"));
        let msg = "";
        if (t < 28) msg = "偏涼的沙，這一窩幾乎都是雄性。";
        else if (t < 28.8) msg = "仍偏雄性。中間那個轉折點大約落在 29°C 附近。";
        else if (t < 29.6) msg = "剛好在轉折帶上，雌雄大致各半。";
        else if (t < 31) msg = "偏暖的沙，這一窩以雌性為主。";
        else msg = "太熱了。持續偏高的沙溫不只讓性別失衡，也會直接壓低孵化率。";
        if (tempSay) tempSay.textContent = `${msg}（紅色為雌性，藍色為雄性）`;
      };
      drawTemp(29);

      /* 產卵：104 顆蛋逐顆冒出 */
      const nest = root.querySelector<HTMLElement>(".tw-nest");
      const eggSay = root.querySelector<HTMLElement>('[data-tw="eggsay"]');
      let laid = false;
      const layEggs = () => {
        if (laid || !nest) return;
        laid = true;
        for (let i = 0; i < 104; i++) {
          window.setTimeout(() => {
            nest.appendChild(document.createElement("b"));
            if (i === 103 && eggSay) eggSay.textContent = "一〇四顆。牠把卵埋好，再爬回海裡。（每窩卵數依個體不同，通常在一百顆上下）";
          }, reduce ? 0 : i * 20);
        }
      };

      /* 餵食模擬：廚餘養出掠食者聚集地 */
      const beach = root.querySelector<HTMLElement>(".tw-beach");
      let simTurt: HTMLElement | null = null;
      if (beach && !beach.childElementCount) {
        simTurt = document.createElement("div");
        simTurt.className = "turt";
        simTurt.innerHTML = TURT_SVG;
        beach.appendChild(simTurt);
      }
      const simSay = root.querySelector<HTMLElement>('[data-tw="simsay"]');
      const dogCount = root.querySelector<HTMLElement>('[data-tw="dogcount"]');
      let dogs = 0;
      const feed = () => {
        if (!beach) return;
        const add = dogs === 0 ? 1 : Math.min(4, Math.ceil(dogs * 0.8));
        for (let i = 0; i < add; i++) {
          const el = document.createElement("div");
          el.className = "dog";
          el.innerHTML = DOG_SVG;
          el.style.left = `${18 + Math.random() * 70}%`;
          el.style.bottom = `${14 + Math.random() * 46}%`;
          beach.appendChild(el);
        }
        dogs += add;
        if (dogCount) dogCount.textContent = `沙灘上的狗：${dogs}`;
        if (simSay) {
          if (dogs < 3) simSay.textContent = "廚餘被吃掉了。狗記住了這個地方，牠開始固定在附近徘徊。";
          else if (dogs < 8) simSay.textContent = "牠們不需要靠捕獵維生，所以可以整晚待在這裡。海龜還是得上岸。";
          else simSay.textContent = "沒有煞車。這片沙灘現在是一個由人類廚餘養出來的掠食者聚集地，而海龜每年還是會回來。";
        }
        if (dogs >= 3 && simTurt) {
          simTurt.style.left = "calc(100% - 60px)";
          window.setTimeout(() => { if (simTurt) simTurt.style.left = "12px"; }, 2400);
        }
        if (dogs >= 8 && simTurt) simTurt.style.opacity = ".35";
      };
      const stopFeed = () => {
        beach?.querySelectorAll(".dog").forEach((d) => d.remove());
        dogs = 0;
        if (dogCount) dogCount.textContent = "沙灘上的狗：0";
        if (simTurt) { simTurt.style.opacity = "1"; simTurt.style.left = "12px"; }
        if (simSay) simSay.textContent = "停止餵食之後，狗仍然需要時間才會離開這裡。這是現實中最慢、也最有效的一步。";
      };

      /* 燈光實驗：光害讓小海龜轉向 */
      const light = root.querySelector<HTMLElement>(".tw-light");
      const lightSay = root.querySelector<HTMLElement>('[data-tw="lightsay"]');
      const babies: HTMLElement[] = [];
      if (light && !light.childElementCount) {
        const sea = document.createElement("div"); sea.className = "seaband"; light.appendChild(sea);
        const lamp = document.createElement("div"); lamp.className = "lamp"; light.appendChild(lamp);
        for (let b = 0; b < 12; b++) {
          const el = document.createElement("div");
          el.className = "baby";
          el.style.left = `${12 + b * 6.4}%`;
          el.style.bottom = "14px";
          light.appendChild(el);
          babies.push(el);
        }
      }
      let lampOn = false;
      const moveBabies = () => {
        babies.forEach((el, i) => {
          el.style.transform = lampOn
            ? `translate(${110 + i * 4}px, ${10 + Math.random() * 14}px)`
            : `translate(${(Math.random() - 0.5) * 26}px, -108px)`;
        });
      };
      window.setTimeout(moveBabies, 400);
      const toggleLight = (btn: HTMLElement) => {
        lampOn = !lampOn;
        light?.classList.toggle("on", lampOn);
        btn.textContent = lampOn ? "關掉燈" : "打開沙灘上的燈";
        if (lightSay)
          lightSay.textContent = lampOn
            ? "牠們轉向了。小海龜朝著最亮的地方爬，離海愈來愈遠，在沙灘上耗盡體力。煙火、營火、手電筒都一樣。"
            : "現在只有月光。小海龜朝著海的方向爬。";
        moveBabies();
      };

      /* 溫度晶片＋按鈕：事件委派（含鍵盤 Enter/空白） */
      const onTwActivate = (target: HTMLElement) => {
        const chip = target.closest<HTMLElement>(".tw-chip");
        if (chip) {
          root.querySelectorAll(".tw-chip").forEach((c) => c.classList.remove("on"));
          chip.classList.add("on");
          drawTemp(Number(chip.dataset.temp) || 29);
          return;
        }
        const btn = target.closest<HTMLElement>("[data-tw]");
        if (!btn) return;
        const kind = btn.dataset.tw;
        if (kind === "dots") runDots();
        else if (kind === "eggs") layEggs();
        else if (kind === "feed") feed();
        else if (kind === "stopfeed") stopFeed();
        else if (kind === "light") toggleLight(btn);
      };
      const onTwClick = (e: MouseEvent) => onTwActivate(e.target as HTMLElement);
      const onTwKey = (e: KeyboardEvent) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const el = e.target as HTMLElement;
        if (el.closest(".tw-chip,[data-tw]")) { e.preventDefault(); onTwActivate(el); }
      };
      root.addEventListener("click", onTwClick);
      root.addEventListener("keydown", onTwKey);
      twCleanups.push(() => { root.removeEventListener("click", onTwClick); root.removeEventListener("keydown", onTwKey); });

      /* 爬痕軌：左側 S 形爬行線隨捲動畫出，中後段浮出狗腳印（原稿的招牌視覺） */
      const railBox = root.querySelector<HTMLElement>(".tw-rail");
      const tl = root.querySelector<HTMLElement>(".tw-tl");
      if (railBox && tl && !railBox.childElementCount) {
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", "0 0 36 800");
        svg.setAttribute("preserveAspectRatio", "none");
        const crawl = document.createElementNS(NS, "path");
        crawl.setAttribute("class", "crawl");
        crawl.setAttribute("d", "M18 0 C8 90 28 170 18 260 C10 350 26 430 18 520 C11 610 25 700 18 800");
        svg.appendChild(crawl);
        const pawsG = document.createElementNS(NS, "g");
        svg.appendChild(pawsG);
        railBox.appendChild(svg);
        const L = crawl.getTotalLength();
        crawl.style.strokeDasharray = String(L);
        crawl.style.strokeDashoffset = String(L);
        const paws: SVGGElement[] = [];
        for (let d = 0; d < 7; d++) {
          const pt = crawl.getPointAtLength(((d + 2) / 12) * L);
          const g = document.createElementNS(NS, "g");
          g.setAttribute("class", "paw");
          const cx = pt.x + (d % 2 ? 11 : -11);
          const cy = pt.y;
          g.innerHTML =
            `<circle cx="${cx}" cy="${cy}" r="2.4"/>` +
            `<circle cx="${cx - 3.1}" cy="${cy - 3.7}" r="1.2"/>` +
            `<circle cx="${cx}" cy="${cy - 4.8}" r="1.2"/>` +
            `<circle cx="${cx + 3.1}" cy="${cy - 3.7}" r="1.2"/>`;
          pawsG.appendChild(g);
          paws.push(g);
        }
        const onRailScroll = () => {
          const r = tl.getBoundingClientRect();
          const total = r.height - window.innerHeight;
          const p = total > 0 ? Math.max(0, Math.min(1, (-r.top + window.innerHeight * 0.3) / total)) : 1;
          crawl.style.strokeDashoffset = String(L * (1 - p));
          const pawP = Math.max(0, (p - 0.5) / 0.35);
          paws.forEach((el, i) => el.classList.toggle("on", i / 7 <= pawP));
        };
        if (reduce) { crawl.style.strokeDashoffset = "0"; paws.forEach((el) => el.classList.add("on")); }
        else {
          window.addEventListener("scroll", onRailScroll, { passive: true });
          onRailScroll();
          twCleanups.push(() => window.removeEventListener("scroll", onRailScroll));
        }
      }
    }

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", sweep);
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKey);
      root.removeEventListener("click", onImgClick);
      root.removeEventListener("click", onPollClick);
      root.removeEventListener("mousemove", onTilt);
      root.removeEventListener("mouseout", onTiltOut);
      dragCleanups.forEach((fn) => fn());
      twCleanups.forEach((fn) => fn());
      document.querySelector(".yb-lightbox")?.remove();
    };
  }, []);
  return null;
}

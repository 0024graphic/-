/* ===================================================================
   app.js
   画面制御本体。logic.js（評価ロジック）と storage.js（保存・警告）を
   呼び出して画面に反映する。
=================================================================== */

let horseSeq = 0; // 馬カードのユニークID発行用
let lastEvalResult = null; // 直近の評価結果（履歴記録用に保持）

/* ---------------------------------------------------------------
   タブ切り替え
--------------------------------------------------------------- */
function switchTab(tabName) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById(`tab-${tabName}`).classList.add("active");

  document.querySelectorAll(".tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabName);
  });
  document.querySelectorAll(".bottom-nav button").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabName);
  });

  if (tabName === "history") renderHistoryTab();
}

document.querySelectorAll(".tab-btn, .bottom-nav button").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

/* ---------------------------------------------------------------
   セグメントボタン（脚質・適性ランクなど）の選択状態制御
--------------------------------------------------------------- */
function setupSegmented(container) {
  container.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll("button").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
  });
}

function getSegmentedValue(container) {
  const selected = container.querySelector("button.selected");
  return selected ? selected.dataset.val : null;
}

function setSegmentedValue(container, value) {
  container.querySelectorAll("button").forEach(b => {
    b.classList.toggle("selected", b.dataset.val === value);
  });
}

setupSegmented(document.getElementById("trackConditionSeg"));

/* ---------------------------------------------------------------
   馬カードの追加・削除
--------------------------------------------------------------- */
const horseListEl = document.getElementById("horseList");
const horseTemplate = document.getElementById("horseCardTemplate");

function addHorseCard(prefill) {
  horseSeq += 1;
  const id = horseSeq;

  const node = horseTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = id;

  const numberInput = node.querySelector(".h-number");
  const nameInput = node.querySelector(".h-name");
  const numberBadge = node.querySelector(".horse-card__number");
  const nameLabel = node.querySelector(".horse-card__name");

  // デフォルト馬番＝現在のカード数+1
  const defaultNumber = horseListEl.children.length + 1;
  numberInput.value = prefill?.number ?? defaultNumber;
  numberBadge.textContent = numberInput.value;

  if (prefill?.name) {
    nameInput.value = prefill.name;
    nameLabel.textContent = prefill.name;
  }

  // 開閉
  const head = node.querySelector(".horse-card__head");
  head.addEventListener("click", (e) => {
    if (e.target.closest(".remove-horse-btn")) return;
    node.classList.toggle("open");
  });

  // 馬番・馬名のライブ反映
  numberInput.addEventListener("input", () => {
    numberBadge.textContent = numberInput.value || "?";
  });
  nameInput.addEventListener("input", () => {
    nameLabel.textContent = nameInput.value || "馬名未入力";
  });

  // セグメントボタン初期化
  node.querySelectorAll(".segmented").forEach(seg => setupSegmented(seg));

  // 削除
  node.querySelector(".remove-horse-btn").addEventListener("click", () => {
    node.remove();
    saveDraftFromForm();
  });

  // プリフィルがあれば反映
  if (prefill) {
    node.querySelector(".h-popularity").value = prefill.popularity ?? 1;
    node.querySelector(".h-odds").value = prefill.odds ?? 5.0;
    if (prefill.runningStyle) setSegmentedValue(node.querySelector(".h-running-style"), prefill.runningStyle);
    node.querySelector(".h-last5").value = (prefill.last5 || []).join(",");
    if (prefill.distanceFit) setSegmentedValue(node.querySelector(".h-distance-fit"), prefill.distanceFit);
    if (prefill.trackFit) setSegmentedValue(node.querySelector(".h-track-fit"), prefill.trackFit);
    if (prefill.courseFit) setSegmentedValue(node.querySelector(".h-course-fit"), prefill.courseFit);
    if (prefill.classFit) setSegmentedValue(node.querySelector(".h-class-fit"), prefill.classFit);
    node.querySelector(".h-jockey").value = prefill.jockeyScore ?? 3;
    node.querySelector(".h-stable").value = prefill.stableScore ?? 3;
    node.querySelector(".h-trouble").checked = !!prefill.troubleFlag;
  }

  // 入力があるたびドラフト保存
  node.querySelectorAll("input").forEach(inp => inp.addEventListener("input", saveDraftFromForm));
  node.querySelectorAll(".segmented button").forEach(b => b.addEventListener("click", saveDraftFromForm));

  horseListEl.appendChild(node);
}

document.getElementById("addHorseBtn").addEventListener("click", () => {
  addHorseCard();
  saveDraftFromForm();
});

/* ---------------------------------------------------------------
   フォーム → データ抽出
--------------------------------------------------------------- */
function readHorseFromCard(node) {
  const last5Str = node.querySelector(".h-last5").value;
  const last5 = last5Str
    .split(",")
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n));

  return {
    number: parseInt(node.querySelector(".h-number").value, 10) || 0,
    name: node.querySelector(".h-name").value.trim() || `${node.querySelector(".h-number").value}番`,
    popularity: parseInt(node.querySelector(".h-popularity").value, 10) || 1,
    odds: parseFloat(node.querySelector(".h-odds").value) || 1.0,
    runningStyle: getSegmentedValue(node.querySelector(".h-running-style")) || "先行",
    last5: last5,
    distanceFit: getSegmentedValue(node.querySelector(".h-distance-fit")) || "○",
    trackFit: getSegmentedValue(node.querySelector(".h-track-fit")) || "○",
    courseFit: getSegmentedValue(node.querySelector(".h-course-fit")) || "○",
    classFit: getSegmentedValue(node.querySelector(".h-class-fit")) || "○",
    jockeyScore: parseInt(node.querySelector(".h-jockey").value, 10) || 3,
    stableScore: parseInt(node.querySelector(".h-stable").value, 10) || 3,
    troubleFlag: node.querySelector(".h-trouble").checked,
  };
}

function readAllHorses() {
  return Array.from(horseListEl.children).map(readHorseFromCard);
}

function readRaceForm() {
  return {
    raceName: document.getElementById("raceName").value.trim() || "名称未設定レース",
    distance: parseInt(document.getElementById("distance").value, 10) || 1400,
    raceClass: document.getElementById("raceClass").value.trim(),
    trackCondition: getSegmentedValue(document.getElementById("trackConditionSeg")) || "良",
    isHoliday: document.getElementById("isHoliday").checked,
  };
}

/* ---------------------------------------------------------------
   ドラフト保存・復元（アプリを閉じても入力内容を保持）
--------------------------------------------------------------- */
function saveDraftFromForm() {
  const race = readRaceForm();
  const horses = readAllHorses();
  saveDraft({ race, horses });
}

function restoreDraft() {
  const draft = loadDraft();
  if (!draft) {
    // 初回は2頭分の空カードを用意しておく
    addHorseCard();
    addHorseCard();
    return;
  }

  document.getElementById("raceName").value = draft.race?.raceName === "名称未設定レース" ? "" : (draft.race?.raceName || "");
  document.getElementById("distance").value = draft.race?.distance || 1400;
  document.getElementById("raceClass").value = draft.race?.raceClass || "";
  document.getElementById("isHoliday").checked = !!draft.race?.isHoliday;
  if (draft.race?.trackCondition) {
    setSegmentedValue(document.getElementById("trackConditionSeg"), draft.race.trackCondition);
  }

  if (draft.horses && draft.horses.length > 0) {
    draft.horses.forEach(h => addHorseCard(h));
  } else {
    addHorseCard();
    addHorseCard();
  }
}

/* ---------------------------------------------------------------
   評価実行
--------------------------------------------------------------- */
document.getElementById("evaluateBtn").addEventListener("click", () => {
  const race = readRaceForm();
  const horses = readAllHorses();

  if (horses.length < 2) {
    alert("出走馬データを2頭以上入力してください。");
    return;
  }
  const invalid = horses.find(h => !h.number);
  if (invalid) {
    alert("馬番が未入力の馬があります。");
    return;
  }

  const evalResult = evaluateRace(horses);
  const betResult = buildBets(evalResult, race.isHoliday);

  lastEvalResult = { race, evalResult, betResult };

  renderResult(race, evalResult, betResult);
  switchTab("result");
});

/* ---------------------------------------------------------------
   結果表示
--------------------------------------------------------------- */
const RANK_CLASS = {
  "A": "rank-A",
  "B+": "rank-Bplus",
  "B": "rank-B",
  "C": "rank-C",
  "スルー": "rank-through",
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderResult(race, evalResult, betResult) {
  document.getElementById("resultEmpty").classList.add("hidden");
  const content = document.getElementById("resultContent");
  content.classList.remove("hidden");

  const rankClass = RANK_CLASS[evalResult.rank] || "";
  const isThrough = evalResult.rank === "スルー";

  // --- ゲート番号板（判定） ---
  let html = `
    <div class="gate-panel">
      <p class="gate-panel__label">${escapeHtml(race.raceName)}</p>
      <p class="gate-panel__rank ${rankClass}">${escapeHtml(evalResult.rank)}</p>
      ${evalResult.isChaos ? '<div class="chaos-badge">混戦：1番人気の頭固定なし</div>' : ""}
      <p class="gate-panel__note">${isThrough ? "今回は見送りが推奨されます" : "下記の買い目を参考にしてください"}</p>
    </div>
  `;

  // --- 買いすぎ警告（評価のたびにチェック） ---
  const guard = checkGuard(race.isHoliday);
  html += renderGuardBanner(guard);

  // --- 馬ごとの評価テーブル ---
  html += `<div class="card"><p class="card-title">馬ごとの評価</p>`;
  html += `<table class="score-table"><thead><tr>
      <th>馬番</th><th>馬名</th><th>最終点</th><th>人気/オッズ</th>
    </tr></thead><tbody>`;
  evalResult.sortedHorses.forEach(h => {
    const tags = h.tags.map(t => {
      let cls = "tag-danger";
      if (t === "ズレ馬") cls = "tag-mid";
      if (t.includes("事故席")) cls = "tag-long";
      return `<span class="tag-pill ${cls}">${escapeHtml(t)}</span>`;
    }).join("");
    html += `<tr>
      <td>${h.number}</td>
      <td>${escapeHtml(h.name)}${tags ? `<br>${tags}` : ""}</td>
      <td class="score-num">${h.finalScore}</td>
      <td class="text-dim">${h.popularity}人気 / ${h.odds}倍</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;

  // --- 危険人気馬・ズレ馬・事故席の個別表示 ---
  const dangerHorses = evalResult.sortedHorses.filter(h => h.tags.includes("危険人気馬"));
  if (dangerHorses.length > 0) {
    html += `<div class="card"><p class="card-title">危険人気馬</p>`;
    dangerHorses.forEach(h => {
      html += `<p style="font-size:13px; margin:6px 0;">⚠️ ${h.number}番 ${escapeHtml(h.name)}（${h.popularity}人気だが最終点${h.finalScore}）</p>`;
    });
    html += `</div>`;
  }

  if (evalResult.midpriceHorse) {
    const h = evalResult.midpriceHorse;
    html += `<div class="card"><p class="card-title">ズレ馬候補</p>
      <p style="font-size:13px;">🎯 ${h.number}番 ${escapeHtml(h.name)}（${h.odds}倍 / 最終点${h.finalScore}）</p></div>`;
  }
  if (evalResult.longshotHorse) {
    const h = evalResult.longshotHorse;
    html += `<div class="card"><p class="card-title">事故席候補（3着想定）</p>
      <p style="font-size:13px;">💥 ${h.number}番 ${escapeHtml(h.name)}（${h.odds}倍 / 最終点${h.finalScore}）</p></div>`;
  }

  // --- 買い目 ---
  html += `<div class="card"><p class="card-title">買い目</p>`;
  if (betResult.betType === null) {
    html += `<p style="font-size:14px; color:var(--danger); font-weight:600;">${escapeHtml(betResult.comment)}</p>`;
  } else {
    html += `<p style="font-size:13px; color:var(--cream-dim);">${escapeHtml(betResult.betType)} ／ ${escapeHtml(betResult.comment)}</p>`;
    betResult.tickets.forEach(t => {
      html += `<div class="ticket-row">
        <span class="ticket-combo">${escapeHtml(t.combo)}</span>
        <span class="ticket-amount">${t.amount}円</span>
      </div>`;
    });

    const ratio = Math.min(1, betResult.totalAmount / betResult.budget);
    html += `
      <div class="budget-bar"><div class="budget-bar__fill ${ratio >= 1 ? "over" : ""}" style="width:${ratio * 100}%"></div></div>
      <div class="budget-text"><span>使用額 ${betResult.totalAmount}円</span><span>予算 ${betResult.budget}円</span></div>
    `;
  }
  html += `</div>`;

  // --- 履歴に記録するボタン ---
  html += `
    <button class="btn btn-secondary" id="recordHistoryBtn">この結果を履歴に記録する</button>
  `;

  content.innerHTML = html;

  document.getElementById("recordHistoryBtn").addEventListener("click", () => {
    addHistoryEntry({
      raceName: race.raceName,
      rank: evalResult.rank,
      betAmount: betResult.totalAmount,
    });
    alert("履歴に記録しました。");
    renderHistoryTab();
  });
}

function renderGuardBanner(guard) {
  if (guard.warnings.length === 0) return "";
  const cls = guard.stopSuggested ? "warn-banner stop" : "warn-banner";
  const title = guard.stopSuggested ? "⚠️ 今日はもうやめる判断を" : "⚠️ 買いすぎ注意";
  const items = guard.warnings.map(w => `<p class="warn-banner__item">${escapeHtml(w)}</p>`).join("");
  return `<div class="${cls}"><p class="warn-banner__title">${title}</p>${items}</div>`;
}

/* ---------------------------------------------------------------
   履歴タブ
--------------------------------------------------------------- */
function renderHistoryTab() {
  const isHoliday = document.getElementById("isHoliday").checked;
  const guard = checkGuard(isHoliday);

  const guardEl = document.getElementById("guardSummary");
  const ratio = Math.min(1, guard.ratio);
  guardEl.innerHTML = `
    <div class="budget-bar"><div class="budget-bar__fill ${ratio >= 1 ? "over" : ""}" style="width:${ratio * 100}%"></div></div>
    <div class="budget-text"><span>使用額 ${guard.totalSpent}円</span><span>上限 ${guard.dailyLimit}円</span></div>
    ${renderGuardBanner(guard)}
  `;

  const history = getTodayHistory();
  const listEl = document.getElementById("historyList");
  if (history.length === 0) {
    listEl.innerHTML = `<div class="empty-state">本日の記録はまだありません。</div>`;
    return;
  }

  const rankBg = {
    "A": "background:rgba(212,175,55,0.18); color:var(--gold);",
    "B+": "background:rgba(224,123,62,0.18); color:var(--rust-bright);",
    "B": "background:rgba(91,138,120,0.18); color:var(--turf-bright);",
    "C": "background:rgba(185,176,156,0.15); color:var(--cream-dim);",
    "スルー": "background:rgba(179,67,43,0.18); color:#e98669;",
  };

  listEl.innerHTML = history.slice().reverse().map(h => {
    const time = new Date(h.timestamp).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    return `
      <div class="history-item">
        <div style="display:flex; align-items:center;">
          <span class="history-item__rank" style="${rankBg[h.rank] || ""}">${escapeHtml(h.rank)}</span>
          <span>${escapeHtml(h.raceName)}</span>
        </div>
        <div class="text-dim">${time} ／ ${h.betAmount}円</div>
      </div>
    `;
  }).join("");
}

document.getElementById("resetHistoryBtn").addEventListener("click", () => {
  if (confirm("本日の履歴をリセットします。よろしいですか？")) {
    resetTodayHistory();
    renderHistoryTab();
  }
});

/* ---------------------------------------------------------------
   初期化
--------------------------------------------------------------- */
restoreDraft();

/* Service Worker登録（PWA化。file://直接表示では失敗するが無視してよい） */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // file://やローカル簡易サーバーでの確認時はエラーになる場合があるが無視してよい
    });
  });
}

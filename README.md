/* ===================================================================
   storage.js
   端末内保存（localStorage）と、買いすぎ警告・撤退判断のロジック。
   バックエンドなし、すべてこの端末の中だけで完結する。
=================================================================== */

const STORAGE_KEYS = {
  HISTORY: "keiba_history_v1",      // その日の購入履歴
  TODAY: "keiba_today_v1",          // 今日の日付（日付が変わったら履歴リセット判定用）
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/* 今日の履歴を取得（日付が変わっていたら空配列にする） */
function getTodayHistory() {
  const savedDate = localStorage.getItem(STORAGE_KEYS.TODAY);
  const today = todayStr();
  if (savedDate !== today) {
    // 日付が変わった→今日の履歴は新規スタート（過去の履歴自体は別キーで保持してもよいが、MVPでは今日分のみ保持）
    localStorage.setItem(STORAGE_KEYS.TODAY, today);
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify([]));
    return [];
  }
  const raw = localStorage.getItem(STORAGE_KEYS.HISTORY);
  return raw ? JSON.parse(raw) : [];
}

/* 1レース分の評価結果を履歴に追加 */
function addHistoryEntry(entry) {
  const history = getTodayHistory();
  history.push({
    timestamp: new Date().toISOString(),
    raceName: entry.raceName,
    rank: entry.rank,
    betAmount: entry.betAmount, // スルーなら0
    isThrough: entry.rank === "スルー",
  });
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
  return history;
}

/* 今日の合計使用額 */
function getTodayTotalSpent() {
  return getTodayHistory().reduce((sum, h) => sum + (h.betAmount || 0), 0);
}

/* 直近の連続スルー回数（最新から数えて連続している分） */
function getConsecutiveThroughCount() {
  const history = getTodayHistory();
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].isThrough) count++;
    else break;
  }
  return count;
}

/* ---------------------------------------------------------------
   買いすぎ警告・撤退判断の本体
   呼び出し側（app）はこの戻り値を見て警告バナーを出す。
--------------------------------------------------------------- */
function checkGuard(isHoliday) {
  const budget = isHoliday ? CONFIG.BUDGET.holidayMax : CONFIG.BUDGET.normal;
  const dailyLimit = isHoliday ? CONFIG.BUDGET.holidayMax : CONFIG.BUDGET.normal;
  // 通常日は1レース分=1日分の予算という想定。休日は3000円が1日の総予算という想定。
  const totalSpent = getTodayTotalSpent();
  const consecutiveThrough = getConsecutiveThroughCount();

  const warnings = [];
  let stopSuggested = false;

  const ratio = dailyLimit > 0 ? totalSpent / dailyLimit : 0;
  if (ratio >= 1.0) {
    warnings.push(`本日の予算（${dailyLimit}円）に達しています。これ以上の購入は推奨しません。`);
    stopSuggested = true;
  } else if (ratio >= CONFIG.GUARD.dailyBudgetWarnRatio) {
    warnings.push(`本日の使用額が予算の${Math.round(ratio * 100)}%（${totalSpent}円 / ${dailyLimit}円）に達しています。`);
  }

  if (consecutiveThrough >= CONFIG.GUARD.consecutiveThroughForStop) {
    warnings.push(`スルー判定が${consecutiveThrough}回連続しています。今日は条件の良いレースが少ない可能性があります。`);
    stopSuggested = true;
  }

  return {
    totalSpent,
    dailyLimit,
    ratio,
    consecutiveThrough,
    warnings,
    stopSuggested,
  };
}

/* 履歴を全部消す（手動リセット用） */
function resetTodayHistory() {
  localStorage.setItem(STORAGE_KEYS.TODAY, todayStr());
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify([]));
}

/* ---------------------------------------------------------------
   入力中の馬データの一時保存（アプリを閉じても入力内容を保持する）
--------------------------------------------------------------- */
const DRAFT_KEY = "keiba_draft_v1";

function saveDraft(data) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("draft save failed", e);
  }
}

function loadDraft() {
  const raw = localStorage.getItem(DRAFT_KEY);
  return raw ? JSON.parse(raw) : null;
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

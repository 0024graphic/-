/* ===================================================================
   logic.js
   固定ルールに基づく評価・買い目生成ロジック本体。
   AIが自由に判断するのではなく、ここに書かれたルールだけで動く。
   調整したい場合は CONFIG の数値だけ変えればよい。
=================================================================== */

const CONFIG = {
  WEIGHTS: {
    formStability: 30,   // 過去5走の安定度
    runningStyle: 20,    // 脚質（前に行けるか）
    fit: 25,             // 距離・馬場・コース適性
    jockeyStable: 15,    // 騎手・厩舎（補助）
    classLevel: 10,      // クラス適性
  },

  RUNNING_STYLE_SCORE: {
    "逃げ": 1.00,
    "先行": 0.90,
    "差し": 0.55,
    "追込": 0.35,
  },

  FIT_RANK_SCORE: {
    "◎": 1.00,
    "○": 0.75,
    "△": 0.40,
    "×": 0.10,
  },

  JOCKEY_STABLE_MAX: 5,
  CLASS_LEVEL_BASE: 0.7,

  DANGER_PENALTY: {
    troubleFlag: 12,
    popularButUnfit: 15,
    popularityThreshold: 3,
  },

  MIDPRICE_HORSE: { oddsMin: 20.0, oddsMax: 30.0, minScore: 45 },
  LONGSHOT_HORSE: { oddsMin: 30.0, oddsMax: 100.0, minScore: 30 },

  CHAOS_RACE: { top2ScoreGapThreshold: 8 },

  RANK_THRESHOLDS: { A: 80, Bplus: 68, B: 55, C: 40 },
  THROUGH_FLOOR: 40,

  BUDGET: { normal: 600, holidayMax: 3000 },
  BET_UNIT: 100,

  // 買いすぎ警告・撤退ライン（端末内に保存した履歴を見て判定）
  GUARD: {
    dailyBudgetWarnRatio: 0.8, // 1日の合計使用額が上限の何%でで警告するか
    consecutiveThroughForStop: 2, // スルーが連続でこの回数出たら「今日はやめる」提案
    consecutiveLossForStop: 3,    // 連続で「結果:外れ」を記録した場合の提案閾値（結果記録機能用）
  },
};

/* -------------------------------------------------------------
   Layer1: 基礎スコア
------------------------------------------------------------- */
function formStabilityScore(last5) {
  if (!last5 || last5.length === 0) return 0.5;
  const races = last5.slice(0, 5);
  const avg = races.reduce((a, b) => a + b, 0) / races.length;
  const avgScore = Math.max(0, 1 - (avg - 1) / 6.0);

  const recent = races[0];
  let recentPenalty = 0;
  if (recent >= 8) recentPenalty = 0.35;
  else if (recent >= 6) recentPenalty = 0.20;
  else if (recent >= 5) recentPenalty = 0.08;

  const collapseCount = races.filter(r => r >= 6).length;
  const collapsePenalty = Math.min(0.10 * collapseCount, 0.30);

  const score = avgScore - recentPenalty - collapsePenalty;
  return Math.max(0, Math.min(1, score));
}

function runningStyleScore(style) {
  return CONFIG.RUNNING_STYLE_SCORE[style] ?? 0.5;
}

function fitScore(horse) {
  const r = CONFIG.FIT_RANK_SCORE;
  const vals = [
    r[horse.distanceFit] ?? 0.5,
    r[horse.trackFit] ?? 0.5,
    r[horse.courseFit] ?? 0.5,
  ];
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function jockeyStableScore(horse) {
  const j = horse.jockeyScore / CONFIG.JOCKEY_STABLE_MAX;
  const s = horse.stableScore / CONFIG.JOCKEY_STABLE_MAX;
  return (j + s) / 2;
}

function classLevelScore(horse) {
  return CONFIG.FIT_RANK_SCORE[horse.classFit] ?? CONFIG.CLASS_LEVEL_BASE;
}

function calcBaseScore(horse) {
  const w = CONFIG.WEIGHTS;
  const score =
    formStabilityScore(horse.last5) * w.formStability +
    runningStyleScore(horse.runningStyle) * w.runningStyle +
    fitScore(horse) * w.fit +
    jockeyStableScore(horse) * w.jockeyStable +
    classLevelScore(horse) * w.classLevel;
  horse.baseScore = Math.round(score * 10) / 10;
  return horse.baseScore;
}

/* -------------------------------------------------------------
   Layer2: 危険フラグ（減点・タグ付け）
------------------------------------------------------------- */
function applyDangerFlags(horse) {
  let penalty = 0;
  const tags = [];

  if (horse.troubleFlag) {
    penalty += CONFIG.DANGER_PENALTY.troubleFlag;
    tags.push("近走不安");
  }

  const isPopular = horse.popularity <= CONFIG.DANGER_PENALTY.popularityThreshold;
  if (isPopular && horse.baseScore < 60) {
    penalty += CONFIG.DANGER_PENALTY.popularButUnfit;
    tags.push("危険人気馬");
  }

  horse.dangerPenalty = Math.round(penalty * 10) / 10;
  horse.finalScore = Math.round(Math.max(0, horse.baseScore - penalty) * 10) / 10;
  horse.tags = (horse.tags || []).concat(tags);
  return horse.finalScore;
}

/* -------------------------------------------------------------
   Layer3: ズレ馬・事故席の抽出
------------------------------------------------------------- */
function findSpecialHorses(horses) {
  const mid = CONFIG.MIDPRICE_HORSE;
  const long = CONFIG.LONGSHOT_HORSE;

  const midCandidates = horses
    .filter(h => h.odds >= mid.oddsMin && h.odds <= mid.oddsMax && h.finalScore >= mid.minScore)
    .sort((a, b) => b.finalScore - a.finalScore);
  const midpriceHorse = midCandidates[0] || null;
  if (midpriceHorse) midpriceHorse.tags.push("ズレ馬");

  const longCandidates = horses
    .filter(h => h.odds > long.oddsMin && h.odds <= long.oddsMax && h.finalScore >= long.minScore)
    .sort((a, b) => b.finalScore - a.finalScore);
  const longshotHorse = longCandidates[0] || null;
  if (longshotHorse) longshotHorse.tags.push("事故席(3着候補)");

  return { midpriceHorse, longshotHorse };
}

/* -------------------------------------------------------------
   混戦判定
------------------------------------------------------------- */
function judgeChaos(sortedHorses) {
  if (sortedHorses.length < 2) return false;
  const gap = sortedHorses[0].finalScore - sortedHorses[1].finalScore;
  return gap < CONFIG.CHAOS_RACE.top2ScoreGapThreshold;
}

/* -------------------------------------------------------------
   最終ランク判定
------------------------------------------------------------- */
function judgeRank(sortedHorses) {
  if (sortedHorses.length === 0) return "スルー";
  const top = sortedHorses[0].finalScore;
  const th = CONFIG.RANK_THRESHOLDS;

  if (top < CONFIG.THROUGH_FLOOR) return "スルー";
  if (top >= th.A) return "A";
  if (top >= th.Bplus) return "B+";
  if (top >= th.B) return "B";
  if (top >= th.C) return "C";
  return "スルー";
}

/* -------------------------------------------------------------
   入口関数：レース全体を評価する
------------------------------------------------------------- */
function evaluateRace(horses) {
  // ディープコピーしてtagsを初期化
  const hs = horses.map(h => ({ ...h, tags: [] }));

  hs.forEach(calcBaseScore);
  hs.forEach(applyDangerFlags);

  const special = findSpecialHorses(hs);
  const sorted = [...hs].sort((a, b) => b.finalScore - a.finalScore);
  const isChaos = judgeChaos(sorted);
  const rank = judgeRank(sorted);

  return {
    rank,
    isChaos,
    sortedHorses: sorted,
    midpriceHorse: special.midpriceHorse,
    longshotHorse: special.longshotHorse,
  };
}

/* -------------------------------------------------------------
   買い目生成（3連単 基本／混戦時は3連複）
------------------------------------------------------------- */
function permutations2(arr) {
  // arrから2個取り出す順列 [a,b] (a!=b)
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = 0; j < arr.length; j++) {
      if (i !== j) result.push([arr[i], arr[j]]);
    }
  }
  return result;
}

function combinations3(arr) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      for (let k = j + 1; k < arr.length; k++) {
        result.push([arr[i], arr[j], arr[k]]);
      }
    }
  }
  return result;
}

function formatCombo(numbers) {
  return numbers.join("-");
}

function buildBets(evalResult, isHoliday) {
  const rank = evalResult.rank;
  const budget = isHoliday ? CONFIG.BUDGET.holidayMax : CONFIG.BUDGET.normal;

  if (rank === "スルー") {
    return {
      betType: null,
      tickets: [],
      totalAmount: 0,
      budget,
      comment: "スルー推奨：信頼できる軸が立たないため見送り。",
    };
  }

  const sortedHorses = evalResult.sortedHorses;

  if (sortedHorses.length < 3) {
    return {
      betType: null,
      tickets: [],
      totalAmount: 0,
      budget,
      comment: "出走馬が3頭未満のため3連単/3連複を組めません。データを確認してください。",
    };
  }
  const isChaos = evalResult.isChaos;
  const midprice = evalResult.midpriceHorse;
  const longshot = evalResult.longshotHorse;

  const top = sortedHorses.slice(0, Math.min(5, sortedHorses.length));
  const axisHorses = !isChaos ? [top[0]] : top.slice(0, 2);
  const partnerHorses = top.slice(0, Math.min(4, top.length));

  let betType = "3連単";
  let combos = [];

  if (!isChaos) {
    const axis = axisHorses[0];
    const others = partnerHorses.filter(h => h.number !== axis.number);
    permutations2(others.map(h => h.number)).forEach(([b, c]) => {
      combos.push([axis.number, b, c]);
    });
  } else {
    betType = "3連複";
    const pool = partnerHorses.map(h => h.number);
    combinations3(pool).forEach(c => combos.push([...c].sort((a, b) => a - b)));
  }

  if (betType === "3連単" && longshot && axisHorses.length >= 1) {
    const axis = axisHorses[0];
    const seconds = partnerHorses.filter(h => h.number !== axis.number && h.number !== longshot.number).slice(0, 2);
    seconds.forEach(s => {
      const combo = [axis.number, s.number, longshot.number];
      const exists = combos.some(c => c[0] === combo[0] && c[1] === combo[1] && c[2] === combo[2]);
      if (!exists) combos.push(combo);
    });
  }

  // 重複除去
  const seen = new Set();
  const uniqueCombos = [];
  combos.forEach(c => {
    const key = betType === "3連単" ? c.join("-") : [...c].sort((a, b) => a - b).join("-");
    if (!seen.has(key)) {
      seen.add(key);
      uniqueCombos.push(c);
    }
  });

  if (uniqueCombos.length === 0) {
    return {
      betType: null,
      tickets: [],
      totalAmount: 0,
      budget,
      comment: "買い目を組めませんでした（出走馬数不足等）。スルー推奨。",
    };
  }

  const unit = CONFIG.BET_UNIT;
  const maxTickets = Math.floor(budget / unit);
  let finalCombos = uniqueCombos;
  if (finalCombos.length > maxTickets) {
    finalCombos = finalCombos.slice(0, maxTickets);
  }

  let amountEach = Math.floor(budget / finalCombos.length / unit) * unit;
  amountEach = Math.max(amountEach, unit);

  let tickets = finalCombos.map(c => ({ combo: formatCombo(c), amount: amountEach }));
  let total = tickets.reduce((a, t) => a + t.amount, 0);

  while (total > budget && tickets.length > 1) {
    tickets.pop();
    total = tickets.reduce((a, t) => a + t.amount, 0);
  }

  const commentParts = [];
  if (isChaos) commentParts.push("混戦のため1番人気の頭固定を避け、3連複で対応。");
  if (longshot) commentParts.push(`事故席として${longshot.number}番（${longshot.name}）を一部3着に配置。`);
  if (midprice) commentParts.push(`ズレ馬として${midprice.number}番（${midprice.name}）を相手に含める。`);

  return {
    betType,
    tickets,
    totalAmount: total,
    budget,
    comment: commentParts.length ? commentParts.join(" ") : "通常の軸流し買い目。",
  };
}

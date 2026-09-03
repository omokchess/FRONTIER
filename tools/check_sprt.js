/* SPRT 게이트 자가 점검 — node tools/check_sprt.js
 *
 * 원래 챔피언 교체 기준("6판 60% + 재대결 12판 55%")은 실력이 같은 개체도
 * 세대당 38% 확률로 통과시켰다. 120세대 진화에서 관측된 38회 교체가
 * 노이즈 기대치(46회)보다 오히려 적었다 — 향상의 증거가 전혀 아니었다.
 *
 * 그래서 SPRT로 바꿨다. 이 검사는 그 게이트가 실제로 노이즈를 걸러내는지 본다.
 * 대국은 느리므로 동전 던지기로 판정 로직만 검사한다.
 */
'use strict';
const alpha = 0.05, beta = 0.05, p0 = 0.5, p1 = 0.6;
const lower = Math.log(beta / (1 - alpha));
const upper = Math.log((1 - beta) / alpha);
const lw = Math.log(p1 / p0), ll = Math.log((1 - p1) / (1 - p0));

function trial(trueP, maxGames) {
  let llr = 0, n = 0;
  while (n < maxGames) {
    const s = Math.random() < trueP ? 1 : 0;
    n++; llr += s * lw + (1 - s) * ll;
    if (llr >= upper) return { pass: true, n };
    if (llr <= lower) return { pass: false, n };
  }
  return { pass: false, n, inconclusive: true };
}

const runs = 3000, maxG = 160;
let bad = 0;
const report = (label, p) => {
  let pass = 0, sumN = 0;
  for (let i = 0; i < runs; i++) { const t = trial(p, maxG); if (t.pass) pass++; sumN += t.n; }
  const rate = pass / runs;
  console.log(`  ${label}: 통과율 ${(rate * 100).toFixed(1)}%  평균 ${Math.round(sumN / runs)}판`);
  return rate;
};

console.log(`SPRT (alpha=${alpha}, beta=${beta}, H0=${p0}, H1=${p1}, 최대 ${maxG}판)`);
const fp = report('동일 실력 (50%)  ', 0.50);
const tp = report('확실히 나음 (60%)', 0.60);
report('약간 나음 (55%)  ', 0.55);

// 가짜 양성률은 alpha 근처여야 한다. 옛 고정 임계값 방식은 38%였다.
if (fp > 0.12) { console.error(`실패: 가짜 양성률 ${(fp * 100).toFixed(1)}% — alpha=${alpha} 대비 너무 높다`); bad++; }
if (tp < 0.60) { console.error(`실패: 진짜 개선 통과율 ${(tp * 100).toFixed(1)}% — 너무 낮다`); bad++; }
if (!bad) console.log('\nSPRT 점검 통과 — 노이즈는 걸러내고 진짜 개선은 통과시킨다');
process.exitCode = bad ? 1 : 0;

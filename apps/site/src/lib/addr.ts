// 주소 → 우편번호 조회 (브라우저에서 실행되는 순수 함수 모음)
// 입력: 시군구별 조각(shard)과 이름 색인(names). 만드는 쪽: data/notebooks/02_build_address_index_v2.1.ipynb (v1·v2 도 같은 형식)
// 이 파일의 조회 규칙은 노트북 5절의 road_lookup / jibun_lookup 과 같아야 한다 (노트북이 전수 대조한 규칙).
//
// 입력 해석(parse)은 노트북이 검증하는 대상이 아니라 입력 문자열을 (도로명·동·시군구·시도·번호)로 나누는 일이다.
// 원칙: 애매하면 단정하지 않는다(후보를 보여 준다). 건물 번호(숫자)는 합치거나 쪼개거나 오타를 허용하지 않는다.

export type Names = {
  v: number;
  c: [string, string, string][]; // [시군구코드, 시군구 이름, 시도]
  r: Record<string, number[]>; // 도로명 → c 의 위치들
  a: Record<string, number[]>; // 읍면동·리 이름 → c 의 위치들
};

export type Shard = {
  v: number;
  code: string;
  name: string;
  sido: string;
  base: string;
  zips: string[];
  emds: string[];
  areas: [string, string, string][]; // [법정동코드, 이름, 읍면]
  roads: Record<string, { b?: number[]; r?: number[] }>;
  bn: [string, string, number, number, number, number][]; // [건물명, 도로명, 본번, 부번, 우편번호, 지역]
  j: Record<string, number[]>;
  jr: Record<string, number[]>;
};

export type Parsed = {
  regionWords: string[]; // 시군구 수준 단어 (입력한 그대로: '분당구', '성남' 등)
  sido: string[]; // 시도 (표준 이름. 별칭표로 바꾼 것)
  ambiguousRegion?: string; // '광주'처럼 시도와 시군구에 모두 해당해 단정할 수 없는 단어
  road?: string;
  bon?: number;
  bu: number;
  under: number;
  areaWord?: string;
  san: number;
  jbon?: number;
  jbu: number;
  text: string[];
  hints: string[]; // 괄호 안 단어 (건물명 일치에 쓸 수 있게 보존)
  interpreted?: string; // 입력을 이렇게 해석했다는 한 줄 (입력과 다를 때만)
};

export type Level = 'exact' | 'range' | 'road' | 'area' | 'name';

export type Hit = {
  level: Level;
  zip: string;
  code: string;
  title: string; // 주소 한 줄
  sub?: string; // 보조 설명 (법정동, 건물명, 범위 안내 등)
  emd?: string; // 읍면동 페이지로 갈 법정동코드
};

// ───────────────────────── 별칭표 ─────────────────────────
// 시도 표준 이름(우체국 DB의 '시도' 값) → 입력으로 받아들이는 표기. 수록 지역이 아닌 시도도 적어 두어 '수록 지역이 아닙니다'로 안내한다.
// 광주는 전남광주통합특별시로 합쳐졌다(광주광역시·전남·전라남도 표기를 여기로 모은다). '광주' 단독은 경기도 광주시와 겹쳐 따로 다룬다.
export const SIDO_ALIASES: Record<string, string[]> = {
  서울특별시: ['서울', '서울시', '서울특별시'],
  부산광역시: ['부산', '부산시', '부산광역시'],
  대구광역시: ['대구', '대구시', '대구광역시'],
  인천광역시: ['인천', '인천시', '인천광역시'],
  전남광주통합특별시: ['전남광주통합특별시', '전남광주', '광주광역시', '전남', '전라남도'],
  대전광역시: ['대전', '대전시', '대전광역시'],
  울산광역시: ['울산', '울산시', '울산광역시'],
  세종특별자치시: ['세종', '세종시', '세종특별자치시', '세종특별시'],
  경기도: ['경기', '경기도'],
  강원특별자치도: ['강원', '강원도', '강원특별자치도'],
  충청북도: ['충북', '충청북도'],
  충청남도: ['충남', '충청남도'],
  전북특별자치도: ['전북', '전라북도', '전북특별자치도'],
  경상북도: ['경북', '경상북도'],
  경상남도: ['경남', '경상남도'],
  제주특별자치도: ['제주', '제주도', '제주특별자치도'],
};
const SIDO_OF_ALIAS = new Map<string, string>();
for (const [canon, list] of Object.entries(SIDO_ALIASES)) for (const a of list) SIDO_OF_ALIAS.set(a, canon);
// 시도 이름과 시군구 이름이 모두 될 수 있어 단정하지 않는 단어
const AMBIGUOUS_REGION = new Set(['광주']);

// ───────────────────────── 이름 색인 ─────────────────────────
type Idx = {
  roads: Set<string>;
  areas: Set<string>; // 공백 없는 동·리 이름
  sg: Set<string>; // 시군구 토큰 ('성남시', '분당구')
  stems: Map<string, string[]>; // 시·군·구를 뗀 어근 → 토큰들 ('분당' → ['분당구']). 도로명·동 이름과 겹치는 어근은 뺀다
  stemsAll: Map<string, string[]>; // 겹치는 어근까지 모두 ('종로' → ['종로구'])
  maxLen: number;
};
const EMPTY_IDX: Idx = { roads: new Set(), areas: new Set(), sg: new Set(), stems: new Map(), stemsAll: new Map(), maxLen: 0 };
const IDX = new WeakMap<Names, Idx>();

function indexOf(names?: Names): Idx {
  if (!names) return EMPTY_IDX;
  const hit = IDX.get(names);
  if (hit) return hit;
  const roads = new Set(Object.keys(names.r));
  const areas = new Set(Object.keys(names.a).filter((k) => !k.includes(' ')));
  const sg = new Set<string>();
  for (const [, name] of names.c) for (const t of name.split(' ')) if (!SIDO_OF_ALIAS.has(t)) sg.add(t);
  const stems = new Map<string, string[]>();
  const stemsAll = new Map<string, string[]>();
  for (const t of sg) {
    if (t.length < 3 || !/[시군구]$/.test(t)) continue;
    const s = t.slice(0, -1);
    if (AMBIGUOUS_REGION.has(s)) continue;
    stemsAll.set(s, [...(stemsAll.get(s) ?? []), t]);
    if (roads.has(s) || areas.has(s)) continue; // 도로명·동 이름과 겹치는 어근은 기본으로 쓰지 않는다 (예: 종로, 일산동)
    stems.set(s, [...(stems.get(s) ?? []), t]);
  }
  let maxLen = 0;
  for (const s of [roads, areas, sg, stems.keys(), SIDO_OF_ALIAS.keys()]) for (const k of s) if (k.length > maxLen) maxLen = k.length;
  const idx: Idx = { roads, areas, sg, stems, stemsAll, maxLen };
  IDX.set(names, idx);
  return idx;
}

// ───────────────────────── 1. 정리 ─────────────────────────
type Cleaned = { text: string; parens: string[] };

/** 층·호·동 정보, 괄호, 불필요한 기호를 걷어 낸 입력. 괄호 안 내용은 따로 돌려준다. */
export function clean(q: string): Cleaned {
  let s = q.normalize('NFC').replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' '); // 전각 숫자·영문·기호는 반각으로 (로마 숫자 Ⅱ 등은 그대로)
  const parens: string[] = [];
  s = s.replace(/[(\[{（［【]([^)\]}）］】]*)[)\]}）］】]?/g, (_m, inner: string) => { parens.push(inner); return ' '; });
  s = s.replace(/[‐-―−–—~∼]/g, '-');
  s = s.replace(/(\d)\s*의\s*(\d)/g, '$1-$2'); // "12의 3" → "12-3"
  s = s.replace(/(\d+)\s*번지\s*(\d+)\s*호/g, '$1-$2'); // "123번지 4호" → "123-4"
  s = s.replace(/(?<![\d-])지하\s*\d+\s*층/g, ' ').replace(/(?<![\d-])\d+\s*층/g, ' '); // 층 (건물 번호가 아니다). '지하 6'(번호)은 층이 아니므로 남는다. 앞 숫자에 붙은 '543층'은 번호와 구분할 수 없어 지우지 않는다
  s = s.replace(/(?<![가-힣\d-])\d+\s*동\s*\d+\s*호(?:실)?/g, ' '); // 101동 1203호
  s = s.replace(/(?<![가-힣\d-])\d+\s*동(?![가-힣])/g, ' '); // 101동 (앞이 한글이면 '상계3동' 같은 행정동 이름이라 지키지 않는다)
  s = s.replace(/(?<![가-힣\d-])\d+\s*호(?:실)?(?![가-힣])/g, ' '); // 301호 (번지 호는 위에서 이미 처리). 앞 숫자에 붙은 '54301호'는 지우지 않는다
  s = s.replace(/(\d)\s*번지/g, '$1'); // "12번지" → "12"
  s = s.replace(/(\d)\s*-\s*(\d)/g, '$1-$2');
  s = s.replace(/(?!-)[\p{P}\p{S}]/gu, ' '); // 쉼표·마침표·가운뎃점 등 불필요한 기호 (로마 숫자 Ⅱ 같은 글자는 건물명 일치에 쓰므로 남긴다)
  s = s.replace(/(^|\s)-+|-+(?=\s|$)/g, '$1 '); // 홀로 있는 하이픈 (이름 속 하이픈 '진-하우스', '카운티-2' 는 지킨다)
  s = s.replace(/(로|길)\s+(\d+(?:번길|길))/g, '$1$2'); // "불정로 6번길" → "불정로6번길"
  return { text: s.replace(/\s+/g, ' ').trim(), parens };
}

/** 이전 버전과의 호환: 정리한 문자열만 돌려준다 */
export function normalize(q: string): string {
  return clean(q).text;
}

// ───────────────────────── 2. 이름 기반 분할 (공백 무시) ─────────────────────────
type UnitKind = 'road' | 'area' | 'sg' | 'sido' | 'ambig' | 'num' | 'unk';
type Unit = { kind: UnitKind; text: string; san?: number; under?: number; bon?: number; bu?: number; stem?: boolean; raw?: string };

type Cand = { end: number; unit: Unit };
const NUM_RE = /(산)?(지하)?(\d+)(?:-(\d+))?/y;

/**
 * 공백을 없앤 문자열에서 색인에 있는 이름(도로명·동·시군구·시도 별칭)과 번호를 찾아 나눈다.
 * - 이름은 입력의 공백 위치와 상관없이 합치거나 쪼갤 수 있다. 단, 토큰(띄어쓰기 단위) 하나가 알려진 이름과 번호로 남김없이 설명될 때만 쪼갠다.
 * - 숫자는 한 덩어리(예: 2130, 6-12)로만 읽는다. 숫자 사이의 공백은 지우지 않는다(6 12 는 번호 둘).
 * - 모르는 단어는 원래 띄어쓰기 단위(토큰) 그대로만 남긴다. 건물명 속 글자를 이름으로 오인해 쪼개지 않기 위해서다
 *   (그래서 건물명은 시군구와 띄어 써야 한다: "분당구 아이파크").
 * 여러 분할이 가능하면 (알려진 글자 수 ↑, 입력의 띄어쓰기를 어긴 횟수 ↓, 단위 수 ↓) 순으로 고른다.
 */
function scan(text: string, idx: Idx): Unit[] {
  const toks = text.split(' ').filter(Boolean);
  if (!toks.length) return [];
  let C = '';
  const tokStart = new Set<number>();
  const endOf: number[] = [];
  for (let k = 0; k < toks.length; k++) {
    if (k > 0 && /\d$/.test(toks[k - 1]) && /^\d/.test(toks[k])) C += ' '; // 숫자와 숫자 사이의 공백은 보존한다
    const s = C.length;
    tokStart.add(s);
    C += toks[k];
    for (let p = s; p < C.length; p++) endOf[p] = C.length;
  }
  const n = C.length;

  const knownAt = (i: number): Cand[] => {
    const out: Cand[] = [];
    if (/\d| /.test(C[i])) return out;
    const max = Math.min(idx.maxLen, n - i);
    for (let L = 2; L <= max; L++) {
      const sub = C.slice(i, i + L);
      if (sub.includes(' ')) break;
      if (idx.roads.has(sub)) out.push({ end: i + L, unit: { kind: 'road', text: sub } });
      if (idx.areas.has(sub)) out.push({ end: i + L, unit: { kind: 'area', text: sub } });
      const canon = SIDO_OF_ALIAS.get(sub);
      if (canon) out.push({ end: i + L, unit: { kind: 'sido', text: canon, raw: sub } });
      else if (idx.sg.has(sub)) out.push({ end: i + L, unit: { kind: 'sg', text: sub } });
      else if (AMBIGUOUS_REGION.has(sub)) out.push({ end: i + L, unit: { kind: 'ambig', text: sub } });
      else if (idx.stems.has(sub)) out.push({ end: i + L, unit: { kind: 'sg', text: sub, stem: true } });
    }
    return out;
  };

  type St = { cov: number; viol: number; units: number; prev?: St; unit?: Unit };
  const better = (a: St, b?: St) => !b || a.cov > b.cov || (a.cov === b.cov && (a.viol < b.viol || (a.viol === b.viol && a.units < b.units)));
  const best: (St | undefined)[] = new Array(n + 1).fill(undefined);
  best[0] = { cov: 0, viol: 0, units: 0 };
  const relax = (from: St, i: number, end: number, unit: Unit, known: boolean, viol: number) => {
    const next: St = { cov: from.cov + (known ? end - i : 0), viol: from.viol + viol, units: from.units + 1, prev: from, unit };
    if (better(next, best[end])) best[end] = next;
  };
  const endViol = (e: number) => (endOf[e - 1] === e ? 0 : 1); // 단위가 토큰 끝에서 끝나지 않으면 토큰 안을 쪼갠 것
  for (let i = 0; i < n; i++) {
    const cur = best[i];
    if (!cur) continue;
    if (C[i] === ' ') { if (better(cur, best[i + 1])) best[i + 1] = cur; continue; }
    const atStart = tokStart.has(i);
    for (const cd of knownAt(i)) relax(cur, i, cd.end, cd.unit, true, (atStart ? 0 : 1) + endViol(cd.end) + innerBreaks(cd.end, i, tokStart));
    NUM_RE.lastIndex = i;
    const m = NUM_RE.exec(C);
    if (m && m.index === i) {
      const unit: Unit = { kind: 'num', text: m[0], san: m[1] ? 1 : 0, under: m[2] ? 1 : 0, bon: Number(m[3]), bu: m[4] ? Number(m[4]) : 0 };
      const end = i + m[0].length;
      relax(cur, i, end, unit, true, (atStart ? 0 : 1) + endViol(end));
    }
    if (atStart) relax(cur, i, endOf[i], { kind: 'unk', text: C.slice(i, endOf[i]) }, false, 0);
  }
  const fin = best[n];
  if (!fin) return [{ kind: 'unk', text: C }];
  const units: Unit[] = [];
  for (let st: St | undefined = fin; st && st.unit; st = st.prev) units.push(st.unit);
  return units.reverse();
}

/** 알려진 이름이 입력의 띄어쓰기(토큰 경계)를 가로지른 횟수 */
function innerBreaks(end: number, start: number, tokStart: Set<number>): number {
  let c = 0;
  for (let p = start + 1; p < end; p++) if (tokStart.has(p)) c++;
  return c;
}

// 모르는 단어(색인에 없는 토큰)는 예전과 같은 접미사 규칙으로 분류한다
function classifyUnknown(t: string, p: Parsed): Unit[] {
  if (t === '지하' || t === '산') return [];
  const m = t.match(/^([가-힣A-Za-z0-9]*?[로길])(지하)?(\d+)(?:-(\d+))?$/);
  if (m && /[가-힣]/.test(m[1])) {
    return [{ kind: 'road', text: m[1] }, { kind: 'num', text: m[0].slice(m[1].length), under: m[2] ? 1 : 0, san: 0, bon: Number(m[3]), bu: m[4] ? Number(m[4]) : 0 }];
  }
  if (/^[가-힣A-Za-z0-9]+[로길]$/.test(t) && /[가-힣]/.test(t)) return [{ kind: 'road', text: t }];
  if (/[동읍면리가]$/.test(t) && t.length >= 2) return [{ kind: 'area', text: t }];
  if (/[시군구도]$/.test(t)) return [{ kind: 'sg', text: t }];
  p.text.push(t);
  return [{ kind: 'unk', text: t }];
}

export function parse(q: string, names?: Names): Parsed {
  const idx = indexOf(names);
  const { text, parens } = clean(q);
  const p: Parsed = { regionWords: [], sido: [], bu: 0, under: 0, san: 0, jbu: 0, text: [], hints: [] };
  const units = scan(text, idx);
  const nums: Unit[] = [];
  const shown: Unit[] = []; // 해석 문구에 쓸 단위
  const roadUnits: number[] = [], areaUnits: number[] = [];
  const add = (u: Unit) => {
    if (u.kind === 'num') nums.push(u);
    else if (u.kind === 'sido') { if (!p.sido.includes(u.text)) p.sido.push(u.text); }
    else if (u.kind === 'ambig') p.ambiguousRegion = u.text;
    else if (u.kind === 'sg') p.regionWords.push(u.text);
    else if (u.kind === 'road') roadUnits.push(shown.length);
    else if (u.kind === 'area') areaUnits.push(shown.length);
    shown.push(u);
  };
  for (const u of units) {
    if (u.kind === 'unk') classifyUnknown(u.text, p).forEach(add);
    else add(u);
  }
  // 도로·동은 번호와 붙어 있는 것을 우선한다(없으면 마지막 것). 예: "세검정로6길 54 종로" 에서 도로는 세검정로6길
  const firstNum = shown.findIndex((u) => u.kind === 'num');
  const pick = (list: number[]) => (list.length ? (firstNum >= 0 ? list.find((k) => k === firstNum - 1) ?? list.find((k) => k === firstNum + 1) : undefined) ?? list[list.length - 1] : undefined);
  // 번호와 붙어 있지 않은 도로 단어가 시군구 어근이기도 하면(예: '종로 옥인동 19-23', '종로 세검정로6길 54') 시군구로 본다
  const numAdj = (k: number) => firstNum >= 0 && (k === firstNum - 1 || k === firstNum + 1);
  const hasAdjOther = [...roadUnits, ...areaUnits].some(numAdj);
  for (const k of [...roadUnits]) {
    const u = shown[k];
    if (!numAdj(k) && idx.stemsAll.has(u.text) && (hasAdjOther || roadUnits.length > 1)) {
      shown[k] = { kind: 'sg', text: u.text, stem: true };
      p.regionWords.push(u.text);
      roadUnits.splice(roadUnits.indexOf(k), 1);
    }
  }
  const ri = pick(roadUnits), ai = pick(areaUnits);
  if (ri === undefined && ai === undefined) {
    // 건물명 질의: 앞에 지역 단어가 이미 있는데 다시 나온 시도 별칭은 건물명의 일부일 수 있다('경기도 시흥 경기 정밀')
    const first = shown.findIndex((u) => u.kind === 'sg' || u.kind === 'sido');
    shown.forEach((u, k) => {
      if (u.kind === 'sido' && first >= 0 && k > first && u.raw) { shown[k] = { kind: 'unk', text: u.raw }; p.text.push(u.raw); }
    });
    p.sido = shown.filter((u) => u.kind === 'sido').map((u) => u.text).filter((v, i, a) => a.indexOf(v) === i);
  }
  p.road = ri !== undefined ? shown[ri].text : undefined;
  p.areaWord = ai !== undefined ? shown[ai].text : undefined;
  if (p.ambiguousRegion && p.sido.length) { p.regionWords.push(p.ambiguousRegion); p.ambiguousRegion = undefined; } // "경기 광주": 시도가 있으면 시군구로 본다
  for (const u of nums) { if (u.san) p.san = 1; if (u.under) p.under = 1; }
  const real = nums.find((u) => u.bon !== undefined);
  if (real) {
    if (p.road) { p.bon = real.bon; p.bu = real.bu ?? 0; }
    else { p.jbon = real.bon; p.jbu = real.bu ?? 0; }
  }
  // 괄호 안 단어: 건물명 일치에 쓸 수 있게 보존한다 (도로·동·건물명이 입력에 없을 때만 사용)
  p.hints = parens.flatMap((x) => clean(x).text.split(' ')).filter((w) => w.length >= 2);
  if (!p.road && !p.areaWord && !p.text.length && p.hints.length) p.text = [...p.hints];

  // 입력과 다르게 해석했다면 그 해석을 한 줄로 알린다
  const rendered = shown
    .map((u) => {
      if (u.kind === 'num') return `${u.san ? '산 ' : ''}${u.under ? '지하 ' : ''}${u.bon}${u.bu ? '-' + u.bu : ''}`;
      if (u.kind === 'sg' && u.stem) { const full = idx.stemsAll.get(u.text); return full && full.length === 1 ? full[0] : u.text; }
      return u.text;
    })
    .filter(Boolean)
    .join(' ');
  const cmp = (x: string) => x.replace(/\s+/g, ' ').trim().replace(/(산|지하) (?=\d)/g, '$1');
  if (rendered && cmp(rendered) !== cmp(q.normalize('NFC'))) p.interpreted = rendered;
  return p;
}

// ───────────────────────── 3. 시군구 좁히기 ─────────────────────────
export type RegionResult = { indices: number[]; reason?: string };

const sidoList = (names: Names) => [...new Set(names.c.map((x) => x[2]))];

/** 입력에 든 지역·도로·동 이름으로 조회할 시군구(names.c 의 위치)를 좁힌다 */
export function resolveRegion(p: Parsed, names: Names): RegionResult {
  let cand = names.c.map((_, i) => i);
  const inRange = sidoList(names);
  for (const s of p.sido) {
    if (!inRange.includes(s)) return { indices: [], reason: `“${s}”은(는) 수록 지역이 아닙니다. 수록 지역(시험판): ${inRange.join(', ')}.` };
    cand = cand.filter((i) => names.c[i][2] === s);
  }
  const nameHas = (i: number, w: string) => {
    const [, sg, sido] = names.c[i];
    if (sido.startsWith(w) && w.length >= 2) return true;
    return sg.split(' ').some((x) => x === w || (w.length >= 2 && x.startsWith(w)));
  };
  for (const w of p.regionWords) {
    const next = cand.filter((i) => nameHas(i, w));
    if (!next.length) return { indices: [], reason: `“${w}”은(는) 수록 지역이 아니거나 이름을 찾을 수 없습니다. 수록 지역(시험판): ${inRange.join(', ')}.` };
    cand = next;
  }
  if (p.road) {
    const hit = new Set(names.r[p.road] ?? []);
    const next = cand.filter((i) => hit.has(i));
    if (!next.length) return { indices: [], reason: `“${p.road}”을(를) 선택한 지역에서 찾지 못했습니다. 도로명(예: 불정로, 불정로6번길)을 확인해 주세요.` };
    cand = next;
  }
  if (p.areaWord) {
    let hit = new Set(names.a[p.areaWord] ?? []);
    if (!hit.size) {
      for (const [k, v] of Object.entries(names.a)) if (k.startsWith(p.areaWord)) v.forEach((x) => hit.add(x));
    }
    const next = cand.filter((i) => hit.has(i));
    if (next.length) cand = next;
    else if (!p.road) return { indices: [], reason: `“${p.areaWord}”을(를) 찾지 못했습니다. 수록 지역이 아니거나 이름이 다를 수 있습니다.` };
  }
  return { indices: cand };
}

const no = (bon: number, bu: number) => (bu ? `${bon}-${bu}` : `${bon}`);

function areaIndexes(sh: Shard, word?: string): number[] {
  if (!word) return sh.areas.map((_, i) => i);
  return sh.areas.map((a, i) => ({ a, i })).filter(({ a }) => a[1].split(' ').some((t) => t === word || t.startsWith(word)) || a[1] === word).map((x) => x.i);
}

function roadSearchInner(sh: Shard, p: Parsed): { hits: Hit[]; note?: string } {
  const r = sh.roads[p.road!];
  if (!r) return { hits: [] };
  const sg = `${sh.sido} ${sh.name}`.replace(sh.sido === sh.name ? sh.sido + ' ' : '', '');
  const wantArea = p.areaWord ? new Set(areaIndexes(sh, p.areaWord)) : null;
  const b = r.b ?? [];

  if (p.bon === undefined) {
    // 번호 없이 도로명만: 이 도로가 속한 우편번호와 번호 범위를 요약한다
    const g = new Map<string, { n: number; min: [number, number]; max: [number, number] }>();
    for (let i = 0; i < b.length; i += 5) {
      if (wantArea && !wantArea.has(b[i + 4])) continue;
      const z = sh.zips[b[i + 3]];
      const cur = g.get(z) ?? { n: 0, min: [b[i], b[i + 1]], max: [b[i], b[i + 1]] };
      cur.n++;
      if (b[i] < cur.min[0] || (b[i] === cur.min[0] && b[i + 1] < cur.min[1])) cur.min = [b[i], b[i + 1]];
      if (b[i] > cur.max[0] || (b[i] === cur.max[0] && b[i + 1] > cur.max[1])) cur.max = [b[i], b[i + 1]];
      g.set(z, cur);
    }
    return {
      hits: [...g].sort((a, c) => c[1].n - a[1].n).map(([zip, v]) => ({
        level: 'road' as Level, zip, code: sh.code, title: `${sg} ${p.road}`,
        sub: `이 도로의 건물 ${v.n.toLocaleString('ko-KR')}건 (${no(...v.min)} ~ ${no(...v.max)}번). 번호를 함께 넣으면 한 곳으로 좁혀집니다.`,
      })),
    };
  }

  // 1) 건물 일치
  const exact = new Map<string, Hit>();
  for (let i = 0; i < b.length; i += 5) {
    if (b[i] !== p.bon || b[i + 1] !== p.bu || b[i + 2] !== p.under) continue;
    if (wantArea && !wantArea.has(b[i + 4])) continue;
    const z = sh.zips[b[i + 3]];
    const area = sh.areas[b[i + 4]];
    const key = z + '|' + b[i + 4];
    if (exact.has(key)) continue;
    const names = sh.bn.filter((x) => x[1] === p.road && x[2] === p.bon && x[3] === p.bu && x[5] === b[i + 4]).map((x) => x[0]);
    exact.set(key, {
      level: 'exact', zip: z, code: sh.code, emd: area[0],
      title: `${sg} ${p.road} ${p.under ? '지하 ' : ''}${no(p.bon, p.bu)}`,
      sub: `${area[1]}${names.length ? ' · ' + names.join(', ') : ''}`,
    });
  }
  let note: string | undefined;
  if (!exact.size && wantArea) {
    // 입력한 동 이름과 맞지 않으면 동 조건을 빼고 다시 찾는다 (행정동·통칭 입력 대비)
    const again = roadSearchInner(sh, { ...p, areaWord: undefined });
    if (again.hits.length) return { hits: again.hits, note: `입력한 “${p.areaWord}”은(는) 이 주소의 법정동과 달라 동 조건 없이 찾았습니다.` };
  }
  if (exact.size) return { hits: [...exact.values()], note };

  // 2) 범위 기준
  const rr = r.r ?? [];
  const allowedEmds = wantArea && wantArea.size ? new Set([...wantArea].map((ai) => sh.areas[ai][2])) : null;
  const zs = new Map<string, string>();
  for (let i = 0; i < rr.length; i += 8) {
    const [sb, sbu, eb, ebu, u, kind, z, e] = rr.slice(i, i + 8);
    if (u !== p.under) continue;
    if (allowedEmds && !allowedEmds.has(sh.emds[e])) continue; // 동 이름을 입력했으면 그 동이 속한 읍면(동이면 빈 값)의 범위만 본다
    if (kind === 1 && p.bon % 2 === 0) continue;
    if (kind === 2 && p.bon % 2 === 1) continue;
    const lo = sb * 1e5 + sbu, hi = eb * 1e5 + ebu, v = p.bon * 1e5 + p.bu;
    if (v >= lo && v <= hi) zs.set(sh.zips[z], sh.emds[e]);
  }
  return {
    hits: [...zs].map(([zip, emd]) => ({
      level: 'range' as Level, zip, code: sh.code,
      title: `${sg} ${p.road} ${p.under ? '지하 ' : ''}${no(p.bon!, p.bu)}`,
      sub: `우편번호 DB에 이 번호의 건물은 없고, 우체국 범위주소(참고자료)의 범위 안에 들어갑니다${emd ? ` · ${emd}` : ''}.`,
    })),
  };
}

function roadSearch(sh: Shard, p: Parsed): { hits: Hit[]; note?: string } {
  const r = roadSearchInner(sh, p);
  if (!r.hits.length && p.bon !== undefined && !p.under) {
    // 지상에서 못 찾으면 지하 건물일 수 있어 한 번 더 찾는다
    const u = roadSearchInner(sh, { ...p, under: 1 });
    if (u.hits.length) return { hits: u.hits, note: '“지하”를 붙이지 않았지만 지하 건물 번호로 찾았습니다.' };
  }
  return r;
}

function jibunSearch(sh: Shard, p: Parsed): Hit[] {
  const sg = `${sh.sido} ${sh.name}`.replace(sh.sido === sh.name ? sh.sido + ' ' : '', '');
  const ais = areaIndexes(sh, p.areaWord);
  const out: Hit[] = [];
  for (const ai of ais) {
    const label = sh.areas[ai][1];
    if (p.jbon === undefined) {
      out.push({ level: 'area', zip: '', code: sh.code, emd: sh.areas[ai][0], title: `${sg} ${label}`, sub: '번지까지 넣으면 우편번호를 찾습니다 (예: 123-4).' });
      continue;
    }
    const j = sh.j[String(ai)] ?? [];
    const exact = new Set<string>();
    for (let i = 0; i < j.length; i += 4) if (j[i] === p.san && j[i + 1] === p.jbon && j[i + 2] === p.jbu) exact.add(sh.zips[j[i + 3]]);
    const title = `${sg} ${label} ${p.san ? '산 ' : ''}${no(p.jbon, p.jbu)}`;
    if (exact.size) { for (const zip of exact) out.push({ level: 'exact', zip, code: sh.code, emd: sh.areas[ai][0], title, sub: exact.size > 1 ? '한 번지에 우편번호가 둘 이상입니다(건물에 따라 다름).' : undefined }); continue; }
    const jr = sh.jr[String(ai)] ?? [];
    const rz = new Set<string>();
    const v = p.jbon * 1e5 + p.jbu;
    for (let i = 0; i < jr.length; i += 6) {
      if (jr[i] !== p.san) continue;
      if (v >= jr[i + 1] * 1e5 + jr[i + 2] && v <= jr[i + 3] * 1e5 + jr[i + 4]) rz.add(sh.zips[jr[i + 5]]);
    }
    for (const zip of rz) out.push({ level: 'range', zip, code: sh.code, emd: sh.areas[ai][0], title, sub: '우편번호 DB에 이 번지의 건물은 없고, 우체국 범위주소(참고자료)의 범위 안에 들어갑니다.' });
  }
  return out;
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');

function nameSearch(sh: Shard, words: string[]): Hit[] {
  const w = words.map((x) => x.toLowerCase());
  const joined = squash(words.join(''));
  const sg = `${sh.sido} ${sh.name}`.replace(sh.sido === sh.name ? sh.sido + ' ' : '', '');
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const [name, road, bon, bu, zi, ai] of sh.bn) {
    const hay = (name + ' ' + sh.areas[ai][1]).toLowerCase();
    // 단어마다 포함되거나, 공백을 무시하고 이어 붙인 입력이 포함되면 일치로 본다 ("글로리빌" ↔ DB의 "글로리 빌")
    if (!w.every((x) => hay.includes(x)) && !squash(name).includes(joined)) continue;
    const key = `${name}|${road}|${bon}|${bu}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ level: 'name', zip: sh.zips[zi], code: sh.code, emd: sh.areas[ai][0], title: `${name} — ${sg} ${road} ${no(bon, bu)}`, sub: sh.areas[ai][1] });
    if (out.length >= 30) break;
  }
  return out;
}

/** 건물명만 입력했는데 시군구가 앞에 붙어 있으면(예: 분당구아이파크) 띄어 쓴 형태를 제안한다 */
function nameOnlyMessage(parsed: Parsed, names: Names): string {
  const idx = indexOf(names);
  for (const t of parsed.text) {
    for (let L = Math.min(t.length - 2, idx.maxLen); L >= 3; L--) {
      const head = t.slice(0, L);
      if (idx.sg.has(head)) return `혹시 “${head} ${t.slice(L)}”을(를) 찾으시나요? 건물명은 시·군·구와 띄어서 입력해 주세요.`;
    }
  }
  return '건물명으로 찾으려면 시·군·구를 함께 입력해 주세요. 예: 분당구 아이파크';
}

export type SearchOutcome = { hits: Hit[]; message?: string; notes: string[]; shardsNeeded: string[] };

export type Choice = { code: string; label: string };
export type PlanResult = { parsed: Parsed; codes: string[]; message?: string; choices?: Choice[]; interpreted?: string };

const MAX_SHARDS = 8; // 한 번에 내려받는 조각 수의 상한
const MAX_CHOICES = 30;

/** 어느 조각을 내려받아야 하는지 정한다. 시군구가 정해지지 않으면 임의로 고르지 않고 후보(choices)를 돌려준다. */
export function plan(q: string, names: Names, opts: { pin?: string } = {}): PlanResult {
  const parsed = parse(q, names);
  const interpreted = parsed.interpreted;
  const base = { parsed, interpreted };
  const hasAny = parsed.road || parsed.areaWord || parsed.text.length;
  const hasRegion = parsed.regionWords.length > 0;
  if (!hasAny) {
    return { ...base, codes: [], message: hasRegion || parsed.sido.length ? '도로명이나 동 이름을 함께 입력해 주세요. 예: 분당구 불정로 6' : '' };
  }
  const reg = resolveRegion(parsed, names);
  if (!reg.indices.length) {
    // 도로·동 없이 건물명만 입력한 경우: 지역 단어가 없으면 조각을 고를 수 없다
    if (!parsed.road && !parsed.areaWord && !hasRegion && !parsed.sido.length) return { ...base, codes: [], message: nameOnlyMessage(parsed, names) };
    return { ...base, codes: [], message: reg.reason };
  }
  let idxs = reg.indices;
  const label = (i: number) => (names.c[i][1] === names.c[i][2] ? names.c[i][1] : `${names.c[i][2]} ${names.c[i][1]}`);
  if (opts.pin) {
    const k = idxs.find((i) => names.c[i][0] === opts.pin);
    if (k === undefined) return { ...base, codes: [], message: '선택한 시·군·구에서는 입력한 도로·동을 찾지 못했습니다.' };
    return { ...base, codes: [opts.pin] };
  }
  const nameOnly = !parsed.road && !parsed.areaWord;
  // 광주처럼 시도와 시군구가 겹치는 단어는 단정하지 않는다
  if (parsed.ambiguousRegion && !hasRegion) {
    const only = names.c.map((_, i) => i).filter((i) => names.c[i][1].startsWith(parsed.ambiguousRegion!) && idxs.includes(i));
    if (only.length) {
      return { ...base, codes: [], choices: only.map((i) => ({ code: names.c[i][0], label: label(i) })), message: `“${parsed.ambiguousRegion}”은(는) 광주광역시일 수도 있습니다. 광주광역시는 수록 지역이 아닙니다. 찾는 곳이 아래라면 골라 주세요.` };
    }
    return { ...base, codes: [], message: `“${parsed.ambiguousRegion}”은(는) 수록 지역이 아닙니다.` };
  }
  if (nameOnly && !hasRegion && idxs.length > MAX_SHARDS) {
    return { ...base, codes: [], message: nameOnlyMessage(parsed, names) };
  }
  if (idxs.length > 1 && !hasRegion) {
    // 시군구를 입력하지 않았는데 여러 시군구에 같은 도로·동이 있다: 임의로 고르지 않고 후보를 보여 준다
    const shown = idxs.slice(0, MAX_CHOICES);
    const extra = idxs.length - shown.length;
    return {
      ...base, codes: [],
      choices: shown.map((i) => ({ code: names.c[i][0], label: label(i) })),
      message: `같은 이름이 ${idxs.length}개 시·군·구에 있습니다. 찾는 곳을 골라 주세요${extra > 0 ? ` (앞의 ${shown.length}곳만 표시, 시·군·구를 함께 입력하면 좁혀집니다)` : ''}.`,
    };
  }
  if (idxs.length > MAX_SHARDS) {
    return { ...base, codes: [], message: `조건에 맞는 시·군·구가 ${idxs.length}곳입니다. 시·군·구 이름을 함께 입력해 주세요. 예: 분당구 ${parsed.road ?? parsed.areaWord ?? ''}`.trim() };
  }
  return { ...base, codes: idxs.map((i) => names.c[i][0]) };
}

export function searchShards(parsed: Parsed, shards: Shard[]): SearchOutcome {
  const notes: string[] = [];
  let hits: Hit[] = [];
  for (const sh of shards) {
    if (parsed.road) {
      const r = roadSearch(sh, parsed);
      hits.push(...r.hits);
      if (r.note) notes.push(r.note);
    } else if (parsed.areaWord) {
      hits.push(...jibunSearch(sh, parsed));
    } else if (parsed.text.length) {
      hits.push(...nameSearch(sh, parsed.text));
    }
  }
  // 정확한 것(건물·번지 일치)을 앞에 둔다
  const order: Record<Level, number> = { exact: 0, name: 1, range: 2, road: 3, area: 4 };
  hits = hits.sort((a, b) => order[a.level] - order[b.level]);
  return { hits, notes, shardsNeeded: shards.map((s) => s.code) };
}

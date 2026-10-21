// 주소 → 우편번호 조회 (브라우저에서 실행되는 순수 함수 모음)
// 입력: 시군구별 조각(shard)과 이름 색인(names). 만드는 쪽: data/notebooks/02_build_address_index_v1.ipynb
// 이 파일의 조회 규칙은 노트북 5절의 road_lookup / jibun_lookup 과 같아야 한다 (노트북이 전수 대조한 규칙).

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
  regionWords: string[];
  road?: string;
  bon?: number;
  bu: number;
  under: number;
  areaWord?: string;
  san: number;
  jbon?: number;
  jbu: number;
  text: string[];
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

const SHORT_SIDO = new Set([
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주', '전남광주',
]);

export function normalize(q: string): string {
  let s = q.normalize('NFC');
  s = s.replace(/[‐-―−–—~]/g, '-');
  s = s.replace(/[(),·，]/g, ' ');
  s = s.replace(/(\d)\s*의\s*(\d)/g, '$1-$2');
  s = s.replace(/(\d)\s*(번지|호)(?![가-힣])/g, '$1'); // "12호" 의 단위만 지우고 "12 호매실동" 의 동 이름은 지키지 않도록 뒤가 한글이면 둔다
  s = s.replace(/(로|길)\s+(\d+(?:번길|길))/g, '$1$2'); // "불정로 6번길" → "불정로6번길"
  return s.replace(/\s+/g, ' ').trim();
}

export function parse(q: string): Parsed {
  const p: Parsed = { regionWords: [], bu: 0, under: 0, san: 0, jbu: 0, text: [] };
  const nums: [number, number][] = [];
  let pendingUnder = false;
  let pendingSan = false;
  for (const t of normalize(q).split(' ').filter(Boolean)) {
    if (t === '지하') { pendingUnder = true; continue; }
    if (t === '산') { pendingSan = true; continue; }
    let m = t.match(/^(산)?(지하)?(\d+)(?:-(\d+))?$/);
    if (m) {
      if (m[1] || pendingSan) p.san = 1;
      if (m[2] || pendingUnder) p.under = 1;
      pendingSan = pendingUnder = false;
      nums.push([Number(m[3]), m[4] ? Number(m[4]) : 0]);
      continue;
    }
    m = t.match(/^([가-힣A-Za-z0-9]*?[로길])(지하)?(\d+)(?:-(\d+))?$/);
    if (m && /[가-힣]/.test(m[1])) {
      p.road = m[1];
      if (m[2] || pendingUnder) p.under = 1;
      pendingUnder = false;
      nums.push([Number(m[3]), m[4] ? Number(m[4]) : 0]);
      continue;
    }
    if (/^[가-힣A-Za-z0-9]+[로길]$/.test(t) && /[가-힣]/.test(t)) { p.road = t; continue; }
    if (/[동읍면리가]$/.test(t) && t.length >= 2) { p.areaWord = t; continue; }
    if (/[시군구도]$/.test(t) || SHORT_SIDO.has(t)) { p.regionWords.push(t); continue; }
    p.text.push(t);
  }
  if (nums.length) {
    const [a, b] = nums[0];
    if (p.road) { p.bon = a; p.bu = b; }
    else { p.jbon = a; p.jbu = b; }
  }
  return p;
}

export type RegionResult = { indices: number[]; reason?: string };

/** 입력에 든 지역·도로·동 이름으로 조회할 시군구(names.c 의 위치)를 좁힌다 */
export function resolveRegion(p: Parsed, names: Names): RegionResult {
  let cand = names.c.map((_, i) => i);
  const nameHas = (i: number, w: string) => {
    const [, sg, sido] = names.c[i];
    if (sido.startsWith(w) && w.length >= 2) return true;
    return sg.split(' ').some((x) => x === w || (w.length >= 2 && x.startsWith(w)));
  };
  for (const w of p.regionWords) {
    const next = cand.filter((i) => nameHas(i, w));
    if (!next.length) return { indices: [], reason: `“${w}”은(는) 시험판에 수록되지 않은 지역이거나 이름을 찾을 수 없습니다.` };
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
    else if (!p.road) return { indices: [], reason: `“${p.areaWord}”을(를) 찾지 못했습니다. 시험판에 수록되지 않은 지역일 수 있습니다.` };
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

function nameSearch(sh: Shard, words: string[]): Hit[] {
  const w = words.map((x) => x.toLowerCase());
  const sg = `${sh.sido} ${sh.name}`.replace(sh.sido === sh.name ? sh.sido + ' ' : '', '');
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const [name, road, bon, bu, zi, ai] of sh.bn) {
    const hay = (name + ' ' + sh.areas[ai][1]).toLowerCase();
    if (!w.every((x) => hay.includes(x))) continue;
    const key = `${name}|${road}|${bon}|${bu}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ level: 'name', zip: sh.zips[zi], code: sh.code, emd: sh.areas[ai][0], title: `${name} — ${sg} ${road} ${no(bon, bu)}`, sub: sh.areas[ai][1] });
    if (out.length >= 30) break;
  }
  return out;
}

export type SearchOutcome = { hits: Hit[]; message?: string; notes: string[]; shardsNeeded: string[] };

/** 어느 조각을 내려받아야 하는지 정한다 */
export function plan(q: string, names: Names): { parsed: Parsed; codes: string[]; message?: string } {
  const parsed = parse(q);
  const hasAny = parsed.road || parsed.areaWord || parsed.text.length;
  if (!hasAny) {
    return { parsed, codes: [], message: parsed.regionWords.length ? '도로명이나 동 이름을 함께 입력해 주세요. 예: 분당구 불정로 6' : '' };
  }
  const reg = resolveRegion(parsed, names);
  if (!reg.indices.length) {
    // 도로·동 없이 건물명만 입력한 경우: 지역 단어가 없으면 조각을 고를 수 없다
    if (!parsed.road && !parsed.areaWord && !parsed.regionWords.length) return { parsed, codes: [], message: '건물명으로 찾으려면 시·군·구를 함께 입력해 주세요. 예: 분당구 아이파크' };
    return { parsed, codes: [], message: reg.reason };
  }
  if (!parsed.road && !parsed.areaWord && !parsed.regionWords.length) {
    return { parsed, codes: [], message: '건물명으로 찾으려면 시·군·구를 함께 입력해 주세요. 예: 분당구 아이파크' };
  }
  if (reg.indices.length > 8) {
    return { parsed, codes: [], message: `조건에 맞는 시·군·구가 ${reg.indices.length}곳입니다. 시·군·구 이름을 함께 입력해 주세요. 예: 분당구 ${parsed.road ?? parsed.areaWord ?? ''}`.trim() };
  }
  return { parsed, codes: reg.indices.map((i) => names.c[i][0]) };
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

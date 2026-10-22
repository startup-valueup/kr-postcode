// 빌드 시점에 data/processed/ 의 가공 결과를 읽는다 (노트북 01_build_subset 의 출력).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.KRPC_PROCESSED ?? path.resolve(process.cwd(), '../../data/processed');

export interface Share {
  code?: string;
  name: string;
  n: number;
  share: number;
  hdong?: string[];
}
export interface ZipRec {
  zip: string;
  sido: string;
  grade: string;
  source: { db: string; zone: string };
  has_address: boolean;
  has_polygon: boolean;
  n_addr: number;
  n_road?: number;
  note?: string;
  sigungu?: Share[];
  emd?: Share[];
  hdong?: Share[];
  roads?: { name: string; n: number }[];
  flags?: { multi_sigungu: boolean; multi_emd: boolean; multi_hdong: boolean; hdong_blank_share: number; primary_emd_share: number };
  primary_sigungu: { code: string | null; name: string };
  geo?: { area_km2: number; center: [number, number]; bbox: [number, number, number, number]; polygon: { type: string; coordinates: any } };
  zone?: { created_or_changed: string; reason: string; notified: string };
}
/** 법정 읍면동 = 법정동코드 앞 8자리 묶음 (노트북 01 v2 의 emd8.json). 읍·면은 리를 ris 로 갖고, 동은 ris 가 비어 있다. */
export interface EmdRi {
  code: string; // 법정동코드 10자리
  name: string; // 리 이름
  n_addr: number;
  zips: { zip: string; n: number }[];
}
export interface EmdGroup {
  code: string; // 법정동코드 앞 8자리 (URL 에 쓴다)
  name: string; // 읍·면이면 읍면 이름, 동이면 법정동명
  sigungu_code: string;
  n_addr: number;
  zips: { zip: string; n: number; share_of_emd: number }[];
  ris: EmdRi[];
}
export interface SigunguRec {
  code: string;
  name: string;
  n_zip: number;
  n_addr: number;
  zips: string[];
  sidoCode: string;
  sidoName: string;
}
export interface SidoRec {
  code: string;
  name: string;
  sigungu: SigunguRec[];
  cities: { name: string; sigungu: SigunguRec[] }[];
}

let cache: any = null;

function readJson<T = any>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
}

export function load() {
  if (cache) return cache as ReturnType<typeof build>;
  cache = build();
  return cache as ReturnType<typeof build>;
}

function build() {
  const meta = readJson('meta.json');
  const hierarchy = readJson<{ sido: string; sigungu: any[] }[]>('hierarchy.json');
  const emdGroups = readJson<EmdGroup[]>('emd8.json');

  const zips = new Map<string, ZipRec>();
  for (const f of fs.readdirSync(path.join(ROOT, 'zips')).sort()) {
    if (!f.endsWith('.json')) continue;
    const r = readJson<ZipRec>(`zips/${f}`);
    zips.set(r.zip, r);
  }

  const sidos: SidoRec[] = hierarchy.map((h) => {
    const code = h.sigungu[0].code.slice(0, 2);
    const sigungu: SigunguRec[] = h.sigungu.map((s) => ({ ...s, sidoCode: code, sidoName: h.sido }));
    const cityMap = new Map<string, SigunguRec[]>();
    for (const s of sigungu) {
      const city = s.name.includes(' ') ? s.name.split(' ')[0] : s.name;
      if (!cityMap.has(city)) cityMap.set(city, []);
      cityMap.get(city)!.push(s);
    }
    return { code, name: h.sido, sigungu, cities: [...cityMap].map(([name, sg]) => ({ name, sigungu: sg })) };
  });
  const sigunguByCode = new Map<string, SigunguRec>();
  for (const s of sidos) for (const g of s.sigungu) sigunguByCode.set(g.code, g);

  const emdGroupByCode = new Map<string, EmdGroup>(emdGroups.map((e) => [e.code, e]));

  return { meta, sidos, sigunguByCode, zips, emdGroupByCode, emdGroups };
}

/** 좌표(경위도)를 SVG 평면으로 옮기는 간단한 변환: 위도 보정 후 등장방형. */
export function makeProjector(bbox: [number, number, number, number], width: number, pad = 8) {
  const [w, s, e, n] = bbox;
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const spanX = (e - w) * k;
  const spanY = n - s;
  const scale = (width - pad * 2) / spanX;
  const height = Math.round(spanY * scale + pad * 2);
  const proj = (lon: number, lat: number): [number, number] => [pad + (lon - w) * k * scale, pad + (n - lat) * scale];
  return { proj, width, height };
}

export function ringsToPath(coords: any, type: string, proj: (lon: number, lat: number) => [number, number]) {
  const polys = type === 'MultiPolygon' ? coords : [coords];
  const fmt = (v: number) => (Math.round(v * 10) / 10).toString();
  let d = '';
  for (const poly of polys) {
    for (const ring of poly) {
      ring.forEach((pt: number[], i: number) => {
        const [x, y] = proj(pt[0], pt[1]);
        d += (i === 0 ? 'M' : 'L') + fmt(x) + ' ' + fmt(y);
      });
      d += 'Z';
    }
  }
  return d;
}

export const pct = (v: number) => (v >= 0.995 ? '100%' : v < 0.001 ? '<0.1%' : (v * 100).toFixed(v < 0.1 ? 1 : 0) + '%');
export const num = (v: number) => v.toLocaleString('ko-KR');
export const fmtDate = (s: string) => (s && s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s);

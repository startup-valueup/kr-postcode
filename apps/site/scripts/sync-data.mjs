// 빌드 전에 검색 색인을 public/ 으로 복사한다 (브라우저 검색이 /zip_index.json 을 읽음).
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.KRPC_PROCESSED ?? path.resolve(process.cwd(), '../../data/processed');
const src = path.join(root, 'zip_index.json');
if (!fs.existsSync(src)) {
  console.error(`[sync-data] ${src} 가 없습니다. data/notebooks/01_build_subset_v1.ipynb 를 먼저 실행하세요.`);
  process.exit(1);
}
fs.mkdirSync('public', { recursive: true });
fs.copyFileSync(src, path.join('public', 'zip_index.json'));
console.log('[sync-data] zip_index.json 복사 완료');

// 주소 조회 조각 (data/processed/addr → public/addr)
const addrSrc = path.join(root, 'addr');
if (!fs.existsSync(path.join(addrSrc, 'names.json'))) {
  console.error(`[sync-data] ${addrSrc}/names.json 이 없습니다. data/notebooks/02_build_address_index_v1.ipynb 를 먼저 실행하세요.`);
  process.exit(1);
}
fs.rmSync(path.join('public', 'addr'), { recursive: true, force: true });
fs.cpSync(addrSrc, path.join('public', 'addr'), { recursive: true });
fs.rmSync(path.join('public', 'addr', 'meta.json'), { force: true });
console.log('[sync-data] addr/ 복사 완료');

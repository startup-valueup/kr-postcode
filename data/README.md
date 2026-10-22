# data/

| 폴더 | 내용 | Git |
|---|---|---|
| `raw_gz/` | 원본의 압축본(파일별 `.gz`, 약 170MB). 전국 16개 시도 주소 DB, 범위·사서함·변경분, 전국 16개 시도 SHP | 포함 (**비공개 저장소 전제**) |
| `raw/` | `raw_gz/`를 풀어 쓰는 작업 폴더 | 제외 (`.gitignore`) |
| `notebooks/` | 가공 노트북 (`01_build_subset_v1.ipynb` 우편번호 요약, `02_build_address_index_v1.ipynb` 주소 조회 색인) | 포함 |
| `processed/` | 사이트가 읽는 가공 결과(JSON, GeoJSON)와 점검 엑셀 | 포함 |

원본 풀기: `cd data && mkdir -p raw && cp -r raw_gz/. raw/ && find raw -name '*.gz' -exec gunzip {} +`

`raw/` 배치(노트북이 파일 이름 패턴으로 찾음. 현재 SHP 폴더는 `zone30`, `zone36`, `zone41`처럼 시도별로 나뉘어 있어도 된다):

```
raw/zipcode_DB/세종특별자치시.txt, 대전광역시.txt, 경기도.txt ...   # 지역별 주소 DB
raw/rangeaddr/20261013_도로명범위.txt, 20261013_지번범위.txt
raw/pobox/20261013_사서함.txt
raw/chgaddr/20261013_변경분.txt
raw/zone/TL_KODIS_BAS_{36,30,41}_202610.shp (+ .dbf .shx .prj .cpg)  # 하위 폴더 무관
```

환경변수 `KRPC_RAW`, `KRPC_OUT`으로 입력·출력 위치를 바꿀 수 있다 (기본: `data/raw`, `data/processed`).

## processed/addr/ (주소 → 우편번호 조회 색인, 노트북 02)

시군구별 조각 `{시군구코드}.json` 과 이름 색인 `names.json`. 숫자는 정수 배열로 납작하게 펼쳐 둔다.

| 키 | 내용 |
|---|---|
| `zips` | 우편번호 목록 (아래 번호는 모두 이 목록의 위치) |
| `emds`, `areas` | 읍면 이름 목록 / `[법정동코드, 이름, 읍면]` 목록 |
| `roads[도로명].b` | 건물: `본번, 부번, 지하, 우편번호, 지역` 5개씩 |
| `roads[도로명].r` | 범위주소: `시작본, 시작부, 끝본, 끝부, 지하, 종류, 우편번호, 읍면` 8개씩 (종류 0 해당주소 1 홀 2 짝 3 전체) |
| `bn` | 건물명 `[이름, 도로명, 본번, 부번, 우편번호, 지역]` |
| `j[지역]`, `jr[지역]` | 지번 `산, 본번, 부번, 우편번호` / 지번 범위 `산, 시작본, 시작부, 끝본, 끝부, 우편번호` |

- 조회 규칙은 노트북 5절과 `apps/site/src/lib/addr.ts`가 같다. 노트북이 DB의 모든 건물을 다시 조회해 전수 대조한다.
- 선택 지역(16개 시군구)은 약 10MB다. 전국은 시군구 약 250개·수백 MB로 커지므로 저장소에 올리지 않고 빌드 때 만드는 방식으로 바꿔야 한다.
- 이름 색인(`names.json`)은 전국에서 수 MB가 되므로 그때 분할 방식을 다시 정한다.

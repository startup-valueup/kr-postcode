# data/

| 폴더 | 내용 | Git |
|---|---|---|
| `raw/` | 원본(우체국 우편번호 DB, 범위·사서함·변경분, 국가기초구역 SHP) | 제외 (`.gitignore`) |
| `notebooks/` | 가공 노트북 (`01_build_subset_v1.ipynb`) | 포함 |
| `processed/` | 사이트가 읽는 가공 결과(JSON, GeoJSON)와 점검 엑셀 | 포함 |

`raw/` 배치(노트북이 파일 이름 패턴으로 찾음):

```
raw/zipcode_DB/세종특별자치시.txt, 대전광역시.txt, 경기도.txt ...   # 지역별 주소 DB
raw/rangeaddr/20261013_도로명범위.txt, 20261013_지번범위.txt
raw/pobox/20261013_사서함.txt
raw/chgaddr/20261013_변경분.txt
raw/zone/TL_KODIS_BAS_{36,30,41}_202610.shp (+ .dbf .shx .prj .cpg)  # 하위 폴더 무관
```

환경변수 `KRPC_RAW`, `KRPC_OUT`으로 입력·출력 위치를 바꿀 수 있다 (기본: `data/raw`, `data/processed`).

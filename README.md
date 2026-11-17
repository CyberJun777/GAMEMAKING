# 프리즘 링 — 랜덤 타워 디펜스

스타2 아케이드 "랜덤타워디펜스" 방식(랜덤 뽑기 · 같은 유닛 2기 합성 · 진영 업그레이드 · 라운드 보스)의 오리지널 브라우저 게임. Three.js, 빌드 도구 없음.

## 실행
```bash
python3 -m http.server 8765
```
브라우저에서 http://localhost:8765 열기.

## 조작
| 키 | 동작 |
|---|---|
| D | 뽑기 (광물 50) |
| F | 선택 유닛 합성 (같은 유닛 2기 → 상위 등급 랜덤) |
| G | 선택 유닛 판매 |
| 1 / 2 / 3 | 기계 / 생체 / 비전 업그레이드 |
| Z / X / C | 미션 보스 1 / 2 / 3 |
| 클릭 · 빈 곳 드래그 · 더블클릭 | 선택 |
| 유닛 끌어다 놓기 / 우클릭 | 유닛 이동 |
| 방향키 · 휠 | 카메라 이동 · 줌 |
| Space / Tab | 일시정지 / 배속 (상단 버튼으로도) |
| M | 효과음 켜기/끄기 |

길 위 몬스터가 70마리가 되면 패배, 40라운드 보스를 잡으면 승리.

## 테스트
```bash
npm test               # 시뮬레이션 25개 (Node)
npm run test:browser   # 브라우저 24개 (Playwright, 서버 먼저 실행)
npm run balance        # 봇 6판 밸런스 측정
```

## 구조
- `design/plan.md` 기획서 · `progress.txt` 검수 로그
- `js/config.js` 모든 수치 · `js/sim/` 시뮬레이션(렌더 무관) · `js/render/` Three.js · `js/ui/` HUD
- `.claude/skills/` 게임 제작 스킬 3종 (game-blueprint → self-check → game-texture)

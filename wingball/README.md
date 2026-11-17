# 윙볼 (WINGBALL)

빗자루를 타고 코멧볼을 링에 꽂는 3D 공중 구기 게임. 골든 오브를 잡으면 +100점과 함께 경기 종료.

## 실행
ES 모듈이라 파일 더블클릭 대신 로컬 서버로 연다 (빌드 도구 없음).

```bash
cd wingball
python3 -m http.server 8123
```
브라우저에서 http://localhost:8123 → 난이도 선택 → 경기 시작 → 화면 클릭(마우스 조준).

## 조작
마우스/방향키 조준 · W/S 전진/감속 · A/D 좌우 · Space/C 상승/하강 · Shift 부스트 ·
좌클릭(홀드) 또는 F 슛 · E 패스 · 우클릭 태클 · Tab 러너↔헌터 · Q 볼/오브 보기 · P 일시정지

## 테스트
```bash
node tests/sim.test.mjs                 # headless 경기 로직 32개
python3 -m http.server 8123 &           # 브라우저 테스트용 서버
node tests/browser.test.mjs             # Playwright 25개 (입력·HUD·콘솔 에러·draw call)
```

## 구조
- `js/config.js` 모든 수치 · `js/sim/` 경기 로직(DOM 무관, Node 테스트 가능)
- `js/render/` Three.js 렌더링 · `js/input.js` · `js/ui.js` · `js/main.js` 고정 타임스텝 루프
- `textures/` 절차적 생성 잔디·콘크리트 (manifest.json으로 로드) · `vendor/three.module.js` (r170)
- `design/plan.md` 기획서 · `progress.txt` 검수 로그

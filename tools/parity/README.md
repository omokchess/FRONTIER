# 엔진 규칙 대조 (JS ↔ Python)

같은 규칙이 `js/game/engine.js`와 `frontier_ai/game.py`에 두 벌로 구현돼 있다.
한쪽에만 검사가 들어가면 온라인 데스싱크와 AI 오판이 난다.
실제로 방패의 **아군 밀기 금지**가 Python에만 있고 JS에는 없던 적이 있다.

이 도구는 여러 국면에 대해 양쪽의 **합법수 집합**을 비교한다.

## 쓰는 법

```bash
# 1) Python 엔진으로 정답 집합 생성 (저장소 루트에서)
python tools/parity/generate.py        # → _parity.json

# 2) 로컬 서버를 띄우고 게임 페이지를 연 뒤, 콘솔에서
#    tools/parity/compare.js 내용을 붙여넣고 실행 → window.__r 확인
```

전부 일치하면 `전체일치: true`, 아니면 `불일치`에 어느 쪽에만 있는 수인지 나온다.

## 한계

`engine.js`는 로드 시 `init()`을 호출하고 DOM에 의존해서 Node로 그냥 못 띄운다.
그래서 비교는 브라우저에서 수동으로 돌린다. CI에 넣으려면 engine.js에서
규칙 부분을 분리하거나 `init()` 호출을 진입점으로 빼야 한다.

프로모션 변형(Q/R/B/N)은 목적지가 같으므로 하나로 합쳐서 비교한다.

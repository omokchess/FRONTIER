# FRONTIER Python 강화학습 AI + Cloudflare 연동

이 프로젝트는 기존 `FRONTIER.html` 규칙을 Python으로 이식하고, 자가대국으로 학습한 가치 모델을 Cloudflare Python Worker에서 추론 API로 제공한다.

## 구조

```text
기존 FRONTIER 웹 게임 (Cloudflare Pages)
  └─ js/game/python-ai-client.js
       └─ POST /api/move
            └─ Python FastAPI Worker (Cloudflare Workers)
                 └─ models/frontier-model.json 추론 + MCTS

로컬 PC 또는 별도 학습 러너
  └─ python -m frontier_ai.train
       └─ 자가대국 + PyTorch 학습
            └─ models/frontier-model.json 교체
                 └─ git push → Worker 재배포
```

## 구현된 규칙 범위

지원: 첫 배치 킹, 중앙/모서리 배치, 킹·퀸·룩·비숍·나이트·폰, 프로모션, 방패, 스나이퍼 3회 후퇴, 어쌔신, 영구 캡처, 5목 승리, 체크메이트, 체크 총 5회 제한, 3연속 체크 자멸, 반복/스테일메이트.

현재 Python AI v1에서 제외: 물약 행동. `potion=1` 게임에서는 브라우저 내장 AI로 자동 폴백한다. 물약은 구매·합성·비공개 인벤토리·추가 행동을 포함하여 별도 정책 헤드가 필요한 2단계 학습 범위다.

## 1. 폴더를 기존 GitHub 저장소에 넣기

이 폴더의 다음 항목을 게임 저장소 루트에 복사한다.

```text
frontier_ai/
models/
cloudflare/
web/js/game/python-ai-client.js   → 실제 프로젝트의 js/game/python-ai-client.js
.github/workflows/deploy-ai-worker.yml
pyproject.toml
package.json
```

`FRONTIER.html`에서 게임 본문 스크립트가 모두 로딩된 뒤, `</body>` 바로 앞에 추가한다.

```html
<script>
  window.FRONTIER_AI_API = 'https://frontier-python-ai.<YOUR_WORKERS_SUBDOMAIN>.workers.dev';
</script>
<script src="js/game/python-ai-client.js"></script>
```

AI 대전 URL에 아래 파라미터를 추가하면 Python AI가 켜진다.

```text
FRONTIER.html?mode=ai&difficulty=hard&pyai=1&aisims=32
```

API 주소를 URL로 일시 지정할 수도 있다.

```text
FRONTIER.html?mode=ai&pyai=1&aiapi=https%3A%2F%2Ffrontier-python-ai.example.workers.dev&aisims=32
```

## 2. Python 학습 환경 설치

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -e ".[train]"
python -m unittest discover -s tests -v
```

## 3. 자가대국 학습

기본 일반 기물 규칙으로 학습:

```bash
python -m frontier_ai.train --episodes 3000 --out models/frontier-model.json
```

특수 기물까지 포함해 학습:

```bash
python -m frontier_ai.train --episodes 10000 --hand K1Q1R2B2N2P8SH1SN1JP1 --out models/frontier-model.json
```

학습 모델은 작은 MLP JSON으로 저장되며 Worker에서 PyTorch 없이 실행된다. 더 강한 모델을 만들수록 `--episodes`를 늘리고, 학습이 끝난 `models/frontier-model.json`을 커밋한다.

## 4. 로컬 API 실행 테스트

```bash
pip install -e .
uvicorn frontier_ai.api:app --reload --port 8787
```

브라우저에서 게임을 로컬 API에 연결:

```text
FRONTIER.html?mode=ai&pyai=1&aiapi=http%3A%2F%2Flocalhost%3A8787&aisims=32
```

헬스 체크:

```bash
curl http://localhost:8787/api/health
```

## 5. Cloudflare Python Worker 배포

Cloudflare Pages는 프론트 파일을 제공하고, Python AI API는 별도 Worker로 올린다. Python Worker는 FastAPI를 지원하므로 API를 그대로 배포할 수 있다.

### 최초 배포

```bash
npm install
pip install uv
uvx --from workers-py pywrangler deploy -c cloudflare/wrangler.jsonc
```

배포 후 출력되는 `workers.dev` URL을 `window.FRONTIER_AI_API`에 넣는다.

### 사용자 도메인의 `/api/ai/*`로 붙이기

`cloudflare/wrangler.jsonc`에 도메인 라우트를 추가한다.

```jsonc
"routes": [
  {
    "pattern": "YOUR_DOMAIN/api/ai/*",
    "zone_name": "YOUR_DOMAIN"
  }
]
```

그 경우 프론트 설정은 아래처럼 둘 수 있다.

```html
<script>window.FRONTIER_AI_API = '/api/ai';</script>
```

단, 이때 API 코드의 엔드포인트 접두사(`/api/move`)와 route 구성에 맞춰 `/api/ai/api/move`가 되지 않도록 Worker 라우트 또는 JS의 API 경로를 한 번 맞춰야 한다. 가장 단순한 운영 방식은 `ai.YOUR_DOMAIN`이라는 별도 서브도메인으로 Worker를 연결하는 것이다.

## 6. GitHub → Cloudflare 자동 배포

저장소 Settings → Secrets and variables → Actions에 아래 두 값을 등록한다.

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

API Token은 저장소에 직접 넣지 않는다. `main` 브랜치에서 Python AI 또는 모델 파일이 바뀌면 `.github/workflows/deploy-ai-worker.yml`이 Worker를 자동 배포한다.

프론트 Pages 배포는 기존 GitHub 연동을 그대로 유지하면 된다. 결과적으로 한 번의 `git push`가:

1. Pages에서 게임 파일 갱신
2. GitHub Actions에서 Python AI Worker 및 새 모델 갱신

을 각각 수행하게 된다.

## 7. API 요청 형식

프론트 브리지가 자동 생성하지만 디버깅 시 형식은 다음과 같다.

```json
{
  "state": {
    "board": [[null]],
    "hands": {"w":{"K":1,"Q":1,"R":2,"B":2,"N":2,"P":8,"SH":0,"SN":0,"JP":0},"b":{"K":1,"Q":1,"R":2,"B":2,"N":2,"P":8,"SH":0,"SN":0,"JP":0}},
    "turn": "w",
    "kingPlaced": {"w": false, "b": false},
    "checkStreak": {"w": 0, "b": 0},
    "totalChecks": {"w": 0, "b": 0},
    "history": [],
    "potion": false
  },
  "simulations": 32
}
```

응답:

```json
{"ok":true,"action":{"type":"place","color":"w","kind":"K","r":3,"c":3},"info":{"simulations":32}}
```

## 운영 권장값

- 실제 유저 대전: `aisims=32` 또는 `48`
- 빠른 모바일 대전: `aisims=12`
- 학습: 로컬/GPU 환경에서 수행하고 모델 JSON만 Cloudflare에 배포
- API가 일시 실패하면 프론트 브리지가 기존 JavaScript AI로 자동 전환

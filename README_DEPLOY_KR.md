# FRONTIER 통합 배포본 — Cloudflare Pages + Python AI Worker

이 압축 파일은 현재 FRONTIER 웹 프로젝트와 Python 강화학습 AI Worker를 한 저장소 형태로 합친 배포용 구성입니다.

## 이미 반영한 변경

- `FRONTIER.html`에 `js/game/python-ai-client.js` 연결
- `index.html`의 일반 AI / AI vs AI 시작 URL에 `pyai=1&aisims=48` 자동 추가
- 친구 초대 입장 URL 오류 수정: `code=` → `room=`
- 이모지 파일을 `assets/emojis/` 경로에 정리
- Discord Webhook URL이 노출된 주석 제거
- Python 게임 엔진, 자가대국 학습기, Cloudflare Python Worker, GitHub Actions 배포 파일 포함

## 폴더 구조

```text
FRONTIER_FULL_PYTHON_AI_READY/
├─ index.html
├─ create-room.html
├─ FRONTIER.html
├─ ranking.html
├─ replays.html
├─ tutorial.html
├─ assets/emojis/
├─ js/game/
│  ├─ utils.js firebase.js timer.js chat.js elo.js network.js
│  └─ python-ai-client.js
├─ frontier_ai/
├─ models/frontier-model.json
├─ worker.py
├─ cloudflare/wrangler.jsonc
├─ tests/
└─ .github/
   ├─ workflows/daily-ranking.yml
   ├─ workflows/deploy-ai-worker.yml
   └─ scripts/send-ranking.mjs
```

## 배포 전에 반드시 할 일

### 1. Discord Webhook 재발급

기존 `send-ranking.mjs`에 실제 Discord Webhook URL이 들어 있었으므로, Discord에서 기존 웹훅을 폐기하고 새 웹훅을 만든 뒤 GitHub Secret `DISCORD_WEBHOOK_URL`에만 저장하세요.

필요한 GitHub Secrets:

```text
FIREBASE_DB_URL
DISCORD_WEBHOOK_URL
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

### 2. Worker URL 넣기

Python Worker를 배포한 뒤 `FRONTIER.html` 하단의 다음 값을 실제 Worker 주소로 바꾸세요.

```html
window.FRONTIER_AI_API = 'https://YOUR-FRONTIER-AI-WORKER.workers.dev';
```

### 3. Pages 배포

정적 사이트 파일들은 기존처럼 Cloudflare Pages로 배포합니다. Pages 프로젝트의 배포 루트가 저장소 루트라면 HTML/JS/이미지 경로가 그대로 맞습니다.

## Python AI 로컬 실행

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -e ".[train]"
python -m unittest discover -s tests -v
uvicorn frontier_ai.api:app --reload --port 8787
```

로컬 API로 게임 확인:

```text
FRONTIER.html?mode=ai&pyai=1&aiapi=http%3A%2F%2Flocalhost%3A8787&aisims=32
```

## 학습

일반 기물:

```bash
python -m frontier_ai.train --episodes 3000 --out models/frontier-model.json
```

특수 기물 포함:

```bash
python -m frontier_ai.train --episodes 10000 --hand K1Q1R2B2N2P8SH1SN1JP1 --out models/frontier-model.json
```

학습 결과 파일 `models/frontier-model.json`을 커밋하고 push하면 Worker 배포 workflow가 재배포합니다.

## Cloudflare Python Worker 최초 배포

```bash
npm install
pip install uv
uvx --from workers-py pywrangler deploy -c cloudflare/wrangler.jsonc
```

## 현재 지원 범위

Python AI v1은 일반 기물 및 특수 기물 대전을 지원합니다. `potion=1` 물약 모드는 상태공간과 비공개 정보가 추가되므로 현재는 브라우저 내장 AI로 자동 폴백합니다.

# 설치

**배포된 웹사이트를 이용한다면 프로그램을 설치할 필요가 없습니다.** 사이트에 접속한 뒤 [사용법](usage.md)의 웹 변환 순서를 따르세요. 모델은 처음 사용할 때 브라우저에서 내려받습니다.

이 문서는 내 Mac에서 Qwen3를 실행하거나, 웹 화면을 직접 실행·배포할 때 사용합니다. 이미 설치를 마쳤다면 다시 설치하지 않고 [사용법](usage.md)으로 이동하세요.

## Mac에 로컬 프로그램 설치하기

### 1. 준비할 것

| 항목 | 조건 |
| --- | --- |
| Mac | Apple Silicon(M 시리즈). 현재 Python 실행 방식은 Intel Mac·Windows·Linux용이 아닙니다. |
| 운영체제 | MLX 실행 조건은 macOS 14 이상입니다. 아래 Homebrew 신규 설치 안내는 macOS 15 이상을 기준으로 합니다. |
| 실행 도구 | uv, Python 3.12, ffmpeg. Python은 uv가 준비합니다. |
| 저장 공간 | 선택한 모델 용량 외에 실행 패키지·중간 음성·완성 MP3를 저장할 여유 공간이 필요합니다. |
| 인터넷 | 도구·패키지·모델을 처음 내려받을 때 필요합니다. 계정이나 API 키는 필요 없습니다. |

운영체제 조건: [MLX 설치 안내](https://ml-explore.github.io/mlx/build/html/install.html), [Homebrew 설치 안내](https://docs.brew.sh/Installation).

터미널을 열고 `brew --version`으로 Homebrew가 있는지 확인합니다. 없다면 [Homebrew 공식 설치 안내](https://brew.sh/)를 따라 설치하고, 설치 마지막에 표시되는 **Next steps**의 명령까지 실행하세요. Command Line Tools 설치 창이 나타나면 설치를 완료합니다.

다음 명령으로 [uv](https://docs.astral.sh/uv/getting-started/installation/#homebrew)와 [ffmpeg](https://formulae.brew.sh/formula/ffmpeg)를 준비합니다. 이미 두 도구가 있다면 생략합니다.

```bash
brew install uv ffmpeg
```

Node.js는 웹 화면을 빌드할 때만 필요합니다. 터미널에서 문서를 변환하는 데에는 설치하지 않아도 됩니다.

### 2. 프로젝트 받기

프로젝트를 둘 폴더에서 실행합니다. 이미 프로젝트 폴더가 있다면 복제하지 말고 그 폴더로 이동하세요.

```bash
git clone https://github.com/inininax/doc2audio.git
cd doc2audio
```

이후 모든 명령은 `pyproject.toml`과 `package.json`이 있는 **프로젝트 폴더**에서 실행합니다.

### 3. 실행 환경 설치하기

```bash
uv sync --locked
```

프로젝트가 지정한 버전의 패키지를 `.venv/`에 설치합니다. Python 3.12가 없으면 [uv가 자동으로 내려받습니다](https://docs.astral.sh/uv/concepts/python-versions/#project-python-versions). 별도로 Python을 설치하거나 가상 환경을 활성화할 필요는 없습니다.

### 4. 사용할 모델 하나 받기

기본값은 **Qwen3-TTS 1.7B · 한국어 · Sohee**입니다. 아래 설치·점검·샘플 명령은 이 기본 모델을 사용합니다.

| 모델 ID | 모델 파일 용량 | 선택 기준 |
| --- | ---: | --- |
| `qwen3-1.7b` | 약 3.08GB | 기본 한국어 낭독, 말투 지시 지원 |
| `qwen3-0.6b` | 약 1.97GB | 더 작은 Qwen 모델 |
| `supertonic-3` | 약 401MB | CPU로 실행하는 작은 모델 |

**모든 모델을 받을 필요는 없습니다.** 다른 모델을 선택한다면 아래 `download`, `doctor`, 샘플 변환 명령에 같은 `--model 모델ID`를 붙이세요. 예: `uv run doc2audio download --model qwen3-0.6b`.

기본 저장 위치는 프로젝트의 `.models/`입니다. 다른 위치를 쓰려면 **다운로드 전에** 다음과 같이 설정합니다. 기본 위치가 좋다면 이 명령은 생략합니다.

```bash
export DOC2AUDIO_MODELS_DIR="$HOME/Documents/doc2audio-data/models"
```

설정은 현재 터미널에만 적용됩니다. 새 터미널에서도 같은 위치를 사용하려면 다시 설정해야 하며, 기존 파일은 자동으로 이동하지 않습니다. 상세 경로 설정은 [사용법](usage.md)을 참고하세요.

```bash
uv run doc2audio download
```

완료되면 `모델 준비 완료`와 저장 경로가 표시됩니다. 중간에 끊겼다면 같은 명령을 다시 실행합니다. 이미 준비된 모델 파일은 재사용합니다.

### 5. 설치 확인하기

```bash
uv run doc2audio doctor
uv run doc2audio samples/korean.txt -o output/sample.mp3
```

기본 Qwen 모델의 `doctor` 결과에서 **플랫폼·Metal GPU·모델 파일이 OK**이고 ffmpeg 경로가 표시되는지 확인합니다. 샘플 변환이 끝나면 프로젝트의 `output/sample.mp3`를 열어 들어보세요. 같은 이름의 파일이 이미 있으면 다른 출력 이름을 사용하거나, 교체할 때만 `--overwrite`를 붙입니다.

이제 [사용법](usage.md)에 따라 실제 문서를 변환할 수 있습니다. 매번 `uv sync`와 `download`를 실행할 필요는 없습니다.

## 로컬 프로그램을 웹 화면으로 사용하기

위의 Mac 설치를 마친 뒤 진행합니다. 문서 변환은 내 Mac의 Python 프로그램이 담당하며, 브라우저는 설정과 결과를 보여줍니다.

1. [Node.js 공식 설치 파일](https://nodejs.org/en/download)로 **24.x의 24.12 이상**을 설치합니다. 이미 22.x의 22.20 이상 또는 26 이상을 사용한다면 그대로 사용할 수 있습니다.
2. 프로젝트 폴더에서 화면을 설치·빌드합니다.

```bash
npm ci
npm run build
```

3. 사용할 때마다 로컬 서버를 실행합니다.

```bash
uv run doc2audio-server
```

4. 터미널을 켜 둔 채 [로컬 웹 화면](http://127.0.0.1:8010/?runtime=local#new)을 엽니다. 모델 보관함에서 설치 상태를 확인한 뒤 문서를 선택합니다.

주소의 **`?runtime=local`을 포함해야 Qwen을 사용하는 로컬 모드**가 열립니다. 이를 생략하면 기본 브라우저 모드가 열립니다. 기본 포트는 `8010`이며, 서버를 종료하려면 실행 중인 터미널에서 **Ctrl+C**를 누릅니다.

## 브라우저용 웹을 직접 실행하거나 배포하기

이 방식은 이용자의 브라우저가 Supertonic으로 변환합니다. **Python·uv·ffmpeg 설치와 위의 모델 다운로드 단계는 필요 없습니다.** 직접 빌드하려면 프로젝트와 Node.js를 준비합니다. Node 버전은 바로 위와 같습니다. Docker를 사용하면 Node.js 설치도 생략할 수 있습니다.

### 내 PC에서 열기

프로젝트 폴더에서 실행합니다.

```bash
npm ci
npm run build
npm run preview
```

[http://127.0.0.1:4173](http://127.0.0.1:4173)으로 접속합니다. 모델은 이 화면의 모델 보관함에서 내려받으며, `.models/`의 파일과는 별도로 브라우저에 저장됩니다.

화면을 수정하면서 실행할 때는 `npm run dev`를 사용하며 주소는 `http://127.0.0.1:5173`입니다. 개발 모드에는 오프라인 캐시가 없으므로 오프라인 사용 확인은 빌드 후 preview에서 진행합니다.

### Docker로 배포하기

프로젝트를 받은 뒤 [Docker Engine과 Compose](https://docs.docker.com/compose/install/)를 준비하고 프로젝트 폴더에서 실행합니다. Mac·Windows에서는 Docker Desktop을 사용할 수 있습니다.

```bash
docker compose up -d --build
docker compose ps
```

[http://localhost:8080](http://localhost:8080)에서 열립니다. Docker가 Node.js로 웹을 빌드하고 Nginx로 제공합니다. 초기 빌드에는 이미지와 npm 패키지를 내려받을 인터넷 연결이 필요합니다.

| 처리 대상 | 실행·저장 위치 |
| --- | --- |
| 웹 화면·문서 추출·음성 실행 파일 | Docker 이미지에서 이용자 브라우저로 제공 |
| 모델 다운로드·보관 | 이용자 브라우저의 IndexedDB |
| 문서 추출·음성 생성·작업 이어하기 | 이용자 PC의 브라우저 |
| Mac용 Qwen·Python 로컬 서버 | 기존 Mac 설치 방식으로 별도 실행 |

Docker 이미지에는 모델과 사용자 문서·작업·음성이 포함되지 않습니다. 이 데이터용 서버 볼륨도 필요 없습니다. 컨테이너를 교체해도 같은 사이트 주소와 브라우저 프로필로 접속하면 브라우저에 저장한 데이터를 사용합니다. 도메인이나 포트가 바뀌면 브라우저가 별도 사이트 저장소로 취급하므로 기존 데이터가 자동으로 나타나지 않습니다.

#### 외부에 공개하기

외부 이용자에게는 **HTTPS 주소**를 제공해야 합니다. 일반 HTTP 서버 IP 주소로 접속하면 앱이 사용하는 보안 컨텍스트·Web Locks·서비스 워커 기능을 사용할 수 없습니다. 같은 PC의 `localhost` 접속은 로컬 확인용으로 사용할 수 있습니다.

기본 포트는 서버 자신의 `127.0.0.1:8080`에서만 열립니다. 같은 서버의 HTTPS 리버스 프록시에서 요청을 `http://127.0.0.1:8080`으로 전달하세요. 프록시도 컨테이너라면 같은 Docker 네트워크에 연결하고 `http://web:8080`으로 전달합니다. 모델은 이용자 브라우저가 Hugging Face에서 직접 내려받습니다. 프록시에서 `.wasm`, `.mjs`, OCR `.gz` 파일의 응답 형식과 내용을 바꾸지 않아야 합니다.

포트·배포 경로·링크 공유 주소를 바꾸려면 프로젝트 폴더의 `.env`에 필요한 값을 저장한 뒤 다시 빌드합니다. 다음은 하위 경로 배포 예시입니다. 도메인은 실제 주소로 바꾸세요.

```dotenv
DOC2AUDIO_PORT=8080
DOC2AUDIO_BASE=/doc2audio/
DOC2AUDIO_SITE_URL=https://example.com/doc2audio/
```

도메인 루트에 배포한다면 `DOC2AUDIO_BASE=/`, `DOC2AUDIO_SITE_URL=https://example.com/`으로 설정합니다. 사이트 주소는 생략할 수 있지만 지정하면 링크 공유 이미지와 대표 페이지에 절대 주소를 사용합니다. **BASE와 SITE_URL은 빌드 시 적용**되므로 변경 후 `docker compose up -d --build`를 실행해야 합니다.

하위 경로는 `/doc2audio/`처럼 영문·숫자·하이픈·밑줄로 구성하고 끝에 `/`를 붙입니다. `/healthz/`로 시작하는 경로는 상태 확인용으로 예약되어 사용할 수 없습니다. 프록시는 이 경로를 제거하지 않고 그대로 전달해야 합니다. 예를 들어 `/doc2audio/` 설정 후에는 `https://example.com/doc2audio/` 또는 로컬 확인용 `http://localhost:8080/doc2audio/`로 접속합니다. 컨테이너 상태 확인 주소는 배포 경로와 관계없이 `/healthz`입니다.

#### 업데이트와 종료

```bash
git pull --ff-only
docker compose up -d --build
```

로그 확인은 `docker compose logs --tail=100 web`, 종료는 `docker compose down`을 사용합니다. 컨테이너를 종료해도 이용자 브라우저의 모델과 작업은 삭제되지 않습니다. 이미 저장된 화면의 새 버전 적용은 열려 있는 사이트 탭을 모두 닫았다가 다시 열어 확인하세요.

### 정적 호스팅에 배포하기

빌드 결과인 **`apps/web/dist/` 전체**를 HTTPS 정적 호스팅에 올립니다. 모델 실행 서버는 필요 없습니다. `runtime/`, `assets/`, `sw.js`, 라이선스 파일을 포함해 모든 생성 파일을 함께 배포하세요. `file://`로 HTML을 여는 방식은 지원하지 않습니다.

| 호스팅 설정 | 필요한 값 |
| --- | --- |
| `.wasm` 응답 | `Content-Type: application/wasm` |
| `.js`, `.mjs`, `sw.js` 응답 | JavaScript MIME 형식 |
| `.webmanifest` 응답 | `Content-Type: application/manifest+json` |
| `.traineddata.gz` 응답 | OCR 데이터 파일 그대로 제공. 확장자만 보고 `Content-Encoding: gzip`을 붙이지 않음 |
| `index.html`, `sw.js` 캐시 | 새 버전을 확인할 수 있도록 `Cache-Control: no-cache` 권장 |
| 없는 정적 파일 요청 | HTML로 바꾸어 응답하지 말고 404 반환 |

기본 배포 위치는 도메인의 `/`입니다. `/doc2audio/` 같은 하위 경로에 배포한다면 끝의 `/`까지 지정해 다시 빌드합니다.

```bash
DOC2AUDIO_BASE=/doc2audio/ npm run build
```

생성된 `dist/` 전체를 해당 경로에 올립니다. 화면 이동은 `#new`, `#history` 등의 해시를 사용하므로 별도 페이지 라우팅은 필요 없습니다.

파비콘, Apple 터치 아이콘, 앱 설치용 아이콘·매니페스트, 링크 공유 이미지가 빌드에 포함됩니다. **공유 미리보기까지 사용하려면** 빌드할 때 `DOC2AUDIO_SITE_URL`에 하위 경로까지 포함한 실제 HTTPS 사이트 주소를 지정하세요. 주소의 경로는 `DOC2AUDIO_BASE`와 같아야 합니다. 예를 들어 하위 경로 배포 명령은 다음과 같습니다. `example.com`을 실제 도메인으로 바꾸세요.

```bash
DOC2AUDIO_BASE=/doc2audio/ DOC2AUDIO_SITE_URL=https://example.com/doc2audio/ npm run build
```

도메인 루트에 배포한다면 `DOC2AUDIO_BASE`를 생략하고 `DOC2AUDIO_SITE_URL=https://실제도메인/`으로 설정합니다. 사이트 주소를 지정하면 공유 이미지와 대표 페이지 주소가 절대 URL로 기록됩니다. 미지정 시 웹 화면·아이콘은 동작하지만, 공유 서비스가 상대 이미지 주소를 표시하지 못할 수 있습니다. 브라우저의 앱 설치 기능은 지원 환경에서 사용할 수 있으며, 오프라인 준비와 실행 조건은 [사용법](usage.md)을 따릅니다.

배포 후 모델 다운로드와 샘플 문서 변환을 직접 확인하세요. 이용자 브라우저가 Hugging Face에서 모델을 받으므로 호스팅의 보안 정책이나 이용자 네트워크가 이 연결을 차단하면 다운로드할 수 없습니다. 문서와 생성 음성은 이 다운로드 요청에 포함되지 않습니다.

오프라인 준비·데이터 보관·중단 후 이어하기는 [사용법](usage.md)에서 확인할 수 있습니다.

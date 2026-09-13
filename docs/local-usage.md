# 기존 로컬 방식으로 사용하기

**웹 브라우저에서 변환할 수 없거나 Qwen3 목소리를 쓰고 싶다면, 처음 만들었던 Mac용 프로그램을 그대로 사용할 수 있습니다.** 문서를 읽고 음성을 만드는 곳은 내 Mac이며, 공개 변환 서버나 유료 API가 필요하지 않습니다.

현재 프로젝트의 Python·MLX 실행 방식은 **Apple Silicon Mac**용입니다. 웹과 다른 실행 엔진을 사용하므로 브라우저 제한을 피할 수 있지만, 암호화되거나 지원하지 않는 문서 형식까지 모두 변환하는 것은 아닙니다.

## 이미 설치했다면

터미널에서 프로젝트 폴더로 이동한 뒤 아래 명령을 실행합니다. `문서.pdf`와 `결과.mp3`는 실제 파일 경로로 바꾸세요.

```bash
uv run doc2audio doctor
uv run doc2audio "문서.pdf" -o "결과.mp3"
```

기본값은 **Qwen3-TTS 1.7B · 한국어 · Sohee**입니다. 기존 모델 파일을 재사용하며, 터미널에 진행 상황이 표시됩니다. `-o`를 생략하면 입력 문서 옆에 같은 이름의 MP3를 저장합니다. PDF 외에 DOCX·DOC·UTF-8 TXT도 사용할 수 있습니다.

목소리와 출력 배속을 명시하려면 다음처럼 실행합니다.

```bash
uv run doc2audio "문서.pdf" -o "결과.mp3" --speaker Sohee --speed 1.1
```

## 처음 설치한다면

Homebrew·uv·ffmpeg 설치와 프로젝트 받기는 [README의 처음 한 번 설치하기](../README.md#처음-한-번-설치하기)를 따르세요. 도구와 프로젝트 폴더가 준비된 다음의 순서입니다.

```bash
uv sync --locked
uv run doc2audio download
uv run doc2audio doctor
uv run doc2audio samples/korean.txt -o output/sample.mp3
```

기본 모델 약 3.1 GB와 실행 패키지를 처음 받을 때 인터넷이 필요합니다. 샘플을 변환해 설치를 확인한 뒤에는 다음처럼 패키지와 모델 다운로드 없이 실행할 수 있습니다.

```bash
uv run --offline doc2audio "문서.pdf" -o "결과.mp3" --offline
```

앞의 `--offline`은 uv의 패키지 다운로드를, 뒤의 `--offline`은 모델 다운로드를 막습니다. 필요한 파일이 없으면 오류를 알립니다.

## 웹 화면으로 Qwen3 사용하기

같은 로컬 프로그램을 웹 UI로 조작할 수도 있습니다. 위의 Python·모델 설치 외에 Node.js가 필요합니다. 지원 버전은 [웹 개발·정적 배포](../README.md#웹-개발정적-배포)를 참고하세요. 프로젝트 폴더에서 **처음 한 번** 화면을 빌드합니다.

```bash
npm ci
npm run build
```

사용할 때마다 로컬 서버를 실행합니다.

```bash
uv run doc2audio-server
```

터미널을 켜 둔 채 **[Qwen3 로컬 화면 열기](http://127.0.0.1:8010/?runtime=local#new)**를 선택합니다. 모델 보관함에서 설치 상태를 확인하고, 새 음성 만들기에서 Qwen3와 Sohee를 고릅니다. `?runtime=local`을 생략하면 기본 브라우저 모드가 열립니다.

여기서 서버는 **내 Mac의 `127.0.0.1`에서 실행 중인 Python 프로그램**입니다. 브라우저가 문서를 이 프로그램으로 전달하고, 프로그램이 Mac의 GPU로 음성을 만든 뒤 MP3를 제공합니다. 외부 웹 호스팅 서버로 문서를 보내지 않습니다.

공개 웹에서 이 링크를 열어도 기존 문서·설정·작업은 자동 전달되지 않습니다. 로컬 화면에서 문서를 다시 선택하세요.

## 모델과 작업을 원하는 폴더에 저장하기

### CLI와 로컬 웹 서버가 같은 폴더를 사용하기

아래 예시는 사용자 문서 폴더에 모델과 서버 작업을 모읍니다. 터미널에서 **다운로드 전에** 설정하고, 같은 터미널에서 실행하세요.

```bash
export DOC2AUDIO_MODELS_DIR="$HOME/Documents/doc2audio-data/models"
export DOC2AUDIO_DATA_DIR="$HOME/Documents/doc2audio-data/server"
uv run doc2audio download
uv run doc2audio doctor
uv run doc2audio-server
```

서버를 쓰지 않고 CLI로 변환하려면 마지막 명령 대신 `uv run doc2audio "문서.pdf" -o "결과.mp3"`를 실행합니다. CLI와 서버가 같은 모델 루트에서 모델을 찾습니다.

| 항목 | 위 설정을 사용했을 때의 경로 |
| --- | --- |
| Qwen3 1.7B 모델 | `$HOME/Documents/doc2audio-data/models/qwen3-tts-1.7b-8bit/` |
| Qwen3 0.6B 모델을 설치한 경우 | `$HOME/Documents/doc2audio-data/models/qwen3-0.6b/` |
| Supertonic 3을 설치한 경우 | `$HOME/Documents/doc2audio-data/models/supertonic-3/` |
| 로컬 웹 서버의 작업 목록 | `$HOME/Documents/doc2audio-data/server/jobs.sqlite3` |
| 로컬 웹 서버의 원문·중간 음성·MP3 | `$HOME/Documents/doc2audio-data/server/jobs/` |
| CLI의 MP3 | `-o`로 지정한 파일 |
| CLI의 이어하기 파일 | 출력 폴더 아래 `.doc2audio/`. `--work-dir`로 별도 지정 가능 |

설정은 **현재 터미널에만 적용**됩니다. 새 터미널을 열면 같은 `export` 두 줄을 다시 실행한 후 프로그램을 시작하세요. 이미 켜진 서버에는 적용되지 않으므로 새 설정으로 다시 시작해야 합니다.

경로를 바꿔도 기존 모델이나 작업은 자동으로 이동하지 않습니다. 기존 저장소를 계속 쓰려면 기존 경로를 지정하세요. 새 빈 경로를 지정하고 `download`를 실행하면 그곳에 모델을 내려받습니다. 브라우저의 IndexedDB에 있는 모델과 작업도 이 폴더로 자동 이전되지 않습니다.

### CLI에서 모델 한 개의 폴더만 지정하기

`--model-dir`은 위 환경변수와 달리 **모델 한 개의 파일이 들어갈 폴더 자체**를 지정합니다. 다운로드·점검·변환에 동일하게 지정해야 합니다.

```bash
uv run doc2audio download --model qwen3-1.7b --model-dir "$HOME/Documents/tts-models/qwen3-1.7b"
uv run doc2audio doctor --model qwen3-1.7b --model-dir "$HOME/Documents/tts-models/qwen3-1.7b"
uv run doc2audio "문서.pdf" -o "결과.mp3" --model qwen3-1.7b --model-dir "$HOME/Documents/tts-models/qwen3-1.7b"
```

이 옵션은 모델 루트 아래에 하위 폴더를 더 만들지 않으며, 로컬 서버의 모델 위치를 바꾸지도 않습니다. 서버와 함께 관리하려면 앞 절의 `DOC2AUDIO_MODELS_DIR` 방식을 사용하세요.

기본 설정에서는 모델을 프로젝트의 `.models/`에, 서버 작업을 `.doc2audio/`에 저장합니다. 설치된 모델의 ID·버전·사용 조건·선택 가능한 목소리는 `uv run doc2audio models` 또는 로컬 화면의 **모델 보관함**에서 확인합니다. 모든 모델을 설치할 필요 없이 사용할 모델만 준비하면 됩니다.

## 중단과 이어하기

| 실행 방식 | 창을 닫으면 | 이어하는 방법 |
| --- | --- | --- |
| 기본 브라우저 웹 | 계산이 멈춤 | 같은 사이트·프로필로 재접속. 일시정지·실패는 수동 재개 |
| 로컬 웹 서버 | 브라우저를 닫아도 Python 서버가 실행 중이면 계속 처리 | 서버가 중단됐다면 다시 켜고 작업 기록에서 재시도 |
| 터미널 CLI | 실행 프로세스를 종료하면 멈춤 | 원문과 이어하기 폴더를 보관하고 같은 명령으로 다시 실행 |

CLI는 **Ctrl+C**로 중단할 수 있습니다. 모델·본문·음성 설정이 같은 완료 구간을 재사용하며, 생성 중이던 미완료 구간은 다시 만듭니다. 완성된 출력 파일이 이미 있을 때 교체하려면 `--overwrite`를 명시해야 합니다.

이어하기 폴더를 직접 지정할 수도 있습니다. 다음 실행에도 같은 경로를 사용하세요.

```bash
uv run doc2audio "문서.pdf" -o "결과.mp3" --work-dir "$HOME/Documents/doc2audio-data/cli-work"
```

컴퓨터의 잠자기·전원 종료 중에는 처리가 계속되지 않습니다. CLI와 서버는 완료 구간을 보관하지만, 기본 웹에서 시작한 작업을 CLI가 그대로 이어받는 기능은 없습니다.

## 읽을 본문부터 확인하기

브라우저에서 처리되지 않거나 읽는 순서가 이상한 문서는 먼저 본문만 추출해 확인할 수 있습니다. 이 단계에는 TTS 모델이 필요하지 않습니다.

```bash
uv run doc2audio extract "문서.pdf" -o "본문.txt"
```

필요한 부분을 UTF-8 텍스트로 정리한 다음 그 TXT를 변환합니다. 숫자·이름·표의 읽는 순서는 직접 확인하세요.

```bash
uv run doc2audio "본문.txt" -o "결과.mp3"
```

[웹 사용 안내](web-usage.md) · [모델 저장 위치 안내](model-storage.md) · [Qwen3 상세 사용법](model-usage.md) · [문제 해결](../README.md#문제-해결)

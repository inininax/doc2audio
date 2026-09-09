# 모델 사용 가이드

[README로 돌아가기](../README.md) · [내부 동작 기술 문서](architecture.md)

이 문서는 음성 모델을 설치하고, 같은 문서를 다른 목소리·말투·속도로 읽는 방법을 설명합니다. **설치부터 처음 시작한다면 [README의 설치 순서](../README.md#처음-한-번-설치하기)를 먼저 진행하세요.** 아래 명령은 모두 `pyproject.toml`이 있는 프로젝트 폴더에서 실행합니다.

## 먼저 알아둘 말

| 용어 | 이 프로젝트에서의 뜻 |
| --- | --- |
| TTS | Text to Speech. 글을 음성으로 바꾸는 기능입니다. |
| 모델 | 문장과 말투 요청을 받아 음성을 만드는 AI입니다. 학습된 수치가 담긴 파일을 내려받아 사용합니다. |
| 로컬 실행 | 음성 생성 계산을 내 Mac에서 처리한다는 뜻입니다. 로컬 모델도 AI이지만 외부 음성 생성 API를 호출하지 않습니다. |
| 다운로드 | 모델 파일을 인터넷에서 디스크로 받아 보관하는 단계입니다. 처음 한 번 필요합니다. |
| 로딩 | 디스크의 모델을 메모리로 읽어 실행을 준비하는 단계입니다. 새 음성을 만드는 명령을 시작할 때 필요합니다. |
| 추론 | 준비된 모델에 글을 넣어 실제 음성을 생성하는 단계입니다. 모델을 새로 학습하지 않습니다. |
| 화자 | 미리 준비된 목소리입니다. 기본값은 한국어 화자 `Sohee`입니다. |

문서를 읽을 때 사용할 모델은 다음 하나로 고정되어 있습니다.

| 항목 | 값 |
| --- | --- |
| 모델 ID | `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit` |
| 모델 리비전 | `41d3337e8b7f2843a75841595fc14e4b9a7a4b96` |
| 기본 설치 폴더 | `.models/qwen3-tts-1.7b-8bit/` |
| 필요한 모델 파일 용량 | 약 3.1 GB, 총 12개 필수 파일 |
| 실행 라이브러리 | `mlx-audio==0.5.3`, Apple Silicon Mac의 Metal GPU 사용 |
| 기본 언어·화자 | `Korean` · `Sohee` |
| 결과 | 기본 MP3 24 kHz, 모노, 128 kbps. WAV도 가능 |

`1.7B`는 모델 규모, `8bit`는 모델의 수치를 압축해 저장하는 형식을 나타냅니다. `CustomVoice`는 미리 정해진 화자를 선택하고 말투를 지시하는 모델 종류입니다. 이름의 `12Hz`는 최종 MP3의 샘플레이트가 아닙니다. 모델 배경은 [공식 Qwen 모델 카드](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)와 [MLX 변환 모델 카드](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit)를 참고하세요.

## 1. 모델 설치와 확인

README의 `uv sync --locked`까지 마친 다음 실행합니다.

```bash
uv run doc2audio download
uv run doc2audio doctor
```

첫 번째 명령이 `모델 준비 완료:`를 출력하고, 두 번째 명령에서 `Metal GPU: OK`, `모델 파일: OK`가 나오면 준비된 상태입니다. `doctor`는 환경과 파일 상태를 확인하며 실제 음성을 생성하지는 않습니다.

다음으로 포함된 샘플을 실행합니다. `-o` 뒤에는 새로 만들 음성 파일 경로를 적습니다.

```bash
uv run doc2audio samples/korean.txt -o output/model-guide/default.mp3
open output/model-guide/default.mp3
```

마지막에 변환 결과가 출력되고 음성이 재생되면 실제 모델 실행까지 확인한 것입니다. 이미 같은 출력이 있으면 다른 이름을 쓰거나 교체할 때만 `--overwrite`를 붙이세요.

별도로 모델 서버를 켜거나 Ollama에 등록할 필요는 없습니다. 변환 명령이 모델을 불러오고, 그 명령이 끝나면 프로세스도 종료됩니다. 같은 변환 작업 안에서는 불러온 모델 하나를 계속 사용합니다.

## 2. 내 문서에 적용하기

샘플이 성공했다면 입력 경로만 실제 문서에 맞게 바꿉니다. 폴더에 파일을 넣는 것만으로는 변환이 시작되지 않습니다.

```bash
uv run doc2audio "input/읽을 문서.pdf" -o "output/읽을 문서.mp3"
```

PDF 본문을 확인하고 정리한 TXT가 있다면 **TXT를 지정**합니다. 같은 폴더의 PDF나 다른 파일을 함께 참고하지 않습니다.

```bash
uv run doc2audio "input/읽을 문서-낭독용.txt" -o "output/정리한 낭독.mp3"
```

지원 입력은 PDF·DOCX·DOC·UTF-8 TXT입니다. Markdown은 직접 지원하지 않습니다. 원문 보관과 TXT 준비 방법은 [README의 입력 파일 안내](../README.md#input에는-어떤-파일이-필요한가요)를 참고하세요.

## 3. 목소리·말투·속도 비교하기

아래 예제는 같은 샘플을 사용하므로 별도 문서를 준비할 필요가 없습니다. 원하는 예제만 실행하고 들어 보세요. 설정을 바꾸면 새 작업으로 처리되어 음성 생성 시간이 다시 걸립니다.

### 화자

```bash
uv run doc2audio samples/korean.txt --speaker Sohee -o output/model-guide/sohee.mp3
```

이 모델에 등록된 화자 이름은 `Sohee`, `Serena`, `Vivian`, `Uncle_Fu`, `Ryan`, `Aiden`, `Ono_Anna`, `Eric`, `Dylan`입니다. 이름은 대소문자를 구분하지 않습니다. 한국어 기본 사용과 이 프로젝트의 실행 검증은 `Sohee` 기준입니다. 다른 화자의 한국어 발음과 자연스러움은 동일하게 보장하지 않습니다.

`--speaker`에는 이 목록의 이름을 넣습니다. 사람 이름을 임의로 넣거나 음성 파일 경로를 넣어 새 목소리를 만드는 옵션은 아닙니다. 음성 복제 기능은 구현되어 있지 않습니다.

### 말투

```bash
uv run doc2audio samples/korean.txt --style "차분하고 또렷한 한국어 설명체로 읽어 주세요." -o output/model-guide/calm.mp3
open output/model-guide/calm.mp3
```

`--style`은 모델이 읽는 방식에 대한 요청입니다. 기본값은 차분하고 따뜻한 한국어 오디오북 낭독 지시문입니다. 요청이 항상 정확히 반영되지는 않으므로 짧은 본문으로 먼저 비교하세요. 이 옵션이 문서를 요약하거나 내용을 다시 쓰게 하지는 않습니다.

### 속도와 구간 사이 쉼

```bash
uv run doc2audio samples/korean.txt --speed 1.1 --pause 0.5 -o output/model-guide/faster.mp3
open output/model-guide/faster.mp3
```

`--speed 1.1`은 생성된 음성을 1.1배 속도로 처리합니다. `--pause 0.5`는 나눈 구간 사이에 0.5초의 무음을 넣습니다. **쉼을 넣은 뒤 전체 속도를 적용**하므로 이 예제에서 실제 구간 사이 쉼은 약 0.45초입니다. 문장 내부에서 모델이 만든 쉼까지 고정하는 옵션은 아닙니다.

속도는 모델 지시가 아니라 ffmpeg의 후처리입니다. 현재 프로그램은 속도·쉼도 작업 식별에 포함하므로, 이 값만 바꾸어도 기존 작업과 다른 음성을 새로 생성할 수 있습니다.

### 주요 옵션 한눈에 보기

| 옵션 | 기본값·허용값 | 언제 사용하는가 |
| --- | --- | --- |
| `--speaker` | `Sohee`, 위 화자 목록 | 준비된 목소리 선택 |
| `--style` | 한국어 오디오북 지시문 | 말투 요청 |
| `--speed` | `1.0`, 범위 `0.5`~`2.0` | 생성된 음성의 재생 속도 조정 |
| `--pause` | `0.3`, 범위 `0`~`3`초 | 구간 사이 무음 길이 조정 |
| `--chunk-chars` | `240`, 정수 `40`~`600` | 긴 구간에서 생성이 반복되거나 실패할 때 더 작게 설정 |
| `--seed` | `42`, 정수 `0`~`4294967295` | 같은 글의 음성 생성 결과를 바꾸어 비교 |
| `--pronunciations` | 지정 없음, JSON 경로 | 약어·고유명사를 읽을 표현으로 치환 |
| `--pages` | PDF 전체, 예: `1-3,5` | 음성 생성에 앞서 PDF에서 읽을 페이지 선택 |
| `--ocr` | `auto`, `always`, `never` | 음성 생성에 앞서 PDF의 이미지 글자 인식 방식 선택 |
| `--offline` | 기본은 필요시 모델 다운로드 허용 | 준비된 모델만 사용 |
| `--model-dir` | 기본 모델 폴더 | 동일한 모델을 다른 위치에 보관 |
| `--work-dir` | 출력 폴더의 `.doc2audio/` | 중간 음성과 이어하기 기록 위치 지정 |
| `--overwrite` | 기본은 기존 출력 보호 | 이미 완성된 출력 파일 교체 |

`--seed`는 생성에 쓰는 난수의 시작값입니다. 같은 설정으로 재실행하면 저장된 음성을 먼저 재사용합니다. 설정·라이브러리·실행 환경이 달라진 경우까지 결과의 완전한 일치를 보장하는 옵션은 아닙니다.

발음 사전은 모델을 재학습하는 기능이 아니라 **모델에 넣기 전 본문 치환**입니다. 형식과 예제는 [발음 사전 안내](../README.md#약어와-고유명사-발음-지정하기)에 있습니다. `--pages`, `--ocr`도 본문 추출 옵션이며 모델의 언어·목소리를 바꾸지 않습니다.

언어는 프로그램 내부에서 `Korean`으로 지정합니다. 현재 CLI에는 `--language`, `--temperature`, `--top-p` 옵션이 없습니다. 온도 등 내부 설정은 [기술 문서](architecture.md#음성-생성-호출)에서 확인할 수 있습니다.

## 4. 인터넷 없이 사용하기

설치와 샘플 실행을 마친 뒤 다음처럼 실행합니다.

```bash
uv run --offline doc2audio samples/korean.txt --offline -o output/model-guide/offline.mp3
```

두 `--offline`은 대상이 다릅니다. 첫 번째는 uv의 패키지 다운로드를, 두 번째는 doc2audio의 모델 다운로드를 막습니다. 파일이 없으면 온라인 상태에서 먼저 설치해야 합니다. 음성 추론 자체는 로컬 모델로 처리합니다.

## 5. 모델을 다른 폴더에 보관하기

외장 디스크 등에 두고 싶다면 세 명령에 **동일한 경로**를 지정하세요. 아래 `외장디스크`는 Finder에서 확인한 실제 디스크 이름으로 바꿉니다.

```bash
uv run doc2audio download --model-dir "/Volumes/외장디스크/doc2audio-model"
uv run doc2audio doctor --model-dir "/Volumes/외장디스크/doc2audio-model"
uv run doc2audio samples/korean.txt --model-dir "/Volumes/외장디스크/doc2audio-model" -o output/model-guide/external.mp3
```

이 옵션은 고정된 Qwen 모델의 **보관 위치**를 바꿉니다. 다른 모델 ID를 받는 옵션이 아닙니다. 다른 TTS 모델을 쓰려면 모델 파일 목록·로더·생성 호출·출력 형식 등을 코드에서 맞추고 실제 실행을 검증해야 합니다.

## 6. Python 코드에서 사용하기

일반 사용자는 앞의 터미널 명령만 쓰면 됩니다. 다른 Python 작업과 연결하려는 경우에는 CLI와 동일한 변환 함수를 호출할 수 있습니다. 다음 상자 전체를 프로젝트 폴더의 터미널에 한 번에 붙여 넣습니다. 마지막 줄의 `PY`까지 포함하세요.

```bash
uv run --offline python - <<'PY'
from pathlib import Path

from doc2audio.pipeline import Options, convert_document

result = convert_document(
    source=Path("samples/korean.txt"),
    destination=Path("output/model-guide/python.mp3"),
    options=Options(speaker="Sohee", speed=1.0, pause=0.3),
    offline=True,
)
print(result)
PY
```

```bash
open output/model-guide/python.mp3
```

이 함수가 본문 추출부터 모델 로딩, 음성 구간 생성, 이어하기, MP3 저장까지 처리합니다. 처음 실행하면 `python.mp3`가 생깁니다. 다시 실행해 그 파일을 교체하려면 호출 인자에 `overwrite=True`를 추가합니다. 코드의 `Options(instruct="...")`는 CLI의 `--style`에 해당합니다.

MLX 모델을 직접 불러오는 실제 코드와 반환값은 [모델 로딩 과정](architecture.md#모델-로딩-과정)과 [음성 생성 호출](architecture.md#음성-생성-호출)에 설명했습니다. 다른 라이브러리의 예제를 섞지 말고, 이 저장소에 고정된 MLX-Audio 버전과 API를 기준으로 사용하세요.

## 7. 다시 실행하거나 문제가 생겼을 때

- 완료한 구간을 이어 쓰려면 같은 입력 본문·설정과 같은 중간 작업 폴더를 유지합니다. 모든 구간이 이미 유효하면 모델을 다시 불러오지 않고 음성을 합칠 수 있습니다.
- 출력 이름만 바꾸되 같은 폴더에 저장하면 같은 작업의 구간을 재사용할 수 있습니다. 출력 폴더를 바꾸면 기본 중간 작업 폴더도 달라집니다. 필요하면 기존 경로를 `--work-dir`로 지정하세요.
- `--chunk-chars 120`처럼 구간 길이를 줄이면 새 작업이 됩니다. 생성 실패가 반복될 때 짧은 글로 확인하는 용도이며 모델 파일 용량을 줄이지는 않습니다.
- 오류 원인별 조치는 [README의 문제 해결](../README.md#문제-해결), 실행·품질 확인 범위는 [실행 검증](validation.md)을 참고하세요.

옵션의 최종 기준은 아래 도움말과 [CLI 소스](../src/doc2audio/cli.py)입니다.

```bash
uv run doc2audio convert --help
```

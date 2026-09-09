# doc2audio

**PDF·Word·텍스트 문서를 한국어 음성 파일(MP3)로 바꾸는 Mac용 프로그램입니다.** 별도의 조작 화면 없이, Mac의 **터미널**에 명령어를 입력해서 사용합니다. 터미널을 처음 쓰는 분도 아래 순서대로 진행할 수 있도록 설명합니다.

기본 음성은 **Qwen3-TTS 1.7B 모델의 한국어 화자 Sohee**입니다. 모델은 문장을 음성으로 만드는 데 쓰는 파일이며, 처음 한 번 약 **3.1 GB**를 내려받습니다. 모델을 직접 학습하거나 API 키를 발급받을 필요는 없습니다. 설치가 끝나면 문서 추출·이미지 글자 인식·음성 생성을 Mac 안에서 처리하며, 문서와 음성을 외부 서버로 보내지 않습니다.

- 처음 사용한다면: [준비 사항](#준비-사항) → [처음 한 번 설치하기](#처음-한-번-설치하기) → [샘플 듣기](#샘플-듣기)
- 설치를 마쳤다면: [내 문서 변환하기](#내-문서-변환하기)
- 문제가 생겼다면: [문제 해결](#문제-해결)

## 준비 사항

| 항목 | 확인할 내용 |
| --- | --- |
| 컴퓨터 | **Apple Silicon Mac**이 필요합니다. 화면 왼쪽 위  → **이 Mac에 관하여**에서 칩이 Apple M1·M2·M3 등 M 시리즈인지 확인하세요. Intel Mac, Windows, Linux는 이 프로그램의 지원 대상이 아닙니다. |
| 운영체제 | 설치 도구와 MLX의 요구사항은 **macOS 14 이상**입니다. 이 프로젝트의 실제 실행 검증 환경은 macOS 26.6.2입니다. 다른 버전 전체에서 검증한 것은 아닙니다. |
| 저장 공간 | 모델 약 3.1 GB 외에 Python·패키지·중간 음성 파일이 필요합니다. 처음에는 **여유 공간 10 GB 이상을 권장**하며, 긴 문서에는 더 필요합니다. |
| 메모리 | 현재 실행 기록은 메모리 48 GiB인 Mac에서 얻었습니다. 더 작은 메모리에서의 최소 요구량과 처리 속도는 아직 측정하지 않았습니다. |
| 인터넷 | 프로그램과 모델을 처음 설치할 때 필요합니다. 이후에는 [오프라인 실행](#인터넷-없이-실행하기)이 가능합니다. |
| 계정·비용 | 공개 모델 다운로드에 GitHub·Hugging Face 회원가입이나 유료 API 결제가 필요하지 않습니다. |

설치 조건의 출처: [Homebrew](https://docs.brew.sh/Installation), [MLX](https://ml-explore.github.io/mlx/build/html/install.html).

## 처음 한 번 설치하기

이미 설치한 도구가 있다면 해당 단계의 확인 명령만 실행하고 다음으로 넘어가세요. 기존에 이 프로젝트 폴더가 있다면 4단계에서 새로 받지 말고 그 폴더로 이동하면 됩니다.

### 1. 터미널 열기

1. **⌘ Command + Space**를 누릅니다.
2. `터미널`을 입력하고 Return을 누릅니다.
3. 아래 회색 상자에 있는 명령을 복사해 터미널에 붙여 넣고 **Return**을 누릅니다.

명령이 여러 줄이면 위에서부터 한 줄씩 실행하세요. 설명 문장과 코드 상자 바깥의 글자는 입력하지 않습니다. 설치 중에는 진행 메시지가 계속 나올 수 있습니다. 마지막에 `%` 또는 `$`가 있는 입력 줄이 다시 나타나면 다음 명령을 실행할 수 있습니다.

### 2. Homebrew 설치하기

Homebrew는 Mac에 개발 도구를 설치해 주는 프로그램입니다. 먼저 설치되어 있는지 확인합니다.

```bash
brew --version
```

`Homebrew`와 버전 번호가 나오면 **3단계**로 넘어갑니다. `command not found: brew`가 나오면 아래 [Homebrew 공식 설치 명령](https://brew.sh/)을 실행합니다.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

- `Press RETURN/ENTER to continue`가 나오면 Return을 누릅니다.
- `Password:`가 나오면 **Mac 로그인 비밀번호**를 입력하고 Return을 누릅니다. 입력 중 글자나 ●가 표시되지 않는 것이 정상입니다.
- Command Line Tools 설치를 요청하면 화면 안내에 따라 설치하고 기다립니다. 몇 분 이상 걸릴 수 있습니다.
- 설치 마지막의 **Next steps**에 나오는 명령을 실행합니다. 이것은 터미널이 `brew`의 위치를 찾게 하는 설정입니다.

Apple Silicon의 기본 설치 위치를 사용했고 Next steps를 놓쳤다면, 다음 두 줄을 **한 번만** 실행합니다. 첫 줄은 앞으로 여는 터미널에 적용하고, 둘째 줄은 현재 창에 바로 적용합니다.

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

다시 `brew --version`을 실행해 버전이 나오는지 확인하세요.

### 3. uv와 ffmpeg 설치하기

`uv`는 Python과 이 프로그램에 필요한 패키지를 관리합니다. `ffmpeg`는 생성된 음성을 MP3 파일로 저장할 때 사용합니다.

```bash
brew install uv ffmpeg
```

완료되면 아래 명령으로 확인합니다.

```bash
uv --version
ffmpeg -version
```

각각 버전이 나오면 성공입니다. ffmpeg는 여러 줄의 정보를 출력해도 정상입니다. Python은 다음 단계에서 uv가 준비하므로 별도로 설치하지 않아도 됩니다.

### 4. 프로그램을 받고 프로젝트 폴더로 이동하기

아래 명령은 Mac의 **문서(Documents)** 폴더 안에 `doc2audio`를 내려받습니다. GitHub에 로그인할 필요는 없습니다.

```bash
mkdir -p ~/Documents
cd ~/Documents
git clone https://github.com/inininax/doc2audio.git
cd doc2audio
```

`git clone`은 처음 한 번만 실행합니다. 이미 `doc2audio` 폴더가 있다는 오류가 나오면 기존 폴더를 확인하고 사용하세요.

<details>
<summary>Git 대신 ZIP 파일로 받고 싶다면</summary>

1. [프로젝트 페이지](https://github.com/inininax/doc2audio)에서 **Code → Download ZIP**을 누릅니다.
2. 받은 ZIP 파일을 더블 클릭해 압축을 풉니다.
3. 압축을 푼 `doc2audio-main` 폴더 이름을 `doc2audio`로 바꾸고 Finder의 **문서** 폴더에 넣습니다. 같은 이름의 기존 폴더를 덮어쓰지 마세요.
4. 터미널에서 다음 명령으로 이동합니다.

```bash
cd ~/Documents/doc2audio
```

이후 과정은 같습니다. ZIP으로 받은 폴더에서는 Git 업데이트 명령을 사용할 수 없습니다.

</details>

**기존 프로젝트가 다른 위치에 있다면:** 터미널에 `cd `를 입력한 뒤 마지막 공백을 남기고, Finder에서 **프로젝트 폴더**를 터미널로 끌어 놓고 Return을 누릅니다. 터미널이 폴더 경로를 채워 줍니다.

다음 명령으로 현재 폴더의 파일을 확인합니다.

```bash
ls
```

`README.md`, `pyproject.toml`, `samples`, `src` 등이 보이면 맞는 위치입니다. **이후의 `uv` 명령은 모두 이 프로젝트 폴더에서 실행합니다.** 터미널 창을 새로 열면 다시 이 폴더로 이동해야 합니다.

### 5. Python과 필요한 패키지 설치하기

```bash
uv sync --locked
```

uv가 프로젝트에 지정된 **Python 3.12**와 필요한 패키지를 설치합니다. 프로젝트 안에 `.venv`라는 전용 실행 환경이 생깁니다. 따로 활성화 명령을 입력할 필요는 없습니다. 다운로드·설치가 끝날 때까지 기다리세요. [uv의 Python 준비 방식](https://docs.astral.sh/uv/concepts/python-versions/)을 사용합니다.

설치 후 확인합니다.

```bash
uv run python --version
```

`Python 3.12.x`가 나오면 됩니다. 마지막 숫자는 설치 시점에 따라 다를 수 있습니다.

### 6. 음성 모델 설치하기

다음 명령으로 이 프로그램이 사용하는 음성 모델을 내려받습니다.

```bash
uv run doc2audio download
```

| 항목 | 설치되는 내용 |
| --- | --- |
| 모델 | `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit` |
| 용량 | 약 3.1 GB |
| 저장 위치 | 프로젝트 안의 `.models/qwen3-tts-1.7b-8bit/` |
| 기본 화자 | 한국어 `Sohee` |
| 다운로드 사이트 | [Hugging Face 모델 페이지](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit) |

인터넷 속도에 따라 몇 분 이상 걸릴 수 있습니다. 진행률이 여러 번 나타나는 것은 여러 파일을 받기 때문입니다. **마지막에 `모델 준비 완료:`와 저장 경로가 나오면 설치가 끝난 것입니다.**

브라우저에서 모델 파일을 하나씩 받거나, Hugging Face에 로그인하거나, 모델을 학습할 필요는 없습니다. 프로그램이 지정된 버전의 필요한 파일을 받습니다. 다운로드가 중단되면 인터넷 연결과 저장 공간을 확인한 뒤 같은 명령을 다시 실행하세요. 이미 준비된 파일은 다시 확인해 사용합니다.

`.models`처럼 점으로 시작하는 폴더는 Finder에서 기본적으로 숨겨집니다. Finder에서 **⌘ Command + Shift + .**을 누르면 볼 수 있습니다. 모델 폴더를 지우거나 옮기지 않는 한 매번 설치할 필요는 없습니다.

### 7. 설치 상태 확인하기

```bash
uv run doc2audio doctor
```

다음 항목을 확인하세요. 버전 번호와 경로는 Mac마다 다를 수 있습니다.

```text
플랫폼: Darwin arm64 · OK
Python: 3.12.x
ffmpeg: /opt/homebrew/bin/ffmpeg
DOC 변환: /usr/bin/textutil
Metal GPU: OK
모델: mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit
리비전: ...
모델 파일: OK
```

`Metal GPU: OK`는 Mac의 GPU를 사용할 수 있다는 뜻입니다. `모델 파일: OK`는 모델 파일이 준비됐다는 뜻입니다. 실제 음성 생성까지 확인하려면 바로 아래 샘플을 실행합니다. `없음`이나 오류가 나오면 [문제 해결](#문제-해결)을 확인하세요.

## 샘플 듣기

프로그램에 포함된 짧은 한국어 글로 먼저 확인합니다. 아래 명령은 `samples/korean.txt`를 읽어 `output/sample.mp3`를 만듭니다. 출력 폴더는 자동으로 생깁니다.

```bash
uv run doc2audio samples/korean.txt -o output/sample.mp3
```

첫 실행에는 모델을 메모리로 읽어 오는 시간이 추가됩니다. `생성` 등의 진행 메시지가 나오면 기다리세요. 마지막에 출력 경로와 길이 등을 담은 결과가 나오고 터미널 입력 줄로 돌아오면 완료입니다.

```bash
open output/sample.mp3
```

Mac의 기본 오디오 앱이 열리며, 필요하면 재생 버튼을 누릅니다. 파일이 있는 폴더를 열려면 다음을 실행합니다.

```bash
open output
```

검증에 사용한 Mac에서는 이 샘플의 음성이 약 37초 길이였고, 최초 변환에 약 42초가 걸렸습니다. Mac 사양과 실행 상태에 따라 달라집니다. 처음부터 긴 책 전체를 변환하기보다 샘플의 목소리와 발음을 먼저 확인하세요.

샘플을 다시 만들 때 기존 파일을 교체하려면 다음처럼 `--overwrite`를 붙입니다. 완료한 음성 구간이 남아 있으면 재사용합니다.

```bash
uv run doc2audio samples/korean.txt -o output/sample.mp3 --overwrite
```

## 내 문서 변환하기

### 매번 사용하는 기본 순서

아래는 처음 설치할 때 `~/Documents/doc2audio`에 프로그램을 받은 경우입니다. 다른 위치에 받았다면 해당 프로젝트 폴더로 이동하세요. `~`는 내 사용자 폴더를 뜻합니다.

```bash
cd ~/Documents/doc2audio
mkdir -p input output
open input
```

1. Finder에서 열린 `input` 폴더에 읽을 문서를 복사합니다. 원본을 따로 보관해도 됩니다.
2. 예를 들어 파일 이름이 **읽을 문서.pdf**라면 다음 명령을 실행합니다. 실제 파일 이름에 맞게 바꾸고, 공백이 있는 경로는 아래처럼 큰따옴표로 감쌉니다.

```bash
uv run doc2audio "input/읽을 문서.pdf" -o "output/읽을 문서.mp3"
```

3. 완료되면 음성을 엽니다.

```bash
open "output/읽을 문서.mp3"
```

`input`은 문서를 모아 두는 폴더, `output`은 음성을 모아 두는 폴더입니다. 명령의 첫 경로는 **읽을 문서**, `-o` 뒤의 경로는 **저장할 음성 파일**입니다. 파일 이름은 자유롭게 정할 수 있습니다. Word 파일의 `.docx`나 `.doc` 확장자를 `.pdf`로 바꾸지는 마세요.

### Word와 텍스트 파일

실제 파일 이름으로 바꿔 실행합니다.

```bash
uv run doc2audio "input/회의 자료.docx" -o "output/회의 자료.mp3"
uv run doc2audio "input/예전 문서.doc" -o "output/예전 문서.mp3"
uv run doc2audio "input/메모.txt" -o "output/메모.mp3"
```

### 파일을 옮기지 않고 바로 변환하기

1. 프로젝트 폴더로 이동한 터미널에 `uv run doc2audio `를 입력합니다. **마지막 공백을 남기고 아직 Return을 누르지 않습니다.**
2. Finder에서 읽을 **문서 파일**을 터미널 창으로 끌어 놓습니다. 파일 경로가 자동으로 들어갑니다.
3. Return을 누릅니다.

`-o`를 생략하면 **원본 문서와 같은 폴더에, 같은 이름의 `.mp3`**가 생깁니다. 원본 문서는 수정하지 않습니다. 기존 MP3가 있으면 중단하므로, 다른 출력 이름을 정하거나 교체할 때만 `--overwrite`를 붙이세요.

## 자주 쓰는 기능

아래 명령의 입력 파일 이름은 실제 문서에 맞게 바꿉니다. 각 예제의 출력 파일이 이미 있다면 다른 이름을 쓰거나 `--overwrite`를 추가합니다.

### 긴 PDF는 일부 페이지만 먼저 듣기

```bash
uv run doc2audio "input/읽을 문서.pdf" --pages 1-2 -o output/preview.mp3
open output/preview.mp3
```

`--pages 1-2`는 PDF 파일의 첫 번째와 두 번째 페이지입니다. 책 본문에 인쇄된 쪽 번호와 다를 수 있습니다. `--pages 1-3,5`처럼 범위와 개별 페이지를 섞어 쓸 수 있습니다. 이 옵션은 PDF에만 적용됩니다.

### 읽을 본문을 음성 생성 전에 확인하기

```bash
uv run doc2audio extract "input/읽을 문서.pdf" -o output/text.txt
open -e output/text.txt
```

Mac의 텍스트 편집기에서 추출된 글을 확인합니다. **본문 추출에는 음성 모델이 필요하지 않습니다.** 순서나 내용이 잘못 추출되었다면 `text.txt`를 수정·저장한 뒤 그 파일로 음성을 만들 수 있습니다.

```bash
uv run doc2audio output/text.txt -o output/corrected.mp3
```

저장할 때는 일반 텍스트(UTF-8)를 유지하세요. 표·수식·날짜·금액이 중요한 문서는 본문과 미리듣기를 함께 확인하는 것이 좋습니다.

### 스캔 PDF와 이미지 속 글자 읽기

OCR은 이미지에 있는 글자를 찾아 텍스트로 바꾸는 기능입니다. 기본값인 `--ocr auto`는 텍스트가 없거나 스캔으로 보이는 PDF 페이지에서 자동으로 사용합니다. **OCR 프로그램이나 모델을 별도로 설치하지 않아도 되며**, macOS Vision으로 기기 안에서 처리합니다.

일부 글자를 놓치는 PDF는 모든 선택 페이지에 OCR을 적용해 볼 수 있습니다.

```bash
uv run doc2audio "input/스캔.pdf" --ocr always -o output/scan.mp3
```

OCR을 사용하지 않고 PDF에 들어 있는 텍스트만 읽으려면 `--ocr never`를 사용합니다. 흐리거나 복잡한 문서는 글자와 읽는 순서가 틀릴 수 있으므로 먼저 `extract` 결과를 확인하세요.

### 속도·말투·파일 형식 바꾸기

```bash
uv run doc2audio "input/읽을 문서.pdf" --speed 1.1 -o output/faster.mp3
uv run doc2audio "input/읽을 문서.pdf" --style "차분하고 또렷한 한국어 설명체로 읽어 주세요." -o output/calm.mp3
uv run doc2audio "input/읽을 문서.pdf" -o output/narration.wav
```

- `--speed 1.0`이 기본입니다. `1.1`은 조금 빠르게, `0.9`는 조금 느리게 재생되는 음성을 만듭니다. 범위는 `0.5`~`2.0`입니다.
- `--style`은 모델에 전달하는 말투 요청입니다. 실제 반영 정도는 문장과 모델에 따라 다릅니다.
- 기본 MP3는 24 kHz 모노 / 128 kbps입니다. 출력 이름을 `.wav`로 끝내면 무손실 WAV를 만들며, 보통 MP3보다 용량이 큽니다.
- 기본적으로 문장·문단을 최대 240자 단위로 나누고, 구간 사이에 0.3초 쉽니다. `--pause 0.5`처럼 쉬는 시간을 초 단위로 바꿀 수 있습니다.

### 약어와 고유명사 발음 지정하기

프로젝트에 예제 발음 사전이 들어 있습니다. 처음 한 번 복사해 내 사전을 만듭니다.

```bash
mkdir -p input
cp samples/pronunciations.example.json input/pronunciations.json
open -e input/pronunciations.json
```

텍스트 편집기에서 다음 형태를 유지하며 수정하고 **⌘ Command + S**로 저장합니다. 이미 내 사전을 만들었다면 `cp`는 다시 실행하지 말고 기존 파일을 여세요.

```json
{
  "PDF": "피디에프",
  "Trustay": "트러스테이"
}
```

왼쪽은 원문 표현, 오른쪽은 읽을 표현입니다. 큰따옴표와 쉼표를 유지하고 마지막 항목 뒤에는 쉼표를 넣지 않습니다. 다음 명령에서 사전을 지정합니다.

```bash
uv run doc2audio "input/읽을 문서.pdf" --pronunciations input/pronunciations.json -o output/pronounced.mp3
```

사전은 대소문자를 구분하며, 긴 표현부터 정확히 일치하는 문자열을 한 번만 바꿉니다. 원본 문서는 수정하지 않습니다. 추출 결과에도 적용하려면 `extract` 명령에 같은 `--pronunciations` 옵션을 붙입니다.

### 인터넷 없이 실행하기

설치·모델 다운로드·샘플 실행까지 마친 후 사용하세요.

```bash
uv run --offline doc2audio "input/읽을 문서.pdf" --offline -o output/offline.mp3
```

앞의 `--offline`은 uv의 네트워크 사용을 막고, 뒤의 `--offline`은 프로그램의 모델 다운로드를 막습니다. 필요한 패키지나 모델 파일이 없으면 오류가 나므로, 인터넷이 연결되어 있을 때 설치 과정을 먼저 마쳐야 합니다.

## 중단 후 이어하기와 파일 보관

긴 문서를 읽는 동안에는 Mac이 잠자기에 들어가지 않도록 하고, 터미널 창을 열어 두세요. 멈추려면 터미널에서 **Control + C**를 누릅니다. 나중에 **같은 프로젝트 폴더에서 같은 명령**을 다시 실행하면 완료한 구간을 확인해 재사용하고, 남은 부분을 이어서 만듭니다. 중단 시점의 미완료 구간은 다시 생성할 수 있습니다.

출력을 `output/`에 저장했다면 대략 다음 구조가 됩니다.

```text
doc2audio/
├── .venv/              Python과 패키지
├── .models/            내려받은 음성 모델
├── input/              내가 복사한 문서와 발음 사전
└── output/
    ├── sample.mp3      완성된 음성
    └── .doc2audio/     추출 본문과 구간별 중간 음성
```

중간 작업 폴더 `.doc2audio`는 기본적으로 **출력 파일이 있는 폴더**에 만들어집니다. `-o`를 생략했다면 원본 문서가 있는 폴더를 확인하세요. 문서나 음성 설정이 달라지면 별도 작업으로 처리합니다.

완성된 MP3는 일반 파일이므로 다른 폴더로 옮기거나 휴대폰으로 복사해 들을 수 있습니다. 중간 파일이 필요 없어지면 Finder에서 해당 `.doc2audio` 작업 폴더를 지울 수 있지만, 그 작업의 이어하기 정보도 없어집니다. `.models`를 지우면 모델을 다시 받아야 합니다. 문서와 생성 음성은 Git에 포함되지 않습니다.

## 문제 해결

| 증상 | 해결 방법 |
| --- | --- |
| `command not found: brew` | Homebrew 설치를 마친 뒤 2단계의 Next steps 설정을 실행하고 `brew --version`을 확인합니다. |
| `command not found: uv` 또는 ffmpeg를 찾지 못함 | `brew install uv ffmpeg`를 실행합니다. 설치되어 있다면 Homebrew 경로 설정 후 터미널을 새로 열고 프로젝트 폴더로 다시 이동합니다. |
| `pyproject.toml`을 찾을 수 없음 | 프로젝트 폴더 밖에서 실행한 것입니다. `cd ~/Documents/doc2audio` 또는 실제 설치 경로로 이동하고 `ls`로 확인합니다. |
| `destination path 'doc2audio' already exists` | 이미 같은 이름의 폴더가 있습니다. 기존 프로젝트라면 그 폴더로 이동해 설치를 이어갑니다. 다른 파일이 든 폴더라면 새 위치에 받습니다. |
| 모델 다운로드 오류 또는 `모델 파일: 다운로드 필요` | 인터넷과 저장 공간을 확인한 뒤 `uv run doc2audio download`를 다시 실행합니다. `doctor`로 준비 상태를 확인합니다. |
| `Metal GPU` 오류 또는 플랫폼 오류 | M 시리즈 Mac인지 확인합니다. 터미널에서 `uname -m`이 `arm64`여야 합니다. `x86_64`라면 Intel Mac이거나 Rosetta로 실행 중일 수 있습니다. Apple Silicon에서는 Rosetta를 사용하지 않는 터미널로 설치·실행하세요. |
| 입력 파일을 찾을 수 없음 | Finder에서 실제 파일 이름과 확장자를 확인합니다. 경로 전체를 큰따옴표로 감싸거나 문서를 터미널에 끌어 놓아 경로를 입력합니다. |
| 출력 파일이 이미 있다는 오류 | 다른 출력 이름을 지정합니다. 기존 음성을 교체하려는 경우에만 명령 끝에 `--overwrite`를 붙입니다. |
| PDF에서 글자가 추출되지 않음 | `--ocr always`로 추출을 시도합니다. 암호화된 PDF는 암호를 해제한 사본이 필요합니다. |
| Word의 변경 추적 관련 오류 | Word에서 변경 내용을 검토·수락한 사본을 저장해 사용합니다. 원본 파일은 보관하세요. |
| JSON 발음 사전 오류 | 일반 큰따옴표 `"`와 쉼표 위치를 확인합니다. 예제 파일을 참고하고, 마지막 항목 뒤의 쉼표는 제거합니다. |
| 오래 걸리거나 메모리 부족으로 종료됨 | 다른 무거운 앱을 닫고 다시 실행합니다. PDF는 `--pages 1-2`로 먼저 확인하세요. 페이지 수를 줄여도 모델 자체의 메모리 사용량은 줄지 않습니다. |
| 음성 생성 실패·길이 제한 오류 | 같은 명령으로 완료 구간부터 재개해 봅니다. 반복되면 `--chunk-chars 120`을 추가해 더 짧게 나누거나, 추출한 본문에서 문제 문장을 확인합니다. 설정을 바꾸면 새 작업으로 처리됩니다. |
| 인터넷을 끄니 실행되지 않음 | 온라인 상태에서 `uv sync --locked`, 모델 다운로드, 샘플 실행을 마쳤는지 확인합니다. 다른 프로젝트 폴더나 다른 모델 경로를 사용하고 있지 않은지도 확인합니다. |

모든 명령과 옵션은 다음으로 확인할 수 있습니다. `convert`는 일반 변환 명령을 명시적으로 쓰는 이름이며, 평소에는 생략할 수 있습니다.

```bash
uv run doc2audio --help
uv run doc2audio convert --help
uv run doc2audio extract --help
```

## 문서 지원 범위

- **PDF:** 텍스트를 추출하고, 필요하면 macOS Vision의 한국어·영어 OCR로 처리합니다. 복잡한 다단 편집·수식·표에서는 읽는 순서를 확인해야 합니다.
- **DOCX:** 본문과 표를 문서 순서대로 읽습니다. 머리말·꼬리말은 제외합니다. 텍스트 상자·각주·미주·이미지 속 글자까지 읽으려면 Word에서 PDF로 내보내 처리하세요.
- **DOC:** macOS 기본 `textutil`로 메모리에서 DOCX로 변환한 뒤 읽습니다. 원본은 수정하지 않습니다.
- **TXT:** UTF-8로 저장된 일반 텍스트를 읽습니다.

문서를 요약하거나 번역하는 프로그램은 아닙니다. OCR과 발음은 틀릴 수 있으므로 중요한 숫자·이름·단위는 본문과 음성을 확인하세요. 모델의 음성 종료가 감지되지 않으면 짧은 구간으로 나누는 등 제한된 재시도를 하며, 계속 실패할 경우 잘린 음성을 완성 파일로 저장하지 않고 오류를 반환합니다.

## 개발 및 검증 자료

일반 사용자는 이 절의 추가 검증 모델을 설치할 필요가 없습니다. 모델 선택 근거는 [모델 조사](docs/model-research.md), 실제 실행 환경·시간·품질 점검 범위는 [실행 검증](docs/validation.md)에 있습니다.

<details>
<summary>개발자용 검사 명령과 모델 저장 위치 변경</summary>

프로젝트 루트에서 실행합니다.

```bash
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
uv lock --check
uv build
python3 scripts/ai-env.py check
```

실제 모델로 PDF·Word·스캔 PDF를 점검하는 명령입니다. 음성과 보고서는 로컬 `output/validation/`에 생성됩니다.

```bash
uv run python scripts/verify_runtime.py
```

선택적으로 별도의 음성 인식 모델로 생성된 음성의 내용을 비교합니다. 일반 변환용 TTS 모델과 별개이며, 다음 명령은 ASR 모델 약 1.01 GB를 추가로 내려받습니다.

```bash
uv run python scripts/verify_speech.py --download
```

TTS 모델을 다른 폴더에 저장하려면 **동일한 `--model-dir`을 다운로드·점검·변환에 모두 지정**합니다. 아래 경로는 원하는 실제 경로로 바꾸세요. 이 옵션은 지정된 Qwen 모델의 저장 위치를 바꾸며, 임의의 다른 모델을 지원한다는 뜻은 아닙니다.

```bash
uv run doc2audio download --model-dir "/Volumes/외장디스크/doc2audio-model"
uv run doc2audio doctor --model-dir "/Volumes/외장디스크/doc2audio-model"
uv run doc2audio "input/읽을 문서.pdf" --model-dir "/Volumes/외장디스크/doc2audio-model" -o output/external-model.mp3
```

Codex·Claude Code 공통 개발 지침은 [AGENTS.md](AGENTS.md), 관리 방법은 [AI 환경 안내](.agents/ENVIRONMENT.md)에 있습니다.

</details>

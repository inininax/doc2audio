# 내부 동작 기술 문서

[README로 돌아가기](../README.md) · [모델 사용 가이드](model-usage.md)

이 문서는 현재 저장소의 구현을 기준으로, 문서가 어떤 과정을 거쳐 로컬 음성이 되는지 설명합니다. 설치와 실행 명령은 README와 모델 사용 가이드를 참고하세요.

## 전체 흐름

```text
사용자가 지정한 문서 하나
    ↓
PDF / DOCX / DOC / UTF-8 TXT 본문 추출
    ↓
본문 정규화 → 선택한 발음 사전 적용 → 짧은 구간으로 분할
    ↓
본문·모델 버전·설정으로 작업 ID 계산
    ↓
구간별 저장 음성 확인
    ├─ 유효한 WAV가 있음 → 재사용
    └─ 없음 → 로컬 모델 준비 → MLX 로딩 → 한국어 음성 생성 → WAV 저장
    ↓
WAV를 순서대로 결합하고 구간 사이 쉼 삽입
    ↓
ffmpeg로 속도·음량 조정 → MP3 또는 WAV 저장
```

문서 내용을 요약·번역하거나 별도 대화 모델에 보내는 단계는 없습니다. 원문에서 읽을 글을 추출하고, 그 글을 TTS 모델에 전달합니다. 이미지 글자 인식이 필요한 PDF는 macOS Vision을 로컬에서 사용합니다.

| 책임 | 소스 |
| --- | --- |
| 터미널 명령·옵션 해석, 결과 출력 | [cli.py](../src/doc2audio/cli.py) |
| 문서 형식별 추출·페이지 선택·OCR 판단 | [documents.py](../src/doc2audio/documents.py) |
| macOS Vision OCR | [documents.py의 recognize_image](../src/doc2audio/documents.py) |
| 본문 정규화·발음 사전·구간 분할 | [text.py](../src/doc2audio/text.py) |
| 모델 파일 확인·다운로드·MLX 로딩·생성 호출 | [model.py](../src/doc2audio/model.py) |
| 전체 처리 순서·작업 ID·캐시·이어하기 | [pipeline.py](../src/doc2audio/pipeline.py) |
| 음성 유효성 검사·결합·속도와 음량·파일 저장 | [audio.py](../src/doc2audio/audio.py) |

## 사용 모델과 실행 환경

| 항목 | 현재 구현 |
| --- | --- |
| 모델 | `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit` |
| 고정 리비전 | `41d3337e8b7f2843a75841595fc14e4b9a7a4b96` |
| 모델 종류 | Qwen3-TTS 1.7B CustomVoice, MLX 8bit 변환본 |
| 모델 구성의 양자화 설정 | `bits=8`, `group_size=64`, `mode=affine` |
| 기본 모델 경로 | 프로젝트의 `.models/qwen3-tts-1.7b-8bit/` |
| Python | 3.12 계열 |
| 음성 실행 라이브러리 | `mlx-audio==0.5.3` |
| 하드웨어 | Apple Silicon Mac, Metal GPU |
| 생성 언어·기본 화자 | `Korean` · `Sohee` |
| 구간 음성 | 24,000 Hz, 모노 WAV, PCM 16bit |

Qwen의 CustomVoice 모델은 미리 정해진 화자와 말투 지시를 받는 모델입니다. 이 프로젝트는 그 모델을 Apple Silicon에서 실행하도록 변환한 MLX 버전을 사용합니다. 원본 모델의 설명은 [Qwen 공식 모델 카드](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice), 변환본은 [MLX 모델 카드](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit), 실행 라이브러리는 [MLX-Audio](https://github.com/Blaizzy/mlx-audio)를 참고하세요.

버전의 기준은 [pyproject.toml](../pyproject.toml), [uv.lock](../uv.lock), `model.py`입니다. 모델 카드의 다른 실행 예제가 최신 버전이나 PyTorch·CUDA를 사용하더라도, 이 프로젝트는 고정된 MLX 경로를 사용합니다.

## 다운로드와 로딩은 별도 단계

### 모델 파일 준비

`doc2audio download`는 `ensure_model()`을 호출합니다. 변환 명령도 새 음성을 생성해야 할 때 이 함수를 호출하므로, 모델이 없다면 기본적으로 다운로드를 시도합니다. `--offline`을 지정하면 부족한 파일을 내려받지 않고 오류를 반환합니다.

1. Mac의 운영체제와 CPU 아키텍처가 `Darwin arm64`인지 확인합니다.
2. `MODEL_FILES`에 지정된 12개 필수 파일의 존재와 **파일 크기**를 확인합니다.
3. 부족한 파일과 여유 공간을 확인하고, 필요한 경우 `huggingface_hub.snapshot_download()`를 호출합니다.
4. 다운로드 후 파일 크기를 다시 확인하고 로컬 모델 경로를 반환합니다.

주요 다운로드 인자는 다음과 같습니다. 아래 Python 조각은 호출 구조를 설명하기 위한 것이며, 직접 실행하는 예제는 [모델 사용 가이드](model-usage.md#6-python-코드에서-사용하기)에 있습니다.

```python
snapshot_download(
    MODEL_ID,
    revision=MODEL_REVISION,
    local_dir=path,
    token=False,
    max_workers=3,
    allow_patterns=list(MODEL_FILES),
)
```

`token=False`로 로그인 토큰 없이 공개 파일을 받고, 지정한 리비전의 필요한 파일만 요청합니다. 필수 파일 합계는 **3,080,138,901바이트**입니다. 주요 구성은 다음과 같습니다.

| 파일 | 역할 |
| --- | --- |
| `config.json` | 모델 구조, 양자화, 화자 등의 설정 |
| `model.safetensors` | 음성 생성 모델의 학습된 수치인 가중치 |
| `model.safetensors.index.json` | 가중치 파일의 구성 정보 |
| `tokenizer_config.json`, `vocab.json`, `merges.txt` | 글을 모델이 처리할 토큰으로 바꾸는 설정·어휘 |
| `speech_tokenizer/` | 음성 토큰과 오디오를 다루는 별도 모델·설정 |
| `generation_config.json`, `preprocessor_config.json` | 생성·전처리 설정 |

현재 로컬 준비 검사는 파일 이름과 크기를 대조합니다. 모델 파일 전체의 SHA-256을 대조하는 검사는 아닙니다. 아래에서 설명하는 **생성 WAV 캐시의 SHA-256 검사**와 구분해야 합니다.

### 모델 로딩 과정

`QwenNarrator.__init__()`은 준비된 로컬 폴더를 MLX-Audio 로더에 넘깁니다.

```python
import os

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

from mlx_audio.tts.utils import load_model

model = load_model(path)
```

실제 구현은 Metal GPU 사용 가능 여부도 확인합니다. `load_model(path)`가 로컬 설정과 가중치를 읽어 모델을 만들며, 이 프로젝트에 설치된 버전의 기본값은 `lazy=False`, `strict=True`입니다. 로딩 후 텍스트 토크나이저와 음성 토크나이저가 준비됐는지, 지정한 화자가 `model.supported_speakers`에 있는지 확인합니다.

모델은 **첫 번째 미완료 구간을 생성할 때 한 번** 불러옵니다. 이후 같은 명령의 모든 구간에서 같은 `QwenNarrator` 인스턴스를 사용합니다. 새 명령으로 새 음성을 만들면 다시 로딩하며, 별도 상주 서버는 없습니다. 모든 구간을 캐시에서 재사용할 수 있으면 모델 다운로드·로딩을 모두 건너뜁니다.

## 음성 생성 호출

`pipeline.py`는 구간마다 `narrator.generate(chunk, seed)`를 호출합니다. `QwenNarrator._generate_once()`의 핵심 호출은 다음과 같습니다.

```python
mx.random.seed(seed)
max_tokens = max(256, len(text) * 5 + 128)
results = self.model.generate_custom_voice(
    text=text,
    speaker=self.speaker,
    language="Korean",
    instruct=self.instruct,
    temperature=0.7,
    top_p=0.9,
    repetition_penalty=1.05,
    max_tokens=max_tokens,
    verbose=False,
)
```

| 인자 | 들어가는 값과 역할 |
| --- | --- |
| `text` | 정규화와 발음 치환을 마친 구간의 글 |
| `speaker` | CLI `--speaker`, 기본 `Sohee` |
| `language` | 코드에 고정된 `Korean` |
| `instruct` | CLI `--style`에서 받은 말투 지시 |
| `temperature`, `top_p` | 생성할 후보를 선택할 때 쓰는 고정 샘플링 설정 |
| `repetition_penalty` | 반복을 줄이기 위한 생성 설정 |
| `max_tokens` | 글 길이에 비례한 생성 상한. 도달하면 성공으로 취급하지 않음 |

기본 seed는 42이며 구간마다 `(설정 seed + 0부터 시작하는 구간 번호) % 2**32`를 사용합니다. 모델은 텍스트 토큰을 바탕으로 음성 토큰을 생성하고, 음성 토크나이저를 통해 오디오 배열로 반환합니다. 앱은 모델 내부의 학습을 수행하지 않습니다.

`generate_custom_voice()`의 반환값은 결과를 순회하는 생성기입니다. 앱은 각 결과의 `audio`, `sample_rate`, `token_count`를 읽고 오디오를 NumPy `float32` 배열로 합칩니다. 반환 형태를 `(wav, rate)` 튜플로 가정하거나, 다른 라이브러리의 `Qwen3TTSModel.from_pretrained()` 예제를 그대로 붙이면 현재 코드와 맞지 않습니다.

토큰 상한에 도달하면 잘린 음성을 완료로 저장하지 않습니다. 해당 글을 더 짧게 나누어 제한된 깊이로 재시도하고, 더 나누기 어렵거나 분할 재시도가 제한에 도달하면 seed를 바꾸어 한 번 더 시도합니다. 계속 실패하면 오류로 종료합니다. 생성 결과의 샘플레이트는 24 kHz인지 검사합니다.

## 문서에서 모델 입력을 만드는 방법

`extract_document()`는 명령에 지정한 **파일 하나**를 읽습니다. 같은 폴더의 다른 문서는 자동으로 참조하지 않습니다.

- PDF는 PyMuPDF로 텍스트를 추출합니다. `--pages`는 파일 안의 1부터 시작하는 페이지 번호를 선택합니다. OCR이 필요한 페이지는 로컬 macOS Vision으로 처리합니다.
- DOCX는 본문과 표를 문서 순서대로 읽습니다. 지원 범위 밖의 요소는 경고하거나 제외하며, 상세 범위는 [README](../README.md#문서-지원-범위)에 있습니다.
- DOC는 macOS `textutil`로 DOCX로 바꾸어 읽습니다.
- TXT는 UTF-8 텍스트를 읽습니다. MD 입력은 지원하지 않습니다.

이후 `text.py`에서 유니코드·공백 등을 정리하고 문단 안의 줄바꿈을 연결합니다. 발음 사전이 있으면 긴 키부터 대소문자를 구분하는 문자열 치환을 한 번 적용합니다. 예를 들어 `PDF`를 `피디에프`로 바꾸는 처리는 모델 입력에 적용되며 원본 파일은 수정하지 않습니다.

`split_text()`는 기본 최대 240자로 글을 나눕니다. 문단 경계를 유지하고 문장·쉼표·공백을 경계로 나누며, 필요한 경우 글자 수로 나눕니다. 짧은 문단을 다음 문단과 합쳐 무조건 240자를 채우지는 않습니다. 따라서 PDF 추출 결과에 불필요한 빈 줄이 많으면 짧은 구간이 많이 생길 수 있습니다.

PDF의 반복 쪽번호나 인쇄용 줄바꿈을 책마다 알맞게 제거하는 기능은 없습니다. 별도로 본문을 정리했다면 원문 PDF와 최종 TXT를 보관하고 TXT를 입력으로 사용합니다. **개별 문서를 위해 수행한 수동 정리는 앱의 자동 추출 기능과 구분합니다.**

## 작업 기록과 이어하기

`pipeline.py`는 다음 정보를 JSON으로 직렬화해 SHA-256을 계산하고, 앞 24자리로 작업 ID를 만듭니다.

- 앱 버전, 모델 ID, 모델 리비전
- 모든 `Options`: 화자, 말투, 구간 최대 글자 수, seed, 속도, 쉼
- 실제로 읽을 구간별 텍스트 목록

파일 경로 자체로 작업을 구분하지 않습니다. 본문과 설정이 같고 동일한 작업 폴더를 사용하면, 출력 이름이 달라도 저장 구간을 재사용할 수 있습니다. 반대로 속도·쉼도 식별에 포함되므로 후처리 값만 바꾸어도 새 작업 ID가 생깁니다.

기본 저장 구조는 다음과 같습니다. `작업ID`는 실제 해시 문자열로 바뀝니다.

```text
output/
├── narration.mp3
└── .doc2audio/
    └── 작업ID/
        ├── manifest.json    모델·설정·구간 본문·완료 기록·최종 결과
        ├── extracted.txt    추출한 본문
        ├── narration.txt    발음 사전 적용 후 본문
        ├── job.lock         같은 작업의 동시 실행 방지
        ├── 00000.wav        첫 구간 음성
        └── 00001.wav        다음 구간 음성
```

중간 작업 폴더는 기본적으로 출력 파일의 상위 폴더 아래에 생깁니다. `--work-dir`은 이 `.doc2audio`에 해당하는 위치를 바꾸며 그 아래에 작업 ID 폴더가 만들어집니다. 출력 폴더를 옮기면 기본 캐시 위치도 바뀐다는 점에 주의하세요.

재실행 시 WAV 형식·채널·샘플레이트와 `manifest.json`의 SHA-256이 일치한 구간만 재사용합니다. 유효하지 않은 구간은 다시 생성합니다. 각 구간과 JSON은 임시 파일을 완성한 뒤 교체하고, `fcntl` 잠금으로 같은 작업을 동시에 처리하지 않도록 합니다.

이어하기는 중간 WAV 재사용 기능입니다. 이미 완성된 출력 파일을 교체할 권한까지 의미하지 않으므로, 같은 출력이 존재하면 여전히 `--overwrite`가 필요합니다. 작업 폴더에는 본문과 음성이 들어 있으므로 `input/`, `output/`, `.doc2audio/`, `.models/`는 Git에서 제외합니다.

## 음성 후처리와 최종 저장

`prepare_audio()`는 비어 있거나 너무 짧은 오디오, 유효하지 않은 수치, 무음에 가까운 결과를 거부합니다. 필요한 경우 피크 크기를 조절하고 양끝의 긴 무음을 다듬으며, 경계에 짧은 페이드를 적용합니다. 이 결과를 24 kHz 모노 PCM 16bit WAV로 저장합니다.

`encode_audio()`는 WAV를 작은 블록으로 읽어 임시 결합 파일에 기록합니다. 전체 책의 오디오를 하나의 큰 메모리 배열로 올리지 않습니다. 기본 0.3초의 무음을 구간 사이에 넣은 후 ffmpeg로 다음 처리를 합니다.

| 처리 | 설정 |
| --- | --- |
| 재생 속도 | `atempo`, 기본 `1.0` |
| 음량 조정 | `loudnorm=I=-18:TP=-1.5:LRA=11` |
| 샘플레이트·채널 | 24 kHz, 모노 |
| MP3 | `libmp3lame`, 128 kbps |
| WAV | `pcm_s16le` |

완성된 임시 출력만 최종 경로로 게시합니다. 기본 동작은 이미 있는 파일을 덮어쓰지 않으며, `--overwrite`일 때만 교체합니다. 정상 완료 후 임시 결합 파일은 정리하고 이어하기용 WAV와 기록은 남깁니다.

## 검증 범위와 확장 시 확인할 점

환경 점검 `doctor`는 설치된 파일과 Metal·ffmpeg 사용 가능 여부를 확인합니다. 실제 생성 검증은 짧은 본문으로 CLI 또는 Python 변환을 실행하고 결과 오디오를 확인해야 합니다. 테스트와 실행 기록은 [실행 검증 문서](validation.md)에 있습니다. 파일이 정상 디코딩된다는 사실만으로 모든 단어의 발음이나 낭독 품질이 검증된 것은 아닙니다.

현재 CLI에는 모델 ID 변경, 음성 복제, 모델 학습, 다국어 선택, 외부 API TTS, 웹 서버가 구현되어 있지 않습니다. `--model-dir`은 같은 고정 모델의 위치만 바꿉니다. 다른 모델을 도입하려면 파일 준비·로더·생성 API·출력 형식·작업 ID를 함께 검토하고 실제 모델로 테스트해야 합니다.

# 한국어 로컬 TTS 모델 조사

조사·구현 확인일: **2026-09-09~10**. Hugging Face 모델 카드·공개 파일 목록, 제작사 저장소·논문과 설치된 MLX-Audio 0.5.3 구현을 확인했습니다.

## 선택

**Qwen3-TTS-12Hz-1.7B-CustomVoice + Sohee**, 실행 가중치는 **mlx-community의 8bit 변환본**을 사용합니다. 현재 공개된 모든 모델의 절대적인 음질 1위라는 뜻은 아닙니다. 한국어 문서 낭독, 별도 참조 녹음 없음, 무료 로컬 실행, 현재 Apple Silicon Mac이라는 조건을 함께 적용한 선택입니다.

- 공식 모델은 한국어를 지원하며, `Sohee`는 한국어가 모국어인 기본 여성 화자입니다. 제작사는 화자의 모국어 사용을 권장합니다. 1.7B CustomVoice는 별도 음성 녹음 없이 스타일 지시문을 적용할 수 있습니다. [공식 모델 카드](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice), [공식 구현](https://github.com/QwenLM/Qwen3-TTS)
- Apache-2.0 가중치를 무료로 내려받아 로컬에서 실행합니다. 실제 사용한 커뮤니티 변환본의 `config.json`에서도 `sohee`와 `korean`을 확인했습니다. 8bit판의 음질이 원본과 완전히 같다는 보장은 하지 않습니다. [MLX 모델 카드](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit), [고정 설정 파일](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit/blob/41d3337e8b7f2843a75841595fc14e4b9a7a4b96/config.json)
- 이 Mac의 메모리는 48 GiB입니다. MLX의 Metal 추론을 사용하고, 모델·음성 토크나이저를 합쳐 약 3.08 GB를 내려받습니다. 음성 생성에 CUDA, 유료 API, 계정 로그인이 필요하지 않습니다. [MLX-Audio 구현](https://github.com/Blaizzy/mlx-audio), [Python 사용법](https://github.com/Blaizzy/mlx-audio/blob/main/docs/getting-started/quickstart-python.md)

## 비교한 공개 후보

서로 다른 언어 집합·참조 음성·평가기로 얻은 숫자를 하나의 한국어 순위처럼 합치지 않았습니다. 아래 대안들은 공식 자료로 비교했으며, 로컬에서 모두 실행해 청취 비교한 결과가 아닙니다.

| 후보 | 무료 사용·한국어 근거 | 이번 도구에서의 판단 |
| --- | --- | --- |
| Qwen3-TTS 1.7B CustomVoice | Apache-2.0, 한국어 기본 화자 Sohee, 스타일 제어 | **기본 선택.** 문서 경로만 전달하는 흐름에 맞는 일관된 기본 음성 |
| [Fish Audio S2 Pro](https://huggingface.co/fishaudio/s2-pro) | 연구·비상업 무료 라이선스. 한국어를 지원하며 모델 카드에서 Tier 2로 분류 | 표현력 높은 유력 후보. 4B+400M 구조, 이번 기본 화자 흐름에서는 Qwen을 우선 |
| [VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) | Apache-2.0, 한국어 포함 30개 언어, 48 kHz 출력·음색 설계 | 유력 대안. 제작사도 언어별 품질 차이와 긴 입력의 불안정 가능성을 명시. 한국어 기본 화자를 고정하는 이번 흐름에서는 Qwen을 우선 |
| [Higgs Audio v3 / Higgs TTS 3 4B](https://huggingface.co/bosonai/higgs-tts-3-4b) | 연구·비상업 무료 라이선스, 한국어 지원. 제작사 공개 벤치마크에서 강한 다국어 성능 | 더 최근의 강력한 후보. 다국어 평균 점수만으로 한국어 낭독 우위를 단정하지 않음. 대화·표현 제어 중심의 모델이며 이번 버전에는 통합하지 않음 |
| [Qwen-Audio-3.0-TTS](https://arxiv.org/abs/2607.23938) | 2026-07 논문 및 호스팅 서비스 자료 | 더 최신이지만 조사 시 Qwen 공식 Hugging Face의 공개 TTS 가중치 목록에서 대응 모델을 확인하지 못함. 무료 로컬 실행 후보에서 제외 |

Qwen 공개 가중치 확인에 사용한 [Hugging Face 공식 API 조회](https://huggingface.co/api/models?author=Qwen&search=tts&limit=100)에서는 Qwen3-TTS 계열 6개 저장소가 반환되었습니다. 이 확인은 조사 시점의 목록이며, 영구적으로 새 가중치가 없다는 의미는 아닙니다.

## 재현 정보

```text
TTS: mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit
revision: 41d3337e8b7f2843a75841595fc14e4b9a7a4b96
runtime: mlx-audio 0.5.3 / Python 3.12 / MLX Metal
speaker: Sohee
language: Korean
temperature: 0.7
top_p: 0.9
repetition_penalty: 1.05
seed: 42 + chunk index
output: MP3, mono, 24 kHz, 128 kbps
```

모델 리비전은 코드에, Python 의존성은 `uv.lock`에 고정합니다. 기본 지시문은 차분하고 따뜻한 한국어 오디오북 낭독입니다. 문서의 본문을 요약하거나 번역하는 별도 LLM을 사용하지 않습니다. 파일 추출·문장 분할·구간 저장·인코딩을 로컬에서 처리합니다.

품질 확인은 [실행 검증](validation.md)에 구분해 기록합니다. 음성 인식 일치율은 누락·반복 탐지에 도움이 되지만, 사람의 청취 평가나 자연스러움 점수와 같지 않습니다.

# 합성 목소리 샘플

이 폴더의 MP3는 doc2audio에서 화자를 고르기 위해 실제 로컬 TTS 모델로 생성한 **AI 합성 음성**입니다. 사람이 녹음한 음성이나 사용자 문서를 사용하지 않았습니다. 미리 생성한 제품 예시이므로 재생 시 모델을 설치하거나 음성을 새로 합성할 필요가 없습니다.

모든 화자는 같은 한국어 문장을 읽습니다.

> 안녕하세요. 오늘도 당신의 문서를 자연스러운 목소리로 읽어 드릴게요.

## 모델 출처

| 모델                                                                                                                                                           | 생성에 사용한 고정 리비전                  | 화자                                                                | 모델 라이선스                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [Supertone/supertonic-3](https://huggingface.co/Supertone/supertonic-3/tree/3cadd1ee6394adea1bd021217a0e650ede09a323)                                          | `3cadd1ee6394adea1bd021217a0e650ede09a323` | F1–F5, M1–M5                                                        | [OpenRAIL-M](https://huggingface.co/Supertone/supertonic-3/blob/3cadd1ee6394adea1bd021217a0e650ede09a323/LICENSE) |
| [Qwen3-TTS 1.7B CustomVoice MLX 8bit](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit/tree/41d3337e8b7f2843a75841595fc14e4b9a7a4b96) | `41d3337e8b7f2843a75841595fc14e4b9a7a4b96` | Sohee, Serena, Vivian, Uncle_Fu, Ryan, Aiden, Ono_Anna, Eric, Dylan | [Apache-2.0 · Qwen 원본 모델](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)                        |
| [Qwen3-TTS 0.6B CustomVoice MLX 8bit](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit/tree/049ef77fe8816b536193c0c25f9a214d17921282) | `049ef77fe8816b536193c0c25f9a214d17921282` | 같은 Qwen 9개 화자                                                  | [Apache-2.0 · Qwen 원본 모델](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice)                        |

Supertone과 Qwen이 제공한 모델 및 mlx-community의 MLX 변환본을 사용했습니다. 이 폴더에는 생성된 짧은 샘플과 메타데이터만 있으며 모델 가중치나 화자 임베딩을 재배포하지 않습니다. 모델별 사용 조건은 위 원문에서 확인할 수 있습니다.

## 생성 설정

- 최초 요청 seed: 모든 화자 `42`
- 언어: 한국어 (`ko` 또는 `Korean`)
- 출력: mono 24 kHz, MP3 128 kbps, 출력 배속 1.0
- Supertonic: 생성 단계 8, 모델 발화 속도 1.05
- Qwen: temperature 0.7, top-p 0.9, repetition penalty 1.05
- Qwen 1.7B 말투: “차분하고 따뜻한 한국어로 또렷하게 읽어 주세요.”
- Qwen 0.6B: 말투 지시 없음
- 나머지 설정은 모델별 카탈로그 기본값이며 각 파일의 `manifest.json` 항목에 전체 옵션을 기록합니다.

기존 엔진의 오디오 정리와 음량 정규화를 적용했습니다. 짧은 미리듣기를 위해 앞뒤 저음량 여백이 1초를 넘으면 발화 앞뒤에 200ms를 남겨 정리하며 `trimmed_edge_seconds`에 제거한 시간을 기록합니다. 화자와 모델에 따라 발음·말하는 속도가 다릅니다. Qwen의 한국어 기본 화자는 Sohee입니다.

Qwen이 종료 토큰을 내지 않아 엔진의 길이 제한에 도달한 경우에는 기존 엔진이 다른 seed로 한 번 재시도합니다. `attempt_seeds`는 실제 시도한 seed를 순서대로 기록하므로 기본 seed에서 성공한 음성과 재시도로 생성한 음성을 구분할 수 있습니다.

## 재생성과 검증

프로젝트 루트에서 실행합니다. 세 모델이 먼저 로컬에 설치되어 있어야 하며 스크립트는 모델을 다운로드하지 않습니다.

```sh
uv run python scripts/generate_voice_samples.py --overwrite
```

모델마다 별도 프로세스에서 한 번 로드하고 화자를 전환합니다. 테스트용 톤이나 기존 합성 캐시로 대체하지 않습니다. 생성 중에는 임시 폴더를 사용하며, 전체 샘플이 생성·검증된 뒤 제품 폴더로 복사합니다. 같은 모델·입력·옵션을 재사용해도 라이브러리나 실행 환경에 따라 파일 바이트가 달라질 수 있습니다.

`manifest.json`에는 문장, 합성 음성 표시, seed와 함께 모델 ID·화자·상대 URL·옵션·리비전·초 단위 길이·바이트 크기·SHA-256을 기록합니다. URL은 사이트 기본 경로에 상대적입니다. 각 MP3는 ffprobe의 형식·길이 확인과 ffmpeg 전체 디코딩을 통과해야 게시됩니다.

디코딩된 PCM의 RMS, peak, 앞뒤 무음도 전수 검사합니다. 무음은 peak의 1% 또는 0.0001 중 큰 기준으로 측정하며, RMS가 -40 dBFS보다 작거나 앞뒤 무음이 각각 1초를 넘으면 게시하지 않습니다. 이 수치 검사는 무음·잘림 등 기술적 오류를 찾기 위한 것이며 사람의 청취에 따른 자연스러움 평가는 아닙니다.

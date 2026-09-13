import { useId } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { ExpandMore, VerifiedUserOutlined } from "@mui/icons-material";
import { browserMode } from "./api";
import RuntimeHelp from "./RuntimeHelp";

const browserSteps = [
  [
    "사이트 접속",
    "웹서버에서 화면과 실행 파일을 받습니다. 오프라인 준비가 끝나면 다음에도 재사용합니다.",
    "내 PC · 브라우저 캐시",
  ],
  [
    "모델 다운로드",
    "모델 보관함에서 Supertonic 3를 내려받습니다. Hugging Face에서 처음 한 번 약 401 MB를 받습니다.",
    "내 PC · IndexedDB",
  ],
  [
    "문서 선택 · 읽기",
    "변환을 시작하면 선택한 파일이나 입력한 글을 저장하고 문장을 나눕니다. 스캔 문서는 이 PC에서 글자를 인식합니다.",
    "내 PC · 브라우저",
  ],
  [
    "모델 불러오기",
    "다운로드한 모델을 저장소에서 메모리(RAM)로 불러옵니다. 문서마다 다시 다운로드하지 않습니다.",
    "내 PC · 메모리",
  ],
  [
    "음성 생성",
    "브라우저의 실행 엔진(WASM)이 CPU로 문장별 음성을 만듭니다. 화면과 별도의 작업 영역(Worker)에서 처리합니다.",
    "내 PC · CPU",
  ],
  [
    "진행 상황 보관",
    "완성된 음성 구간과 진행 위치를 계속 저장합니다. 이 기록으로 중단된 작업을 이어갑니다.",
    "내 PC · 브라우저 저장소",
  ],
  [
    "MP3 저장",
    "음성 구간을 합쳐 MP3를 보관합니다. 작업 기록에서 저장을 누르면 일반 파일로도 내려받습니다.",
    "브라우저 저장소 → 다운로드/선택한 폴더",
  ],
];

const localSteps = [
  [
    "로컬 화면 접속",
    "내 PC에서 실행한 Python 서버의 웹 화면을 엽니다. 서버 주소는 127.0.0.1:8010입니다.",
    "내 PC · 브라우저",
  ],
  [
    "모델 다운로드",
    "모델 보관함에서 모델을 선택하면 Python 서버가 Hugging Face에서 받아 보관합니다.",
    "프로젝트 · .models/",
  ],
  [
    "문서 전달 · 읽기",
    "변환을 시작하면 브라우저가 내 PC의 Python 서버로 문서를 전달합니다. 서버가 글자를 추출하고 문장을 나눕니다.",
    "내 PC · Python 서버",
  ],
  [
    "모델 불러오기",
    "저장된 모델을 메모리로 불러옵니다. 모델 다운로드가 끝나면 네트워크 없이 실행할 수 있습니다.",
    "내 PC · 메모리",
  ],
  [
    "음성 생성",
    "Qwen3는 Apple Silicon Mac의 GPU, Supertonic은 CPU로 문장별 음성을 생성합니다.",
    "내 PC · GPU 또는 CPU",
  ],
  [
    "진행 상황 보관",
    "작업 정보와 문서, 완성된 음성 구간을 디스크에 저장합니다. 브라우저를 닫아도 실행 프로그램이 켜져 있으면 계속 처리합니다.",
    "프로젝트 · .doc2audio/",
  ],
  [
    "MP3 저장",
    "Python 서버가 음성을 합쳐 MP3로 저장합니다. 웹 화면에서 듣거나 일반 파일로 내려받을 수 있습니다.",
    "작업 폴더 → 다운로드/선택한 폴더",
  ],
];

const browserQuestions = [
  [
    "모델 보관함은 클라우드인가요?",
    "아니요. 모델·문서·작업·음성은 이 PC의 브라우저 전용 저장소(IndexedDB)에 있습니다. 실제 디스크 공간을 사용하지만 다운로드 폴더처럼 파일을 직접 관리하는 구조는 아닙니다. 다른 PC·브라우저·프로필로 자동 동기화되지 않습니다. 현재 모델 저장 폴더를 직접 지정하는 기능은 없습니다.",
  ],
  [
    "모델의 저장 위치를 확인하거나 삭제하려면?",
    "모델 보관함에서 ‘저장 위치’를 펼치면 이 사이트의 브라우저 내부 위치와 저장 용량을 확인할 수 있습니다. 브라우저는 디스크의 실제 폴더 경로를 웹사이트에 공개하지 않습니다. ‘모델 삭제’는 해당 모델과 중단된 다운로드 조각만 지우며 문서·작업 기록·완성된 MP3는 남깁니다. 새 음성을 만들거나 중단된 변환을 이어가려면 모델을 다시 받아야 합니다. 사용 중인 작업은 먼저 일시정지하거나 취소하세요.",
  ],
  [
    "브라우저를 닫았다가 열면 어떻게 되나요?",
    "닫은 동안 계산은 멈춥니다. 같은 사이트를 같은 브라우저 프로필에서 다시 열면 저장된 구간부터 자동으로 이어갑니다. 직접 일시정지했거나 실패·취소한 작업은 작업 기록에서 ‘이어서 실행’을 누르세요. 등록 전 입력 중인 문서는 창을 닫으면 사라집니다.",
  ],
  [
    "인터넷 없이도 사용할 수 있나요?",
    "‘오프라인 화면 준비됨’ 표시와 모델 다운로드 완료를 확인하세요. 둘 다 준비되면 같은 브라우저에서 네트워크 없이 문서를 읽고 음성을 만들 수 있습니다. 처음 접속할 때와 모델을 받을 때는 인터넷이 필요합니다.",
  ],
  [
    "캐시나 사이트 데이터를 삭제하면 어떻게 되나요?",
    "‘캐시된 이미지·파일’만 지우면 보통 실행 파일 캐시가 제거되고 모델과 작업은 남습니다. ‘쿠키 및 사이트 데이터’를 지우면 IndexedDB의 모델·문서·작업·음성도 삭제됩니다. 저장 공간 보호는 브라우저의 자동 정리를 줄이지만 직접 삭제를 막지는 않습니다. 필요한 MP3는 파일로 저장해 두세요.",
  ],
];

const localQuestions = [
  [
    "브라우저 방식과 무엇이 다른가요?",
    "브라우저는 화면을 담당하고, 내 PC에서 켜 둔 Python 프로그램이 문서를 읽고 음성을 만듭니다. 문서는 브라우저에서 127.0.0.1의 로컬 서버로 전달됩니다. 인터넷의 외부 서버에 문서를 업로드하는 방식은 아닙니다.",
  ],
  [
    "모델과 작업은 어디에 저장되나요?",
    "모델 보관함의 ‘저장 위치’에서 모델별 실제 폴더 경로를 확인하고 복사할 수 있습니다. 기본 모델 폴더는 프로젝트의 .models/, 작업·문서·음성 폴더는 .doc2audio/입니다. 브라우저 캐시나 사이트 데이터를 지워도 남으며 실행 프로그램 설정으로 저장 폴더를 바꿀 수 있습니다.",
  ],
  [
    "다운로드한 모델만 삭제할 수 있나요?",
    "모델 보관함에서 ‘모델 삭제’를 누르고 확인하세요. 해당 모델과 중단된 다운로드 파일을 지우며 문서·작업·완성된 MP3는 남깁니다. 사용 중인 모델은 작업이 멈춘 뒤 삭제할 수 있습니다. 이후 음성을 만들려면 모델을 다시 받아야 합니다. 모델 폴더에 별도로 넣은 파일이 있으면 안전을 위해 삭제가 제한될 수 있습니다.",
  ],
  [
    "브라우저를 닫아도 계속 처리하나요?",
    "내 PC가 켜져 있고 Python 서버가 실행 중이면 계속 처리합니다. 서버를 다시 켠 뒤 중단·실패·취소한 작업은 작업 기록에서 ‘다시 시도’를 누르면 저장된 구간부터 이어갑니다.",
  ],
  [
    "인터넷 없이도 사용할 수 있나요?",
    "프로그램 설치와 웹 화면 준비, 모델 다운로드를 마치면 가능합니다. 음성 생성에는 외부 API나 API 키가 필요하지 않습니다. Qwen3를 쓰는 현재 로컬 프로그램은 Apple Silicon Mac용입니다.",
  ],
];

export default function Help() {
  const id = useId();
  const steps = browserMode ? browserSteps : localSteps;
  const questions = browserMode ? browserQuestions : localQuestions;
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <Paper
        component="section"
        variant="outlined"
        aria-labelledby={`${id}-privacy`}
        sx={{
          p: { xs: 2, md: 3 },
          bgcolor: "#f0f9f4",
          borderColor: "#c7e2d3",
        }}
      >
        <Stack direction="row" sx={{ gap: 1.5, alignItems: "flex-start" }}>
          <VerifiedUserOutlined sx={{ color: "success.dark", mt: 0.5 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography id={`${id}-privacy`} component="h2" variant="h6">
              파일 선택은 외부 서버 업로드가 아닙니다
            </Typography>
            <Typography variant="body2" sx={{ mt: 1, lineHeight: 1.8 }}>
              {browserMode
                ? "웹사이트는 화면과 실행 파일을 전달합니다. 선택한 문서, 입력한 글, 만들어진 음성은 내 PC의 브라우저에서 처리하고 보관하며 외부 서버로 보내지 않습니다."
                : "웹 화면에서 선택한 문서는 내 PC의 Python 서버로 전달합니다. 문서를 읽고 음성을 만드는 일과 결과 저장은 모두 이 PC에서 이루어집니다."}
            </Typography>
            <Chip
              size="small"
              variant="outlined"
              label={
                browserMode ? "현재 · 브라우저 실행" : "현재 · 로컬 서버 실행"
              }
              sx={{ mt: 1.5, bgcolor: "background.paper" }}
            />
          </Box>
        </Stack>
      </Paper>

      <Paper
        component="section"
        variant="outlined"
        aria-labelledby={`${id}-steps`}
        sx={{ overflow: "hidden" }}
      >
        <Box sx={{ p: { xs: 2, md: 3 }, pb: { xs: 2, md: 2 } }}>
          <Typography id={`${id}-steps`} component="h2" variant="h6">
            접속부터 MP3까지, 7단계
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            {browserMode
              ? "모델을 한 번 받아 두면, 이후 변환은 내 PC 안에서 진행됩니다."
              : "‘로컬 서버’는 인터넷의 서버가 아니라 내 PC에서 켜 둔 실행 프로그램입니다."}
          </Typography>
        </Box>
        <Box component="ol" sx={{ m: 0, p: 0, listStyle: "none" }}>
          {steps.map(([title, description, place], index) => (
            <Box
              component="li"
              key={title}
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "28px minmax(0, 1fr)",
                  md: "28px 140px minmax(0, 1fr) 190px",
                },
                columnGap: 1.5,
                rowGap: 0.75,
                alignItems: "start",
                px: { xs: 2, md: 3 },
                py: 2,
                borderTop: "1px solid",
                borderColor: "divider",
              }}
            >
              <Box className="step" aria-hidden="true">
                {index + 1}
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 650, pt: 0.3 }}>
                {title}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ gridColumn: { xs: 2, md: "auto" }, lineHeight: 1.7 }}
              >
                {description}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  gridColumn: { xs: 2, md: "auto" },
                  color: "primary.dark",
                  pt: { md: 0.4 },
                  overflowWrap: "anywhere",
                }}
              >
                {place}
              </Typography>
            </Box>
          ))}
        </Box>
      </Paper>

      <Box component="section" aria-labelledby={`${id}-faq`}>
        <Typography
          id={`${id}-faq`}
          component="h2"
          variant="h6"
          sx={{ mb: 1.5 }}
        >
          보관과 이어하기
        </Typography>
        {questions.map(([question, answer], index) => (
          <Accordion
            key={question}
            disableGutters
            variant="outlined"
            sx={{ "&:before": { display: "none" }, mt: index ? 1 : 0 }}
          >
            <AccordionSummary
              expandIcon={<ExpandMore />}
              id={`${id}-question-${index}`}
              aria-controls={`${id}-answer-${index}`}
              sx={{ minHeight: 56 }}
            >
              <Typography
                component="span"
                variant="body2"
                sx={{ fontWeight: 600 }}
              >
                {question}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ lineHeight: 1.8 }}
              >
                {answer}
              </Typography>
            </AccordionDetails>
          </Accordion>
        ))}
      </Box>

      {browserMode && <RuntimeHelp compact />}
    </Stack>
  );
}

import { useId, useState } from "react";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { ExpandLess, ExpandMore, OpenInNew } from "@mui/icons-material";
import { browserMode } from "./api";

const localUrl = "http://127.0.0.1:8010/?runtime=local#new";
const setupUrl =
  "https://github.com/inininax/doc2audio/blob/main/docs/installation.md";

export default function RuntimeHelp({
  compact = false,
}: {
  compact?: boolean;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  if (!browserMode) return null;
  const showSteps = !compact || expanded;
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby={`${id}-title`}
      sx={{
        minWidth: 0,
        p: compact ? 2 : { xs: 2, sm: 3 },
        overflowWrap: "anywhere",
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        sx={{
          justifyContent: "space-between",
          alignItems: { sm: "center" },
          gap: 1,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            id={`${id}-title`}
            component={compact ? "h3" : "h2"}
            variant={compact ? "subtitle2" : "h6"}
          >
            Qwen3도 사용할 수 있어요
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            {compact
              ? "기존 Qwen3는 Apple Silicon Mac의 로컬 서버에서 사용할 수 있습니다."
              : "기존 Qwen3 1.7B·0.6B와 한국어 목소리 Sohee는 Apple Silicon Mac의 로컬 서버에서 계속 사용할 수 있습니다."}
          </Typography>
        </Box>
        {compact && (
          <Button
            type="button"
            aria-expanded={expanded}
            aria-controls={`${id}-steps`}
            onClick={() => setExpanded((value) => !value)}
            endIcon={expanded ? <ExpandLess /> : <ExpandMore />}
            sx={{ minHeight: 48, flexShrink: 0 }}
          >
            Qwen3 사용 방법
          </Button>
        )}
      </Stack>
      {showSteps && (
        <Stack id={`${id}-steps`} spacing={1.5} sx={{ mt: 2, minWidth: 0 }}>
          {compact && (
            <Typography variant="body2" color="text.secondary">
              Qwen3 1.7B·0.6B와 한국어 목소리 Sohee를 선택할 수 있습니다.
            </Typography>
          )}
          <Typography variant="body2">
            doc2audio 설치와 웹 화면 준비를 마친 Mac에서 프로젝트 폴더의
            터미널로 실행하세요.
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.5,
              bgcolor: "action.hover",
              borderRadius: 1,
              overflowX: "auto",
              maxWidth: "100%",
            }}
          >
            <Box component="code" sx={{ fontSize: 13 }}>
              uv run doc2audio-server
            </Box>
          </Box>
          <Typography variant="body2" color="text.secondary">
            서버를 실행한 뒤 아래 화면을 여세요. 이 컴퓨터의 로컬 서버를 새
            탭에서 열며, 현재 문서와 설정은 자동으로 옮기지 않습니다.
          </Typography>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            sx={{ flexWrap: "wrap", gap: 1 }}
          >
            <Button
              href={localUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="outlined"
              endIcon={<OpenInNew />}
              aria-label="Qwen3 로컬 화면 열기 · 새 탭"
              sx={{ minHeight: 48 }}
            >
              Qwen3 로컬 화면 열기
            </Button>
            <Button
              href={setupUrl}
              target="_blank"
              rel="noopener noreferrer"
              endIcon={<OpenInNew />}
              aria-label="Qwen3 처음 설치하는 방법 · 새 탭"
              sx={{ minHeight: 48 }}
            >
              처음 설치하는 방법
            </Button>
          </Stack>
        </Stack>
      )}
    </Paper>
  );
}

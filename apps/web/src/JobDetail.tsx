import { useRef, useState } from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  Close,
  PauseCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  Refresh,
  StopCircleOutlined,
} from "@mui/icons-material";
import { active, browserMode, type Job, type Model } from "./api";
import { Status } from "./JobCard";

const ocrLabels: Record<string, string> = {
  auto: "자동 감지",
  always: "항상 사용",
  never: "사용 안 함",
};

export default function JobDetail({
  job,
  model,
  onClose,
  onAction,
  busy,
  actionError,
  onDismissError,
}: {
  job: Job | null;
  model?: Model;
  onClose: () => void;
  onAction: (id: string, action: string) => void;
  busy: boolean;
  actionError?: string;
  onDismissError?: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [rate, setRate] = useState(1);
  const progress = job
    ? Math.round(Math.min(1, Math.max(0, job.progress)) * 100)
    : 0;
  return (
    <Drawer
      anchor="right"
      open={!!job}
      onClose={onClose}
      slotProps={{
        paper: {
          role: "dialog",
          "aria-modal": true,
          "aria-labelledby": "job-detail-title",
          sx: {
            width: { xs: "100%", sm: 520 },
            maxWidth: "100%",
            boxSizing: "border-box",
            overflowWrap: "anywhere",
          },
        },
      }}
    >
      {job && (
        <>
          <Box
            sx={{
              p: { xs: 2, sm: 3 },
              borderBottom: "1px solid",
              borderColor: "divider",
            }}
          >
            <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1, fontSize: 13 }}
                >
                  작업 상세
                </Typography>
                <Typography
                  id="job-detail-title"
                  component="h2"
                  variant="h5"
                  sx={{ fontSize: 22, lineHeight: 1.4 }}
                >
                  {job.title}
                </Typography>
              </Box>
              <IconButton
                aria-label="작업 상세 닫기"
                onClick={onClose}
                sx={{ width: 48, height: 48, flexShrink: 0 }}
              >
                <Close />
              </IconButton>
            </Stack>
            <Stack
              direction="row"
              sx={{ mt: 2, alignItems: "center", flexWrap: "wrap", gap: 1 }}
            >
              <Status job={job} />
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontSize: 13 }}
              >
                {job.kind === "download" ? "모델 다운로드" : "문서 변환"} · 시도{" "}
                {job.attempt}회
              </Typography>
            </Stack>
          </Box>

          <Stack spacing={3} sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
            {actionError && (
              <Alert
                severity="error"
                onClose={onDismissError}
                sx={{ "& .MuiAlert-message": { minWidth: 0 } }}
              >
                <AlertTitle>요청 처리 오류</AlertTitle>
                {actionError}
              </Alert>
            )}
            {job.error && job.error !== actionError && (
              <Alert
                severity="error"
                sx={{ "& .MuiAlert-message": { minWidth: 0 } }}
              >
                <AlertTitle>작업 오류</AlertTitle>
                {job.error}
              </Alert>
            )}

            <Box component="section" aria-labelledby="job-progress-title">
              <Typography
                id="job-progress-title"
                component="h3"
                variant="subtitle2"
                sx={{ mb: 1 }}
              >
                현재 상태
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {job.message}
              </Typography>
              {(active(job) || job.status === "paused") && (
                <Box sx={{ mt: 1.5 }}>
                  <LinearProgress
                    aria-label="작업 진행률"
                    variant={
                      job.progress > 0 || job.status === "paused"
                        ? "determinate"
                        : "indeterminate"
                    }
                    value={progress}
                  />
                  {job.progress > 0 && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.75, fontSize: 13 }}
                    >
                      {progress}% 완료
                    </Typography>
                  )}
                </Box>
              )}
            </Box>

            {job.audio_url && (
              <Paper
                component="section"
                variant="outlined"
                aria-labelledby="job-audio-title"
                sx={{ p: 2, bgcolor: "background.default", minWidth: 0 }}
              >
                <Typography
                  id="job-audio-title"
                  component="h3"
                  variant="subtitle2"
                  sx={{ mb: 2 }}
                >
                  완성된 음성
                </Typography>
                <audio
                  ref={audio}
                  controls
                  aria-label={`${job.title} 음성 재생`}
                  src={job.audio_url}
                  onLoadedMetadata={() => {
                    if (audio.current) audio.current.playbackRate = rate;
                  }}
                  style={{
                    width: "100%",
                    minWidth: 0,
                    maxWidth: "100%",
                    display: "block",
                  }}
                />
                <Stack
                  direction="row"
                  sx={{
                    mt: 2,
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 1.5,
                  }}
                >
                  <TextField
                    label="듣기 배속"
                    select
                    value={rate}
                    onChange={(e) => {
                      const r = Number(e.target.value);
                      setRate(r);
                      if (audio.current) audio.current.playbackRate = r;
                    }}
                    sx={{
                      width: 128,
                      "& .MuiInputBase-root": { minHeight: 48 },
                    }}
                  >
                    {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                      <MenuItem value={r} key={r}>
                        {r}배
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="contained"
                    href={job.audio_url}
                    download={`${job.title}.mp3`}
                    startIcon={<DownloadOutlined />}
                    sx={{ minHeight: 48 }}
                  >
                    MP3 저장
                  </Button>
                </Stack>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 1.5, fontSize: 13 }}
                >
                  듣기 배속은 저장한 MP3 파일에 적용되지 않습니다.
                </Typography>
              </Paper>
            )}

            {(active(job) ||
              ["failed", "cancelled", "interrupted", "paused"].includes(
                job.status,
              ) ||
              browserMode) && (
              <Box
                component="section"
                aria-labelledby="job-actions-title"
                aria-busy={busy}
              >
                <Typography
                  id="job-actions-title"
                  component="h3"
                  variant="subtitle2"
                  sx={{ mb: 1.5 }}
                >
                  작업 관리
                </Typography>
                <Stack
                  direction="row"
                  sx={{
                    flexWrap: "wrap",
                    gap: 1,
                    "& .MuiButton-root": { minHeight: 48 },
                  }}
                >
                  {browserMode && active(job) && (
                    <Button
                      variant="contained"
                      startIcon={<PauseCircleOutlined />}
                      disabled={busy}
                      onClick={() => onAction(job.id, "pause")}
                    >
                      일시정지
                    </Button>
                  )}
                  {active(job) && (
                    <Button
                      color="error"
                      variant="outlined"
                      startIcon={<StopCircleOutlined />}
                      disabled={busy || job.status === "cancelling"}
                      onClick={() => onAction(job.id, "cancel")}
                    >
                      작업 취소
                    </Button>
                  )}
                  {["failed", "cancelled", "interrupted", "paused"].includes(
                    job.status,
                  ) && (
                    <Button
                      variant="contained"
                      startIcon={<Refresh />}
                      disabled={busy}
                      onClick={() => onAction(job.id, "retry")}
                    >
                      {browserMode ? "이어서 실행" : "다시 시도"}
                    </Button>
                  )}
                  {browserMode && !active(job) && (
                    <Button
                      color="error"
                      variant="outlined"
                      startIcon={<DeleteOutlined />}
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "이 작업의 원문·음성·기록을 이 브라우저에서 삭제할까요?",
                          )
                        )
                          onAction(job.id, "delete");
                      }}
                    >
                      작업 삭제
                    </Button>
                  )}
                </Stack>
              </Box>
            )}

            <Divider />
            <Box component="section" aria-labelledby="job-info-title">
              <Typography
                id="job-info-title"
                component="h3"
                variant="subtitle2"
                sx={{ mb: 2 }}
              >
                요청 정보
              </Typography>
              <Box
                component="dl"
                sx={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr)",
                  gap: 1.5,
                  m: 0,
                }}
              >
                {[
                  ["모델", model?.name || job.model_id],
                  ["등록", new Date(job.created_at).toLocaleString("ko-KR")],
                  [
                    "업데이트",
                    new Date(job.updated_at).toLocaleString("ko-KR"),
                  ],
                  ...(job.options.pages ? [["페이지", job.options.pages]] : []),
                  ...(job.options.ocr
                    ? [
                        [
                          "문자 인식",
                          ocrLabels[job.options.ocr] || job.options.ocr,
                        ],
                      ]
                    : []),
                ].map(([label, value]) => (
                  <Box
                    key={label}
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "72px minmax(0, 1fr)",
                      gap: 1.5,
                    }}
                  >
                    <Typography
                      component="dt"
                      variant="body2"
                      color="text.secondary"
                    >
                      {label}
                    </Typography>
                    <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                      {value}
                    </Typography>
                  </Box>
                ))}
              </Box>
              {job.result?.seconds !== undefined && (
                <Typography variant="body2" sx={{ mt: 2 }}>
                  음성 {job.result.seconds.toFixed(1)}초
                  {job.result.chunks !== undefined
                    ? ` · ${job.result.chunks}개 구간`
                    : ""}
                  {job.result.reused_chunks
                    ? ` · 이전 구간 ${job.result.reused_chunks}개 재사용`
                    : ""}
                </Typography>
              )}
              {job.options.voice && (
                <Box
                  component="dl"
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 2,
                    m: 0,
                    mt: 2.5,
                  }}
                >
                  {Object.entries(job.options.voice).map(([key, value]) => (
                    <Box key={key} sx={{ minWidth: 0 }}>
                      <Typography
                        component="dt"
                        variant="body2"
                        color="text.secondary"
                        sx={{ fontSize: 13, mb: 0.5 }}
                      >
                        {model?.options.find((o) => o.key === key)?.label ||
                          key}
                      </Typography>
                      <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                        {String(value)}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>

            <Divider />
            <Box component="section" aria-labelledby="job-log-title">
              <Typography
                id="job-log-title"
                component="h3"
                variant="subtitle2"
                sx={{ mb: 2 }}
              >
                진행 기록
              </Typography>
              <Box
                role="log"
                aria-label="작업 진행 기록"
                aria-relevant="additions"
              >
                {job.events?.length ? (
                  job.events.map((event) => (
                    <Box
                      key={event.id}
                      sx={{
                        borderLeft: "2px solid",
                        borderColor: "divider",
                        pl: 2,
                        pb: 2,
                      }}
                    >
                      <Typography
                        component="time"
                        dateTime={event.created_at}
                        variant="body2"
                        color="text.secondary"
                        sx={{ fontSize: 13 }}
                      >
                        {new Date(event.created_at).toLocaleTimeString("ko-KR")}
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        {event.message}
                      </Typography>
                    </Box>
                  ))
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    아직 진행 기록이 없습니다.
                  </Typography>
                )}
              </Box>
            </Box>
          </Stack>
        </>
      )}
    </Drawer>
  );
}

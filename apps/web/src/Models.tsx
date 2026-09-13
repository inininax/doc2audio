import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
  Link,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import {
  CheckCircleOutlined,
  DownloadOutlined,
  OpenInNew,
} from "@mui/icons-material";
import { active, browserMode, type Job, type Model } from "./api";

export default function Models({
  models,
  jobs,
  onDownload,
  busy,
}: {
  models: Model[];
  jobs: Job[];
  onDownload: (id: string) => void;
  busy: boolean;
}) {
  const singleModel = models.length === 1;
  return (
    <>
      <Alert
        severity="info"
        sx={{
          mb: 3,
          "& .MuiAlert-message": { minWidth: 0, overflowWrap: "anywhere" },
        }}
      >
        모델을 처음 다운로드할 때 인터넷 연결이 필요합니다.
        {browserMode
          ? " 다운로드한 모델은 이 브라우저에 저장됩니다."
          : " 다운로드한 모델은 이 컴퓨터에 저장됩니다."}
      </Alert>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: singleModel
            ? "minmax(0, 1fr)"
            : {
                xs: "minmax(0, 1fr)",
                md: "repeat(2, minmax(0, 1fr))",
                lg: "repeat(3, minmax(0, 1fr))",
              },
          gap: 3,
        }}
      >
        {models.map((model) => {
          const pending = jobs.find(
            (j) =>
              j.kind === "download" && j.model_id === model.id && active(j),
          );
          const lastDownload = jobs.find(
            (j) => j.kind === "download" && j.model_id === model.id,
          );
          const downloadError =
            !model.installed && !pending && lastDownload?.status === "failed"
              ? lastDownload.error || lastDownload.message
              : "";
          const progress = pending
            ? Math.round(Math.min(1, Math.max(0, pending.progress)) * 100)
            : 0;
          return (
            <Paper
              component="article"
              variant="outlined"
              key={model.id}
              sx={{
                minWidth: 0,
                p: { xs: 2, sm: 3 },
                display: "grid",
                gridTemplateColumns: singleModel
                  ? {
                      xs: "minmax(0, 1fr)",
                      md: "minmax(0, 1.3fr) minmax(280px, 1fr)",
                    }
                  : "minmax(0, 1fr)",
                gap: 3,
                overflowWrap: "anywhere",
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Stack
                  direction="row"
                  sx={{
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 1.5,
                  }}
                >
                  <Box
                    sx={{
                      height: 44,
                      width: 44,
                      display: "grid",
                      placeItems: "center",
                      borderRadius: 2,
                      bgcolor: "primary.light",
                      color: "primary.main",
                      fontSize: 22,
                      fontWeight: 700,
                    }}
                    aria-hidden="true"
                  >
                    {model.engine === "qwen" ? "Q" : "S"}
                  </Box>
                  <Chip
                    size="small"
                    color={
                      pending
                        ? "primary"
                        : model.installed
                          ? "success"
                          : "default"
                    }
                    variant="outlined"
                    icon={
                      model.installed && !pending ? (
                        <CheckCircleOutlined />
                      ) : undefined
                    }
                    label={
                      pending
                        ? "다운로드 진행 중"
                        : model.installed
                          ? "사용 준비 완료"
                          : "다운로드 필요"
                    }
                    sx={{ maxWidth: "100%" }}
                  />
                </Stack>
                <Typography
                  component="h2"
                  variant="h6"
                  sx={{ mt: 2, fontSize: 20, lineHeight: 1.45 }}
                >
                  {model.name}
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 1 }}
                >
                  {model.description}
                </Typography>
                <Stack direction="row" sx={{ mt: 2, flexWrap: "wrap", gap: 1 }}>
                  <Chip
                    size="small"
                    label={`${(model.size_bytes / 1e9).toFixed(2)} GB`}
                  />
                  <Chip
                    size="small"
                    label={model.engine === "qwen" ? "10개 언어" : "31개 언어"}
                  />
                </Stack>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 2 }}
                >
                  {browserMode ? "이 브라우저에서 실행" : "이 컴퓨터에서 실행"}
                </Typography>
              </Box>

              <Stack spacing={2} sx={{ minWidth: 0, height: "100%" }}>
                <Box component="dl" sx={{ m: 0 }}>
                  <Typography
                    component="dt"
                    variant="body2"
                    color="text.secondary"
                    sx={{ fontSize: 13, mb: 0.75 }}
                  >
                    음성 옵션
                  </Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                    {model.engine === "qwen"
                      ? model.id === "qwen3-1.7b"
                        ? "9개 화자, 말투, 샘플링 제어"
                        : "9개 화자, 언어, 샘플링 제어"
                      : "10개 화자, 생성 단계, 발화 속도"}
                  </Typography>
                  <Typography
                    component="dt"
                    variant="body2"
                    color="text.secondary"
                    sx={{ fontSize: 13, mt: 2 }}
                  >
                    라이선스
                  </Typography>
                  <Box component="dd" sx={{ m: 0 }}>
                    <Link
                      href={model.license_url}
                      target="_blank"
                      rel="noreferrer"
                      sx={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 0.5,
                        minHeight: 44,
                        fontSize: 14,
                        maxWidth: "100%",
                      }}
                    >
                      {model.license}
                      <OpenInNew sx={{ fontSize: 14, flexShrink: 0 }} />
                    </Link>
                    {model.engine === "supertonic" && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ fontSize: 13 }}
                      >
                        모델 사용 조건 포함
                      </Typography>
                    )}
                  </Box>
                </Box>
                <Divider />
                {pending && (
                  <Box>
                    <LinearProgress
                      aria-label={`${model.name} 다운로드 진행률`}
                      variant={
                        pending.progress > 0 ? "determinate" : "indeterminate"
                      }
                      value={progress}
                    />
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 1, fontSize: 13 }}
                    >
                      {pending.message}
                      {pending.progress > 0 ? ` · ${progress}%` : ""}
                    </Typography>
                  </Box>
                )}
                {downloadError && (
                  <Alert
                    severity="error"
                    sx={{ "& .MuiAlert-message": { minWidth: 0 } }}
                  >
                    {downloadError}
                  </Alert>
                )}
                <Box sx={{ flex: 1 }} />
                <Stack spacing={1}>
                  <Button
                    fullWidth
                    variant={model.installed ? "outlined" : "contained"}
                    startIcon={
                      model.installed ? (
                        <CheckCircleOutlined />
                      ) : (
                        <DownloadOutlined />
                      )
                    }
                    disabled={busy || !!pending || model.installed}
                    onClick={() => onDownload(model.id)}
                    sx={{ minHeight: 48, px: 1.5 }}
                  >
                    {pending
                      ? "다운로드 작업 진행 중"
                      : model.installed
                        ? "사용 준비 완료"
                        : "모델 다운로드"}
                  </Button>
                  <Button
                    fullWidth
                    href={model.source_url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${model.name} 모델 정보 · 새 탭`}
                    endIcon={<OpenInNew sx={{ fontSize: 16 }} />}
                    sx={{ minHeight: 48 }}
                  >
                    모델 정보
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          );
        })}
      </Box>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mt: 2, fontSize: 13 }}
      >
        검토된 모델 카탈로그 · {models[0]?.reviewed_at || "—"} 기준. 새 모델은
        호환성을 검토한 뒤 추가됩니다.
        {browserMode &&
          " Qwen MLX 모델은 Python 실행 모드에서 사용할 수 있습니다."}
      </Typography>
    </>
  );
}

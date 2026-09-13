import { useId, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  LinearProgress,
  Link,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import {
  CheckCircleOutlined,
  ContentCopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExpandLess,
  ExpandMore,
  OpenInNew,
} from "@mui/icons-material";
import { active, browserMode, type Job, type Model } from "./api";
import RuntimeHelp from "./RuntimeHelp";

function storageSize(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

function StorageDetails({
  storage,
  name,
}: {
  storage: NonNullable<Model["storage"]>;
  name: string;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "failed"
  >("idle");
  async function copyLocation() {
    if (copyState === "copying") return;
    setCopyState("copying");
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(storage.location);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        저장 용량 {storageSize(storage.used_bytes)}
      </Typography>
      {!storage.has_data && (
        <Typography variant="caption" color="text.secondary">
          저장된 모델 데이터가 없습니다.
        </Typography>
      )}
      <Button
        fullWidth
        aria-label={`${name} 저장 위치 ${expanded ? "접기" : "보기"}`}
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
        endIcon={expanded ? <ExpandLess /> : <ExpandMore />}
        sx={{ justifyContent: "space-between", minHeight: 44, px: 0 }}
      >
        저장 위치
      </Button>
      {expanded && (
        <Box id={id}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {storage.kind === "indexeddb"
              ? "브라우저 내부 저장 위치입니다. 실제 폴더 경로는 브라우저가 공개하지 않습니다."
              : "이 컴퓨터에 저장되는 모델 폴더입니다."}
          </Typography>
          <Box
            component="code"
            sx={{
              display: "block",
              p: 1.5,
              bgcolor: "action.hover",
              borderRadius: 1,
              fontSize: 12,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              userSelect: "text",
            }}
          >
            {storage.location}
          </Box>
          <Button
            startIcon={<ContentCopyOutlined />}
            aria-label={`${name} 저장 위치 복사`}
            disabled={copyState === "copying"}
            onClick={() => void copyLocation()}
            sx={{ minHeight: 44 }}
          >
            {copyState === "copying" ? "복사 중…" : "위치 복사"}
          </Button>
          {copyState === "copied" && (
            <Typography role="status" variant="body2" color="success.main">
              저장 위치를 복사했습니다.
            </Typography>
          )}
          {copyState === "failed" && (
            <Alert
              severity="warning"
              sx={{ "& .MuiAlert-message": { minWidth: 0 } }}
            >
              복사하지 못했습니다. 위의 저장 위치를 선택해 직접 복사해 주세요.
            </Alert>
          )}
        </Box>
      )}
    </Box>
  );
}

export default function Models({
  models,
  jobs,
  onDownload,
  onDelete,
  busy,
}: {
  models: Model[];
  jobs: Job[];
  onDownload: (id: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleting = models.find((model) => model.id === deleteId);
  const canDelete = (model: Model) =>
    !busy && !!model.storage?.has_data && model.storage.can_delete;
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
                          : model.storage?.has_data
                            ? "일부 다운로드됨"
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
                    label={`모델 크기 ${(model.size_bytes / 1e9).toFixed(2)} GB`}
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
                {model.storage && (
                  <StorageDetails
                    key={model.storage.location}
                    storage={model.storage}
                    name={model.name}
                  />
                )}
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
                  {model.storage?.has_data && (
                    <>
                      <Button
                        fullWidth
                        color="error"
                        startIcon={<DeleteOutlined />}
                        aria-label={`${model.name} 모델 삭제`}
                        disabled={!canDelete(model)}
                        onClick={() => setDeleteId(model.id)}
                        sx={{ minHeight: 48 }}
                      >
                        모델 삭제
                      </Button>
                      {!model.storage.can_delete && (
                        <Typography variant="caption" color="text.secondary">
                          {model.storage.delete_blocked_reason ||
                            "지금은 모델을 삭제할 수 없습니다."}
                        </Typography>
                      )}
                    </>
                  )}
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
      <Dialog
        open={!!deleting}
        onClose={() => setDeleteId(null)}
        aria-labelledby="delete-model-title"
        aria-describedby="delete-model-description"
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: { overflowWrap: "anywhere" } } }}
      >
        <DialogTitle id="delete-model-title">모델을 삭제할까요?</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 1, fontWeight: 600 }}>
            {deleting?.name}
          </Typography>
          <DialogContentText id="delete-model-description">
            다운로드한 모델 데이터
            {deleting?.storage
              ? ` ${storageSize(deleting.storage.used_bytes)}`
              : ""}
            를 삭제합니다. 원문, 작업 기록, 완성된 MP3는 그대로 남습니다. 이
            모델로 다시 변환하려면 다운로드가 필요합니다.
          </DialogContentText>
          {deleting && !deleting.storage?.can_delete && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {deleting.storage?.delete_blocked_reason ||
                "지금은 모델을 삭제할 수 없습니다."}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 0 }}>
          <Button
            autoFocus
            onClick={() => setDeleteId(null)}
            sx={{ minHeight: 44 }}
          >
            취소
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={!deleting || !canDelete(deleting)}
            onClick={() => {
              if (!deleting || !canDelete(deleting)) return;
              setDeleteId(null);
              onDelete(deleting.id);
            }}
            sx={{ minHeight: 44 }}
          >
            삭제하기
          </Button>
        </DialogActions>
      </Dialog>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mt: 2, fontSize: 13 }}
      >
        검토된 모델 카탈로그 · {models[0]?.reviewed_at || "—"} 기준. 새 모델은
        호환성을 검토한 뒤 추가됩니다.
      </Typography>
      {browserMode && (
        <Box sx={{ mt: 3 }}>
          <RuntimeHelp />
        </Box>
      )}
    </>
  );
}

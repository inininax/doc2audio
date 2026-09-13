import { useEffect, useId, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import {
  ArrowForward,
  FolderOpenOutlined,
  GraphicEq,
  InsertDriveFileOutlined,
  Close,
  VerifiedUserOutlined,
} from "@mui/icons-material";
import {
  browserMode,
  defaults,
  request,
  type Job,
  type Model,
  type VoiceOptions,
} from "./api";
import OptionsForm from "./OptionsForm";
import RuntimeHelp from "./RuntimeHelp";

export default function NewJob({
  models,
  onCreated,
  onModels,
  onHelp,
  active = true,
}: {
  models: Model[];
  onCreated: (job: Job) => void;
  onModels: () => void;
  onHelp: () => void;
  active?: boolean;
}) {
  const id = useId();
  const [modelId, setModelId] = useState("");
  const model =
    models.find((m) => m.id === modelId) ||
    models.find((m) => m.installed) ||
    models[0];
  useEffect(() => {
    if (!modelId && model) setModelId(model.id);
  }, [modelId, model]);
  const [voice, setVoice] = useState<VoiceOptions | null>(null);
  const [mode, setMode] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [pages, setPages] = useState("");
  const [ocr, setOcr] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const isPdf = mode === 0 && Boolean(file && /\.pdf$/i.test(file.name));
  function chooseFile(candidate?: File) {
    if (!candidate || busy) return;
    if (input.current) input.current.value = "";
    if (!/\.(pdf|docx?|txt)$/i.test(candidate.name)) {
      setError(
        "지원하지 않는 파일입니다. PDF, DOCX, DOC, UTF-8 TXT 파일을 선택하세요.",
      );
      return;
    }
    if (!candidate.size || candidate.size > 100 * 1024 * 1024) {
      setError(
        candidate.size
          ? "파일은 100 MB 이하여야 합니다."
          : "빈 파일입니다. 내용이 있는 문서를 선택하세요.",
      );
      return;
    }
    setFile(candidate);
    setPages("");
    setOcr("auto");
    setError("");
  }
  function removeFile() {
    setFile(null);
    setPages("");
    setOcr("auto");
    setError("");
    if (input.current) input.current.value = "";
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      !model ||
      busy ||
      !model.installed ||
      (mode === 0 ? !file : !text.trim())
    )
      return;
    setBusy(true);
    setError("");
    const body = new FormData();
    body.set("model_id", model.id);
    body.set("options", JSON.stringify(voice || defaults(model)));
    body.set("title", title);
    body.set("pages", isPdf ? pages : "");
    body.set("ocr", isPdf ? ocr : "auto");
    if (mode === 0 && file) body.set("file", file);
    else body.set("text", text);
    try {
      const job = await request<Job>("/jobs", { method: "POST", body });
      // App keeps this component mounted, including when browsing the model library.
      // Clear the submitted draft only after storage/API has accepted the job.
      setFile(null);
      setText("");
      setTitle("");
      setPages("");
      setOcr("auto");
      if (input.current) input.current.value = "";
      onCreated(job);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Box component="form" onSubmit={submit} aria-label="새 음성 작업">
      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2, overflowWrap: "anywhere" }}
          onClose={() => setError("")}
        >
          {error}
        </Alert>
      )}
      <Box className="studio-grid">
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, minWidth: 0 }}>
          <Stack
            direction="row"
            spacing={1.25}
            sx={{ alignItems: "center", mb: 1.5 }}
          >
            <Box className="step" aria-hidden="true">
              1
            </Box>
            <Typography component="h2" variant="h6">
              문서 입력
            </Typography>
          </Stack>
          <Tabs
            value={mode}
            onChange={(_, value) => setMode(value)}
            aria-label="문서 입력 방식"
            sx={{ mb: 2 }}
          >
            <Tab
              disabled={busy}
              label="파일 선택"
              id={id + "-file-tab"}
              aria-controls={id + "-file-panel"}
            />
            <Tab
              disabled={busy}
              label="텍스트 입력"
              id={id + "-text-tab"}
              aria-controls={id + "-text-panel"}
            />
          </Tabs>
          <Box
            role="tabpanel"
            hidden={mode !== 0}
            id={id + "-file-panel"}
            aria-labelledby={id + "-file-tab"}
          >
            <Box
              onDragEnter={(event) => {
                event.preventDefault();
                if (!busy && event.dataTransfer.types.includes("Files")) {
                  dragDepth.current++;
                  setDragging(true);
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = busy ? "none" : "copy";
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (!dragDepth.current) setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                dragDepth.current = 0;
                setDragging(false);
                if (busy) return;
                if (event.dataTransfer.files.length > 1)
                  setError("한 번에 문서 하나를 선택하세요.");
                else chooseFile(event.dataTransfer.files[0]);
              }}
            >
              <Button
                type="button"
                fullWidth
                disabled={busy}
                onClick={() => input.current?.click()}
                aria-label={file ? "파일 바꾸기" : "문서 파일 선택"}
                aria-describedby={id + "-file-help"}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                  py: { xs: 2.5, md: 3 },
                  px: 2,
                  minHeight: 168,
                  border: "1.5px dashed",
                  borderColor: dragging ? "primary.main" : "divider",
                  bgcolor: dragging ? "action.selected" : "background.default",
                  color: "text.primary",
                  borderRadius: 2,
                  textAlign: "center",
                  "&:hover": {
                    borderColor: "primary.main",
                    bgcolor: "action.hover",
                  },
                  "&.Mui-focusVisible": {
                    outline: "3px solid",
                    outlineColor: "primary.main",
                    outlineOffset: 3,
                  },
                }}
              >
                {file ? (
                  <InsertDriveFileOutlined
                    sx={{ color: "primary.main", fontSize: 32 }}
                  />
                ) : (
                  <FolderOpenOutlined
                    sx={{ color: "primary.main", fontSize: 32 }}
                  />
                )}
                <Typography
                  component="span"
                  variant="body1"
                  sx={{
                    fontWeight: 600,
                    overflowWrap: "anywhere",
                    maxWidth: "100%",
                  }}
                >
                  {dragging
                    ? "여기에 놓으면 선택됩니다"
                    : file
                      ? file.name
                      : "파일을 선택하거나 여기에 놓으세요"}
                </Typography>
                <Typography
                  component="span"
                  variant="body2"
                  color="text.secondary"
                >
                  {file
                    ? (file.size / 1024).toFixed(1) +
                      " KB · 클릭해서 파일 바꾸기"
                    : "내 컴퓨터에서 문서 선택"}
                </Typography>
              </Button>
              <input
                ref={input}
                aria-label="변환할 문서"
                type="file"
                accept=".pdf,.docx,.doc,.txt"
                hidden
                disabled={busy}
                onChange={(event) => chooseFile(event.target.files?.[0])}
              />
            </Box>
            <Stack
              direction="row"
              sx={{
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                mt: 1,
              }}
            >
              <Typography
                id={id + "-file-help"}
                variant="caption"
                color="text.secondary"
              >
                PDF · DOCX · DOC · UTF-8 TXT / 최대 100 MB
              </Typography>
              {file && (
                <Button
                  type="button"
                  size="small"
                  color="inherit"
                  disabled={busy}
                  startIcon={<Close />}
                  onClick={removeFile}
                  sx={{ flexShrink: 0 }}
                >
                  파일 삭제
                </Button>
              )}
            </Stack>
            {isPdf ? (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "minmax(0, 1fr)",
                    sm: "repeat(2, minmax(0, 1fr))",
                  },
                  gap: 2,
                  mt: 2.5,
                }}
              >
                <TextField
                  fullWidth
                  id={id + "-pages"}
                  label="PDF 페이지 범위"
                  placeholder="예: 1-3,5"
                  helperText="비워 두면 모든 페이지를 읽습니다."
                  value={pages}
                  disabled={busy}
                  onChange={(event) => setPages(event.target.value)}
                  slotProps={{ htmlInput: { maxLength: 200 } }}
                />
                <TextField
                  fullWidth
                  id={id + "-ocr"}
                  label="스캔 문서 OCR"
                  select
                  value={ocr}
                  disabled={busy}
                  helperText="이미지 속 한국어·영어를 읽습니다."
                  onChange={(event) => setOcr(event.target.value)}
                >
                  <MenuItem value="auto">자동 감지</MenuItem>
                  <MenuItem value="always">항상 사용</MenuItem>
                  <MenuItem value="never">사용 안 함</MenuItem>
                </TextField>
              </Box>
            ) : (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 1 }}
              >
                PDF를 선택하면 페이지 범위와 OCR을 설정할 수 있습니다.
              </Typography>
            )}
          </Box>
          <Box
            role="tabpanel"
            hidden={mode !== 1}
            id={id + "-text-panel"}
            aria-labelledby={id + "-text-tab"}
          >
            <TextField
              fullWidth
              id={id + "-text"}
              label="낭독할 텍스트"
              multiline
              minRows={8}
              value={text}
              disabled={busy}
              onChange={(event) => setText(event.target.value)}
              placeholder="듣고 싶은 내용을 입력하거나 붙여 넣으세요."
              helperText={text.length.toLocaleString() + " / 1,000,000자"}
              slotProps={{ htmlInput: { maxLength: 1000000 } }}
            />
          </Box>
          <Box
            sx={{
              mt: 2,
              p: 1.5,
              borderRadius: 1.5,
              bgcolor: "#f0f9f4",
              display: "flex",
              alignItems: "flex-start",
              gap: 1,
            }}
          >
            <VerifiedUserOutlined
              sx={{ color: "success.dark", fontSize: 19, mt: 0.25 }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                문서와 음성을 외부 서버로 보내지 않습니다.
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {browserMode
                  ? "선택한 파일과 입력한 글은 이 PC의 브라우저 안에서 처리합니다."
                  : "변환을 시작하면 이 PC의 Python 서버로 문서를 전달해 처리합니다."}
              </Typography>
              <Button
                href="#help"
                onClick={(event) => {
                  event.preventDefault();
                  onHelp();
                }}
                endIcon={<ArrowForward />}
                size="small"
                sx={{
                  display: "flex",
                  width: "fit-content",
                  minHeight: 48,
                  px: 0,
                }}
              >
                처리·저장 방식 알아보기
              </Button>
            </Box>
          </Box>
          <TextField
            fullWidth
            id={id + "-title"}
            label="작업 이름 (선택)"
            placeholder="예: 주간 보고서"
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
            sx={{ mt: 2.5 }}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
        </Paper>
        <Paper
          variant="outlined"
          sx={{ p: { xs: 2, md: 3 }, alignSelf: "start", minWidth: 0 }}
        >
          <Stack
            direction="row"
            spacing={1.25}
            sx={{ alignItems: "center", mb: 2.5 }}
          >
            <Box className="step" aria-hidden="true">
              2
            </Box>
            <Typography component="h2" variant="h6">
              음성 설정
            </Typography>
          </Stack>
          {model ? (
            <>
              <TextField
                fullWidth
                id={id + "-model"}
                label="음성 모델"
                select
                value={model.id}
                disabled={busy}
                onChange={(event) => {
                  setModelId(event.target.value);
                  setVoice(null);
                }}
              >
                {models.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.name}
                    {item.installed ? "" : " · 설치 필요"}
                  </MenuItem>
                ))}
              </TextField>
              <Stack
                direction="row"
                useFlexGap
                spacing={1}
                sx={{ my: 2, flexWrap: "wrap" }}
              >
                <Chip
                  size="small"
                  label={
                    model.engine === "qwen"
                      ? "MLX · Apple Silicon"
                      : browserMode
                        ? "브라우저에서 실행"
                        : "ONNX · CPU"
                  }
                />
                <Chip
                  size="small"
                  color={model.installed ? "success" : "default"}
                  variant="outlined"
                  label={model.installed ? "사용 준비 완료" : "다운로드 필요"}
                />
              </Stack>
              {!model.installed && (
                <Alert
                  severity="info"
                  sx={{
                    mb: 2,
                    flexWrap: { xs: "wrap", sm: "nowrap" },
                    "& .MuiAlert-message": { minWidth: 0, flex: 1 },
                    "& .MuiAlert-action": {
                      flexShrink: 0,
                      width: { xs: "100%", sm: "auto" },
                      pl: { xs: 0, sm: 2 },
                      justifyContent: "flex-end",
                    },
                  }}
                  action={
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={onModels}
                      sx={{ whiteSpace: "nowrap", flexShrink: 0 }}
                    >
                      모델 보관함
                    </Button>
                  }
                >
                  모델을 먼저 다운로드하세요. 작성 중인 내용은 유지됩니다.
                </Alert>
              )}
              <RuntimeHelp compact />
              <Box
                sx={{ borderTop: "1px solid", borderColor: "divider", pt: 2.5 }}
              >
                <OptionsForm
                  model={model}
                  value={voice || defaults(model)}
                  onChange={setVoice}
                  disabled={busy}
                  active={active}
                />
              </Box>
              <Button
                fullWidth
                type="submit"
                variant="contained"
                size="large"
                startIcon={<GraphicEq />}
                endIcon={<ArrowForward />}
                disabled={
                  busy ||
                  !model.installed ||
                  (mode === 0 ? !file : !text.trim())
                }
                sx={{ mt: 2.5, minHeight: 48 }}
              >
                {busy ? "작업 등록 중…" : "음성 변환 시작"}
              </Button>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textAlign: "center", display: "block", mt: 1.5 }}
              >
                완성된 MP3를 듣고 파일로 저장할 수 있습니다.
              </Typography>
            </>
          ) : (
            <Alert severity="info">음성 모델을 불러오는 중입니다.</Alert>
          )}
        </Paper>
      </Box>
    </Box>
  );
}

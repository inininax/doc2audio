import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import {
  Add,
  ArrowForward,
  AudioFileOutlined,
  AutoStoriesOutlined,
  CheckCircleOutlined,
  GraphicEq,
  HelpOutlined,
  History,
  Inventory2Outlined,
  RadioButtonChecked,
} from "@mui/icons-material";
import { request, browserMode, type Health, type Job, type Model } from "./api";
import NewJob from "./NewJob";
import BrowserStorage from "./BrowserStorage";
import Models from "./Models";
import JobCard from "./JobCard";
import JobDetail from "./JobDetail";
import Help from "./Help";
type View = "new" | "history" | "models" | "help";
const navItems = [
  { id: "new" as View, label: "새 음성 만들기", icon: <Add /> },
  { id: "history" as View, label: "작업 기록", icon: <History /> },
  { id: "models" as View, label: "모델 보관함", icon: <Inventory2Outlined /> },
  { id: "help" as View, label: "도움말", icon: <HelpOutlined /> },
];
const headings = {
  new: ["새 음성 만들기", "문서나 텍스트를 넣고, 원하는 목소리로 변환하세요."],
  history: ["작업 기록", "진행 상태를 확인하고 완성된 MP3를 듣고 저장하세요."],
  models: ["모델 보관함", "음성 변환에 사용할 모델을 다운로드하고 관리하세요."],
  help: [
    "도움말",
    "내 문서가 어디에서 처리되고, 어디에 저장되는지 알아보세요.",
  ],
};
function currentView(): View {
  const hash = location.hash.slice(1);
  return ["new", "history", "models", "help"].includes(hash)
    ? (hash as View)
    : "new";
}
export default function App() {
  const [view, setView] = useState<View>(currentView);
  const [models, setModels] = useState<Model[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsPage, setJobsPage] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const pageRef = useRef(0);
  const refreshSequence = useRef(0);
  const [health, setHealth] = useState<Health | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const selectionRef = useRef<{ id: string | null }>({ id: null });
  const detailSequence = useRef(0);
  const [detail, setDetail] = useState<Job | null>(null);
  const [detailError, setDetailError] = useState<{
    message: string;
    source: "action" | "poll";
  } | null>(null);
  const [ready, setReady] = useState(false);
  const selectJob = useCallback((job: Job | null) => {
    // A new identity invalidates pending detail responses even after closing
    // and reopening the same job before an earlier action has returned.
    selectionRef.current = { id: job?.id ?? null };
    detailSequence.current += 1;
    setSelected(job?.id ?? null);
    setDetail(job);
    setDetailError(null);
  }, []);
  const changePage = useCallback((next: number) => {
    const value = Math.max(0, next);
    if (pageRef.current === value) return;
    pageRef.current = value;
    refreshSequence.current += 1;
    setPage(value);
  }, []);
  const refresh = useCallback(async () => {
    const requestedPage = pageRef.current;
    const sequence = ++refreshSequence.current;
    const current = () =>
      sequence === refreshSequence.current && requestedPage === pageRef.current;
    const result = await Promise.all([
      request<{
        items: Model[];
      }>("/models"),
      request<{
        items: Job[];
        total: number;
      }>(`/jobs?limit=50&offset=${requestedPage * 50}`),
      request<Health>("/health"),
    ]).catch((error: unknown) => {
      if (current()) throw error;
      return null;
    });
    // Page changes and newer refreshes invalidate older responses.
    if (!result || !current()) return;
    const [m, j, h] = result;
    setModels(m.items);
    setTotal(j.total);
    setHealth(h);
    setConnectionError("");
    setReady(true);
    const lastPage = Math.max(0, Math.ceil(j.total / 50) - 1);
    if (requestedPage > lastPage) {
      changePage(lastPage);
      return;
    }
    setJobs(j.items);
    setJobsPage(requestedPage);
  }, [changePage]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        await refresh();
      } catch (e) {
        if (!disposed)
          setConnectionError(
            browserMode
              ? e instanceof Error
                ? e.message
                : "브라우저 저장소를 열 수 없습니다."
              : "서버 연결을 확인하고 있습니다. 서버를 실행하면 작업 기록을 다시 불러옵니다.",
          );
      } finally {
        if (!disposed) timer = setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => {
      disposed = true;
      refreshSequence.current += 1;
      clearTimeout(timer);
    };
  }, [page, refresh]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const selection = selectionRef.current;
      if (selection.id !== selected) return;
      const sequence = ++detailSequence.current;
      const current = () =>
        !disposed &&
        selection === selectionRef.current &&
        sequence === detailSequence.current;
      try {
        const d = await request<Job>(`/jobs/${selected}`);
        if (current()) {
          setDetail(d);
          setDetailError((current) =>
            current?.source === "poll" ? null : current,
          );
        }
      } catch (e) {
        if (current())
          setDetailError((current) =>
            current?.source === "action"
              ? current
              : { message: (e as Error).message, source: "poll" },
          );
      } finally {
        if (!disposed) timer = setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [selected]);
  useEffect(() => {
    const change = () => {
      setView(currentView());
      changePage(0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, [changePage]);
  useLayoutEffect(() => {
    // A different screen or history page starts at the top. Opening a detail
    // drawer alone leaves the current list position intact.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [view, page]);
  function navigate(next: View) {
    location.hash = next;
    setView(next);
    changePage(0);
  }
  async function action(path: string, message: string, jobId?: string) {
    const selection = selectionRef.current;
    const ownsSelection = () =>
      !!jobId && selection.id === jobId && selection === selectionRef.current;
    setBusy(true);
    if (jobId) {
      if (ownsSelection()) {
        detailSequence.current += 1;
        setDetailError(null);
      }
    } else {
      setError("");
    }
    try {
      await request(path, { method: "POST" });
      // Polls begun before the mutation completed may still contain its old state.
      if (ownsSelection()) detailSequence.current += 1;
      setToast(message);
      if (path.endsWith("/delete") && ownsSelection()) selectJob(null);
      await refresh().catch((e: unknown) => {
        setConnectionError(
          e instanceof Error ? e.message : "작업 목록을 불러오지 못했습니다.",
        );
      });
      if (ownsSelection() && !path.endsWith("/delete")) {
        const sequence = ++detailSequence.current;
        const current = () =>
          ownsSelection() && sequence === detailSequence.current;
        try {
          const updated = await request<Job>(`/jobs/${jobId}`);
          if (current()) {
            setDetail(updated);
            setDetailError((current) =>
              current?.source === "poll" ? null : current,
            );
          }
        } catch (e) {
          if (current())
            setDetailError((current) =>
              current?.source === "action"
                ? current
                : {
                    message:
                      "작업은 처리됐지만 상세 상태를 불러오지 못했습니다. " +
                      (e instanceof Error
                        ? e.message
                        : "잠시 후 다시 확인합니다."),
                    source: "poll",
                  },
            );
        }
      }
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "요청을 처리하지 못했습니다.";
      if (jobId) {
        if (ownsSelection()) setDetailError({ message, source: "action" });
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }
  const jobsLoading = jobsPage !== page;
  const pageJobs = jobsLoading ? [] : jobs;
  const modelName = (id: string) => models.find((m) => m.id === id)?.name || id;
  const runtimeLabel = browserMode ? "브라우저 실행" : "로컬 서버 실행";
  return (
    <Box className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        본문으로 건너뛰기
      </a>
      <Box component="aside" className="sidebar" aria-label="워크스페이스">
        <Box className="brand">
          <Box className="brand-icon" sx={{ bgcolor: "transparent" }}>
            <Box
              component="img"
              src={`${import.meta.env.BASE_URL}brand/logo-128.png`}
              srcSet={`${import.meta.env.BASE_URL}brand/logo-256.png 2x`}
              alt=""
              width={34}
              height={34}
              sx={{
                display: "block",
                width: "100%",
                height: "100%",
                borderRadius: "inherit",
                objectFit: "contain",
              }}
            />
          </Box>
          <Typography
            sx={{ fontWeight: 750, fontSize: 20, letterSpacing: -0.6 }}
          >
            DOC2AUDIO
          </Typography>
          <Typography
            className="mobile-runtime"
            variant="caption"
            color="text.secondary"
          >
            {runtimeLabel}
          </Typography>
        </Box>
        <Typography
          className="nav-label"
          variant="caption"
          color="text.secondary"
        >
          워크스페이스
        </Typography>
        <Box component="nav" aria-label="주 메뉴">
          {navItems.map((item) => (
            <Button
              key={item.id}
              fullWidth
              startIcon={item.icon}
              className={`nav-button ${view === item.id ? "selected" : ""}`}
              color="inherit"
              onClick={() => navigate(item.id)}
              aria-current={view === item.id ? "page" : undefined}
            >
              {item.label}
            </Button>
          ))}
        </Box>
        <Box className="sidebar-bottom">
          <Paper variant="outlined" sx={{ p: 2, bgcolor: "#f9fafc" }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Box
                className="online-dot"
                sx={{
                  bgcolor: connectionError ? "warning.main" : "success.main",
                }}
              />
              <Typography variant="body2" sx={{ fontWeight: 650 }}>
                {connectionError
                  ? "연결 확인 필요"
                  : browserMode
                    ? "브라우저 저장소"
                    : "로컬 서버"}
              </Typography>
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 1 }}
            >
              문서와 음성은 내 컴퓨터에서 처리하고 저장합니다.
            </Typography>
          </Paper>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 2 }}
          >
            DOC2AUDIO{health?.version ? ` v${health.version}` : ""}
          </Typography>
        </Box>
      </Box>
      <Box className="main-shell">
        <Box component="header" className="topbar">
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <AutoStoriesOutlined color="action" fontSize="small" />
            <Typography variant="body2" color="text.secondary">
              워크스페이스
            </Typography>
            <Typography variant="body2" color="text.disabled">
              /
            </Typography>
            <Typography variant="body2">
              {navItems.find((n) => n.id === view)?.label}
            </Typography>
          </Stack>
          <Chip
            icon={<RadioButtonChecked sx={{ fontSize: "13px !important" }} />}
            size="small"
            label={runtimeLabel}
            variant="outlined"
            sx={{
              color: "success.dark",
              borderColor: "#c7e2d3",
              bgcolor: "#f0f9f4",
            }}
          />
        </Box>
        <Box
          component="main"
          id="main-content"
          tabIndex={-1}
          className="main-content"
        >
          <Stack className="page-heading" direction="row">
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h1" variant="h4" sx={{ mb: 0.75 }}>
                {headings[view][0]}
              </Typography>
              <Typography color="text.secondary" variant="body2">
                {headings[view][1]}
              </Typography>
            </Box>
            {view === "history" && (
              <Button
                variant="contained"
                startIcon={<Add />}
                sx={{ flexShrink: 0 }}
                onClick={() => navigate("new")}
              >
                새 음성 만들기
              </Button>
            )}
          </Stack>
          {connectionError && (
            <Alert severity="warning" sx={{ mb: 3 }}>
              {connectionError}
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError("")}>
              {error}
            </Alert>
          )}
          {browserMode && health && (
            <BrowserStorage health={health} onRefresh={refresh} />
          )}
          {health && !health.ffmpeg && (
            <Alert severity="error" sx={{ mb: 3 }}>
              오디오 저장을 위한 ffmpeg가 없습니다. 설치 후 서버를 다시
              실행하세요.
            </Alert>
          )}
          {(!ready || jobsLoading) && !connectionError && (
            <LinearProgress
              aria-label={
                ready ? "작업 기록 불러오는 중" : "작업과 모델 불러오는 중"
              }
              sx={{ mb: 3 }}
            />
          )}
          <Box hidden={view !== "new"}>
            <Box className="stats-grid">
              <Paper variant="outlined" className="stat">
                <Box className="stat-symbol">
                  <AudioFileOutlined />
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    저장된 작업
                  </Typography>
                  <Typography component="p" variant="h5">
                    {ready ? total.toLocaleString() : "—"}
                    <Typography
                      component="span"
                      variant="body2"
                      color="text.secondary"
                      sx={{ ml: 0.7 }}
                    >
                      개
                    </Typography>
                  </Typography>
                </Box>
              </Paper>
              <Paper variant="outlined" className="stat">
                <Box className="stat-symbol mint">
                  <CheckCircleOutlined />
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    준비된 모델
                  </Typography>
                  <Typography component="p" variant="h5">
                    {ready ? models.filter((m) => m.installed).length : "—"}
                    <Typography
                      component="span"
                      variant="body2"
                      color="text.secondary"
                      sx={{ ml: 0.7 }}
                    >
                      / {models.length}
                    </Typography>
                  </Typography>
                </Box>
              </Paper>
              <Paper variant="outlined" className="stat">
                <Box className="stat-symbol neutral">
                  <GraphicEq />
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    출력 형식
                  </Typography>
                  <Typography component="p" variant="h5">
                    MP3
                  </Typography>
                </Box>
              </Paper>
            </Box>
            <NewJob
              models={models}
              active={view === "new" && !selected}
              onModels={() => navigate("models")}
              onHelp={() => navigate("help")}
              onCreated={(job) => {
                selectJob(job);
                setToast("음성 변환을 등록했습니다.");
                navigate("history");
                void refresh().catch((e: unknown) =>
                  setConnectionError(
                    e instanceof Error
                      ? e.message
                      : "작업 목록을 불러오지 못했습니다.",
                  ),
                );
              }}
            />
            <Stack
              direction="row"
              sx={{
                justifyContent: "space-between",
                alignItems: "center",
                ...{ mt: 4, mb: 2 },
              }}
            >
              <Typography component="h2" variant="h6">
                최근 작업
              </Typography>
              <Button
                endIcon={<ArrowForward />}
                onClick={() => navigate("history")}
              >
                모두 보기
              </Button>
            </Stack>
            {jobsLoading ? null : pageJobs.length ? (
              <Stack spacing={1.5}>
                {pageJobs.slice(0, 3).map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    modelName={modelName(job.model_id)}
                    onOpen={() => selectJob(job)}
                  />
                ))}
              </Stack>
            ) : (
              <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
                <Typography variant="body2" color="text.secondary">
                  첫 번째 문서를 음성으로 만들어 보세요. 작업 기록이 여기에
                  쌓입니다.
                </Typography>
              </Paper>
            )}
          </Box>
          {view === "help" && <Help />}
          {view === "models" && (
            <Models
              models={models}
              jobs={pageJobs}
              busy={busy || jobsLoading}
              onDownload={(id) => {
                void action(
                  `/models/${id}/download`,
                  "모델 다운로드를 등록했습니다.",
                );
              }}
              onDelete={(id) => {
                void action(`/models/${id}/delete`, "모델을 삭제했습니다.");
              }}
            />
          )}
          {view === "history" && (
            <>
              <Stack
                direction="row"
                sx={{
                  mb: 2,
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Typography
                  component="h2"
                  variant="subtitle1"
                  sx={{ fontWeight: 650 }}
                >
                  전체 작업{" "}
                  <Box
                    component="span"
                    sx={{ color: "text.secondary", ml: 0.5 }}
                  >
                    {ready ? total.toLocaleString() : "—"}
                  </Box>
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  최신 등록순
                </Typography>
              </Stack>
              {jobsLoading ? null : pageJobs.length ? (
                <Stack spacing={1.5}>
                  {pageJobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      modelName={modelName(job.model_id)}
                      onOpen={() => selectJob(job)}
                    />
                  ))}
                </Stack>
              ) : (
                <Paper
                  variant="outlined"
                  sx={{ py: { xs: 5, sm: 7 }, px: 3, textAlign: "center" }}
                >
                  <Box className="empty-symbol">
                    <History />
                  </Box>
                  <Typography component="h3" variant="h6">
                    아직 작업이 없습니다
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ my: 1 }}
                  >
                    문서 파일을 선택하거나 텍스트를 입력해 시작하세요.
                  </Typography>
                  <Button
                    variant="contained"
                    sx={{ mt: 2 }}
                    onClick={() => navigate("new")}
                    startIcon={<Add />}
                  >
                    새 음성 만들기
                  </Button>
                </Paper>
              )}
              {total > 50 && (
                <Stack
                  direction="row"
                  spacing={2}
                  sx={{
                    justifyContent: "center",
                    alignItems: "center",
                    ...{ mt: 3 },
                  }}
                >
                  <Button
                    disabled={page === 0}
                    onClick={() => changePage(page - 1)}
                  >
                    이전
                  </Button>
                  <Typography>
                    {page + 1} / {Math.ceil(total / 50)}
                  </Typography>
                  <Button
                    disabled={(page + 1) * 50 >= total}
                    onClick={() => changePage(page + 1)}
                  >
                    다음
                  </Button>
                </Stack>
              )}
            </>
          )}
          <Box component="footer" sx={{ mt: 4 }}>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="caption" color="text.secondary">
              DOC2AUDIO · 문서를 음성으로
            </Typography>
          </Box>
        </Box>
      </Box>
      <JobDetail
        job={detail}
        model={models.find((m) => m.id === detail?.model_id)}
        onClose={() => selectJob(null)}
        busy={busy}
        actionError={detailError?.message}
        onDismissError={() => setDetailError(null)}
        onAction={(id, next) => {
          void action(
            `/jobs/${id}/${next}`,
            next === "cancel"
              ? "작업 취소를 요청했습니다."
              : next === "pause"
                ? "작업을 일시정지했습니다."
                : next === "delete"
                  ? "작업을 삭제했습니다."
                  : "저장된 지점부터 이어갑니다.",
            id,
          );
        }}
      />
      <Snackbar
        open={!!toast}
        autoHideDuration={4500}
        onClose={() => setToast("")}
        message={toast}
      />
    </Box>
  );
}

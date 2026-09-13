import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { PlayArrowRounded, StopRounded } from "@mui/icons-material";

type Phase = "idle" | "loading" | "playing" | "ended";
const pageHidden = () => document.visibilityState === "hidden";
const loadError =
  "이 목소리의 샘플 파일을 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.";

export default function VoiceSample({
  modelId,
  modelName,
  speaker,
  active = true,
}: {
  modelId: string;
  modelName: string;
  speaker: string;
  active?: boolean;
}) {
  const id = useId();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const source = `${import.meta.env.BASE_URL}voice-samples/${encodeURIComponent(modelId)}/${encodeURIComponent(speaker)}.mp3`;
  const releaseAudio = useCallback(() => {
    const audio = audioRef.current;
    audioRef.current = null;
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.onpause = null;
    audio.pause();
    audio.removeAttribute("src");
    // Abort loading and any outstanding play() promise, including on tab changes.
    audio.load();
  }, []);
  const stop = useCallback(() => {
    releaseAudio();
    setPhase("idle");
  }, [releaseAudio]);

  useLayoutEffect(() => {
    releaseAudio();
    setPhase("idle");
    setError("");
    return releaseAudio;
  }, [source, active, releaseAudio]);
  useEffect(() => {
    const visibility = () => {
      if (pageHidden()) stop();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", stop);
    };
  }, [stop]);

  async function play() {
    if (!active || pageHidden()) return;
    releaseAudio();
    // Each attempt owns its media element. A late result can never stop or
    // restart a newer voice, including a stop followed by replay of the same voice.
    const audio = new Audio();
    audio.preload = "none";
    audio.src = source;
    audioRef.current = audio;
    const current = () => audioRef.current === audio;
    setError("");
    setPhase("loading");
    audio.onended = () => {
      if (!current()) return;
      releaseAudio();
      setPhase("ended");
    };
    audio.onpause = () => {
      if (!current()) return;
      const ended = audio.ended;
      releaseAudio();
      setPhase(ended ? "ended" : "idle");
    };
    audio.onerror = () => {
      if (!current()) return;
      releaseAudio();
      setPhase("idle");
      setError(loadError);
    };
    try {
      await audio.play();
      if (!current()) {
        audio.pause();
        return;
      }
      if (pageHidden()) {
        stop();
        return;
      }
      setPhase("playing");
    } catch (cause) {
      if (!current()) return;
      releaseAudio();
      setPhase("idle");
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "브라우저가 재생을 허용하지 않았습니다. 샘플 듣기를 다시 눌러 주세요."
          : loadError,
      );
    }
  }

  const listening = phase === "playing" || phase === "loading";
  const action =
    phase === "loading"
      ? "불러오기 취소"
      : listening
        ? "샘플 정지"
        : "샘플 듣기";
  const status =
    phase === "loading"
      ? "샘플을 불러오는 중입니다."
      : phase === "playing"
        ? "샘플 재생 중"
        : phase === "ended"
          ? "샘플 재생이 끝났습니다."
          : "모델 다운로드 없이 들을 수 있습니다.";
  return (
    <Box
      sx={{
        mt: 2,
        p: 1.5,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: "background.default",
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 1,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, overflowWrap: "anywhere" }}
          >
            {speaker} 목소리 샘플
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            role="status"
            aria-live="polite"
          >
            {status}
          </Typography>
        </Box>
        <Button
          type="button"
          variant="outlined"
          size="small"
          disabled={!active}
          aria-label={`${modelName} ${speaker} ${action}`}
          aria-describedby={id + "-help"}
          onClick={() => (listening ? stop() : void play())}
          startIcon={
            phase === "loading" ? (
              <CircularProgress size={16} color="inherit" />
            ) : listening ? (
              <StopRounded />
            ) : (
              <PlayArrowRounded />
            )
          }
          sx={{ flexShrink: 0 }}
        >
          {action}
        </Button>
      </Stack>
      <Typography
        id={id + "-help"}
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mt: 1 }}
      >
        미리 생성한 한국어 샘플입니다. 배속·말투 설정은 반영하지 않습니다.
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mt: 1.5, overflowWrap: "anywhere" }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}

import { useEffect, useId, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Collapse,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { ExpandLess, ExpandMore, ShieldOutlined } from "@mui/icons-material";
import { type Health, request } from "./api";
import { getOfflineStatus } from "./browser/offline";

export default function BrowserStorage({
  health,
  onRefresh,
}: {
  health: Health;
  onRefresh: () => Promise<void>;
}) {
  const id = useId();
  const [offlineState, setOfflineState] = useState(getOfflineStatus);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    severity: "success" | "warning" | "error";
  } | null>(null);
  useEffect(() => {
    const changed = () => setOfflineState(getOfflineStatus());
    window.addEventListener("doc2audio-offline-status", changed);
    changed();
    return () =>
      window.removeEventListener("doc2audio-offline-status", changed);
  }, []);
  const storage = health.storage;
  const offlineLabel =
    offlineState === "ready"
      ? "오프라인 화면 준비됨"
      : offlineState === "failed"
        ? "오프라인 준비 실패"
        : offlineState === "development"
          ? "개발 모드"
          : "오프라인 준비 중";
  async function protect() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await request<{ persistent: boolean }>(
        "/storage/persist",
        { method: "POST" },
      );
      setMessage(
        result.persistent
          ? { text: "저장 공간 보호를 설정했습니다.", severity: "success" }
          : {
              text: "브라우저가 보호 요청을 허용하지 않았습니다. 필요한 MP3는 파일로도 저장해 주세요.",
              severity: "warning",
            },
      );
      try {
        await onRefresh();
      } catch {
        setMessage({
          text: "보호 요청을 처리했지만 저장 상태를 다시 불러오지 못했습니다. 잠시 후 확인해 주세요.",
          severity: "warning",
        });
      }
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : String(error),
        severity: "error",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Paper
      variant="outlined"
      className="browser-storage"
      sx={{ mb: 2, px: { xs: 1.5, md: 2 }, py: { xs: 1, md: 1.5 } }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          columnGap: 1,
          alignItems: "center",
        }}
      >
        <Stack
          direction="row"
          sx={{
            gridColumn: { xs: "1 / -1", md: "1" },
            alignItems: "center",
            flexWrap: "wrap",
            columnGap: 1,
            minWidth: 0,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {storage
              ? (storage.usage / 1024 ** 2).toFixed(0) + " MB 사용"
              : "저장소 확인 중"}
          </Typography>
          <Typography
            variant="caption"
            color={offlineState === "failed" ? "error.main" : "text.secondary"}
          >
            · {offlineLabel}
            {storage?.persistent ? " · 보호됨" : ""}
          </Typography>
        </Stack>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ gridColumn: 1, gridRow: 2 }}
        >
          다시 열면 저장한 구간부터 이어집니다.
        </Typography>
        <Stack
          direction="row"
          sx={{
            gridColumn: 2,
            gridRow: { xs: 2, md: "1 / span 2" },
            alignItems: "center",
            gap: 0.5,
          }}
        >
          {!storage?.persistent && (
            <Button
              variant="text"
              size="small"
              disabled={busy || !storage}
              onClick={() => void protect()}
              sx={{
                whiteSpace: "nowrap",
                px: 1,
                minHeight: { xs: 48, sm: 44 },
              }}
            >
              {busy ? "요청 중…" : "저장 공간 보호"}
            </Button>
          )}
          <IconButton
            aria-label={expanded ? "저장소 안내 접기" : "저장소 안내 펼치기"}
            aria-expanded={expanded}
            aria-controls={id + "-details"}
            onClick={() => setExpanded(!expanded)}
            sx={{ width: { xs: 48, sm: 44 }, height: { xs: 48, sm: 44 } }}
          >
            {expanded ? <ExpandLess /> : <ExpandMore />}
          </IconButton>
        </Stack>
      </Box>
      <Collapse in={expanded}>
        <Box
          id={id + "-details"}
          sx={{
            borderTop: "1px solid",
            borderColor: "divider",
            mt: 1,
            pt: 1.5,
            pb: 0.5,
          }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
            <ShieldOutlined
              sx={{ color: "text.secondary", fontSize: 20, mt: 0.25 }}
            />
            <Box>
              <Typography variant="body2" color="text.secondary">
                창을 닫은 동안 변환은 멈춥니다. 같은 브라우저로 다시 접속하면
                자동으로 이어가며, 일시정지한 작업은 ‘이어서 실행’을 눌러
                주세요.
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                기록은 이 PC의 현재 브라우저에만 남습니다. 사이트 데이터를
                삭제하면 모델과 작업도 삭제됩니다. 필요한 MP3는 파일로 보관해
                주세요.
              </Typography>
              {storage && storage.quota > 0 && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 1 }}
                >
                  브라우저 저장 한도 {(storage.quota / 1024 ** 3).toFixed(1)} GB
                  ·{" "}
                  {storage.persistent
                    ? "자동 정리로부터 보호됨"
                    : "저장 공간 보호 권장"}
                </Typography>
              )}
              {offlineState === "failed" && (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  오프라인 화면을 저장하지 못했습니다. 연결과 저장 공간을 확인한
                  뒤 새로고침하세요.
                </Alert>
              )}
            </Box>
          </Stack>
        </Box>
      </Collapse>
      {message && (
        <Alert
          severity={message.severity}
          sx={{ mt: 1 }}
          onClose={() => setMessage(null)}
        >
          {message.text}
        </Alert>
      )}
    </Paper>
  );
}

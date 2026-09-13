import {
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import {
  DescriptionOutlined,
  DownloadOutlined,
  ArrowOutward,
} from "@mui/icons-material";
import { active, type Job } from "./api";
export const statuses: Record<string, string> = {
  queued: "대기 중",
  running: "진행 중",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
  cancelling: "취소 중",
  interrupted: "중단됨",
  paused: "일시정지",
};
export function Status({ job }: { job: Job }) {
  return (
    <Chip
      size="small"
      label={statuses[job.status] || job.status}
      color={
        job.status === "completed"
          ? "success"
          : job.status === "failed"
            ? "error"
            : active(job)
              ? "primary"
              : "default"
      }
      variant="outlined"
      sx={{ flexShrink: 0 }}
    />
  );
}
export default function JobCard({
  job,
  modelName,
  onOpen,
}: {
  job: Job;
  modelName: string;
  onOpen: () => void;
}) {
  const progress = Math.round(Math.min(1, Math.max(0, job.progress)) * 100);
  return (
    <Paper
      component="article"
      variant="outlined"
      className="job-card"
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "minmax(0, 1fr)",
          sm: "minmax(0, 1fr) auto",
          md: "48px minmax(0, 1fr) auto",
        },
        alignItems: "start",
        gap: { xs: 1.5, sm: 2 },
        p: { xs: 2, sm: 2.5 },
      }}
    >
      <Box className="file-symbol" sx={{ display: { xs: "none", md: "grid" } }}>
        {job.kind === "download" ? (
          <DownloadOutlined />
        ) : (
          <DescriptionOutlined />
        )}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Stack
          direction="row"
          sx={{ alignItems: "center", flexWrap: "wrap", gap: 1, mb: 0.75 }}
        >
          <Typography
            component="h3"
            variant="subtitle2"
            title={job.title}
            sx={{
              fontSize: 15,
              overflowWrap: "anywhere",
              minWidth: 0,
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 3,
              overflow: "hidden",
            }}
          >
            {job.title}
          </Typography>
          <Status job={job} />
        </Stack>
        <Stack
          direction="row"
          sx={{ flexWrap: "wrap", gap: "4px 16px", color: "text.secondary" }}
        >
          <Typography
            variant="body2"
            sx={{ fontSize: 13, overflowWrap: "anywhere" }}
          >
            {modelName}
          </Typography>
          <Typography
            component="time"
            dateTime={job.created_at}
            variant="body2"
            sx={{ fontSize: 13 }}
          >
            {new Date(job.created_at).toLocaleString("ko-KR")}
          </Typography>
          {job.result?.seconds !== undefined && (
            <Typography variant="body2" sx={{ fontSize: 13 }}>
              음성 {job.result.seconds.toFixed(1)}초
            </Typography>
          )}
        </Stack>
        {(active(job) || job.status === "paused") && (
          <Box sx={{ mt: 1.5 }}>
            <LinearProgress
              aria-label={`${job.title} 진행률`}
              variant={
                job.progress > 0 || job.status === "paused"
                  ? "determinate"
                  : "indeterminate"
              }
              value={progress}
            />
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.75, fontSize: 13, overflowWrap: "anywhere" }}
            >
              {job.message} {job.progress > 0 && `· ${progress}%`}
            </Typography>
          </Box>
        )}
        {job.status === "failed" && (
          <Typography
            variant="body2"
            sx={{ mt: 1, overflowWrap: "anywhere", color: "error.main" }}
          >
            {job.error}
          </Typography>
        )}
      </Box>
      <Button
        variant="outlined"
        color="inherit"
        aria-label={`${job.title} 작업 상세 보기`}
        onClick={onOpen}
        endIcon={<ArrowOutward fontSize="small" />}
        sx={{
          minHeight: 48,
          px: 1.5,
          alignSelf: "center",
          justifySelf: "end",
          whiteSpace: "nowrap",
        }}
      >
        상세
      </Button>
    </Paper>
  );
}

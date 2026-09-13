import { useId, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { ExpandMore } from "@mui/icons-material";
import type { Model, Option, VoiceOptions } from "./api";
import VoiceSample from "./VoiceSample";

const primaryKeys = ["speaker", "language", "speed", "speech_speed"];
const languageNames = new Intl.DisplayNames(["ko"], { type: "language" });
const languageLabels: Record<string, string> = {
  Auto: "자동 감지",
  Korean: "한국어",
  English: "영어",
  Chinese: "중국어",
  Japanese: "일본어",
  French: "프랑스어",
  German: "독일어",
  Spanish: "스페인어",
  Portuguese: "포르투갈어",
  Italian: "이탈리아어",
  Russian: "러시아어",
};

function choiceLabel(option: Option, choice: string) {
  if (option.key !== "language") return choice;
  if (languageLabels[choice]) return languageLabels[choice];
  try {
    return languageNames.of(choice) || choice;
  } catch {
    return choice;
  }
}

function optionError(option: Option, value: string | number): string {
  if (!["number", "integer"].includes(option.type)) return "";
  if (value === "" || !Number.isFinite(Number(value)))
    return "숫자를 입력하세요.";
  if (option.type === "integer" && !Number.isInteger(Number(value)))
    return "정수를 입력하세요.";
  if (option.min !== undefined && Number(value) < option.min)
    return option.min + " 이상으로 입력하세요.";
  if (option.max !== undefined && Number(value) > option.max)
    return option.max + " 이하로 입력하세요.";
  const step = option.step ?? 1;
  const steps = (Number(value) - (option.min ?? 0)) / step;
  if (step > 0 && Math.abs(steps - Math.round(steps)) > 0.0000001)
    return step + " 단위로 입력하세요.";
  return "";
}

export default function OptionsForm({
  model,
  value,
  onChange,
  disabled = false,
  active = true,
}: {
  model: Model;
  value: VoiceOptions;
  onChange: (value: VoiceOptions) => void;
  disabled?: boolean;
  active?: boolean;
}) {
  const id = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const primary = primaryKeys.flatMap((key) =>
    model.options.filter((option) => option.key === key),
  );
  const advanced = model.options.filter(
    (option) => !primaryKeys.includes(option.key),
  );
  const advancedInvalid = advanced.some((option) =>
    optionError(option, value[option.key] ?? option.default),
  );
  const grid = {
    display: "grid",
    gridTemplateColumns: {
      xs: "minmax(0, 1fr)",
      sm: "repeat(2, minmax(0, 1fr))",
    },
    gap: 2,
  };
  function field(option: Option) {
    const current = value[option.key] ?? option.default;
    const error = optionError(option, current);
    const help =
      option.help ||
      (option.key === "speed"
        ? "음성 높이를 유지하며 완성 파일의 배속을 조절합니다."
        : option.key === "speech_speed"
          ? "모델이 말하는 속도를 조절합니다."
          : undefined);
    return (
      <TextField
        key={option.key}
        fullWidth
        id={id + "-" + option.key}
        label={option.label}
        select={option.type === "select"}
        multiline={option.type === "text"}
        minRows={option.type === "text" ? 2 : undefined}
        type={["number", "integer"].includes(option.type) ? "number" : "text"}
        value={current}
        disabled={disabled}
        error={Boolean(error)}
        helperText={error || help}
        required={["number", "integer"].includes(option.type)}
        onChange={(event) =>
          onChange({
            ...value,
            [option.key]: ["number", "integer"].includes(option.type)
              ? event.target.value === ""
                ? ""
                : Number(event.target.value)
              : event.target.value,
          })
        }
        sx={{
          minWidth: 0,
          gridColumn: option.type === "text" ? "1 / -1" : undefined,
        }}
        slotProps={{
          htmlInput: {
            min: option.min,
            max: option.max,
            step: option.step,
            maxLength: option.type === "text" ? 1000 : undefined,
          },
        }}
      >
        {option.choices?.map((choice) => (
          <MenuItem key={choice} value={choice}>
            {choiceLabel(option, choice)}
          </MenuItem>
        ))}
      </TextField>
    );
  }
  return (
    <Box>
      <Box sx={grid}>{primary.map(field)}</Box>
      {model.options.some((option) => option.key === "speaker") && (
        <VoiceSample
          modelId={model.id}
          modelName={model.name}
          speaker={String(
            value.speaker ??
              model.options.find((option) => option.key === "speaker")
                ?.default ??
              "",
          )}
          active={active && !disabled}
        />
      )}
      {advanced.length > 0 && (
        <Accordion
          disableGutters
          elevation={0}
          expanded={advancedOpen || advancedInvalid}
          onChange={(_, expanded) => setAdvancedOpen(expanded)}
          sx={{
            mt: 2,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: "8px",
            "&:before": { display: "none" },
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMore />}
            id={id + "-advanced-heading"}
            aria-controls={id + "-advanced-content"}
            sx={{ minHeight: 48 }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              고급 음성 설정
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 1, px: 2, pb: 2 }}>
            <Box sx={grid}>{advanced.map(field)}</Box>
          </AccordionDetails>
        </Accordion>
      )}
    </Box>
  );
}

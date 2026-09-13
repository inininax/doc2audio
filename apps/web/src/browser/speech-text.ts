/** Supertonic text normalization; attribution is in SUPERTONIC-NOTICE.md. */
export const LANGUAGES = [
  "en",
  "ko",
  "ja",
  "ar",
  "bg",
  "cs",
  "da",
  "de",
  "el",
  "es",
  "et",
  "fi",
  "fr",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "lt",
  "lv",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "tr",
  "uk",
  "vi",
] as const;

/** Matches the normalization used by the model's official inference code. */
function speechBody(text: string, language: string): string {
  if (!(LANGUAGES as readonly string[]).includes(language))
    throw new Error("지원하지 않는 언어입니다.");
  text = text.normalize("NFKD");
  text = text.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu,
    "",
  );
  for (const [before, after] of Object.entries({
    "–": "-",
    "‑": "-",
    "—": "-",
    _: " ",
    "“": '"',
    "”": '"',
    "‘": "'",
    "’": "'",
    "´": "'",
    "`": "'",
    "[": " ",
    "]": " ",
    "|": " ",
    "/": " ",
    "#": " ",
    "→": " ",
    "←": " ",
  }))
    text = text.replaceAll(before, after);
  text = text.replace(/[♥☆♡©\\]/g, "");
  for (const [before, after] of Object.entries({
    "@": " at ",
    "e.g.,": "for example, ",
    "i.e.,": "that is, ",
  }))
    text = text.replaceAll(before, after);
  text = text
    .replace(/ ([,.!?;:'])/g, "$1")
    .replace(/"{2,}/g, '"')
    .replace(/'{2,}/g, "'");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

/** Decorative-only paragraphs must not become independent inference requests. */
export function hasSpeechContent(text: string, language: string): boolean {
  return /[\p{L}\p{N}]/u.test(speechBody(text, language));
}

export function normalizeSpeechText(text: string, language: string): string {
  text = speechBody(text, language);
  if (!text) throw new Error("읽을 수 있는 텍스트가 없습니다.");
  if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(text)) text += ".";
  return `<${language}>${text}</${language}>`;
}

export function encodeText(text: string, language: string, indexer: number[]) {
  const characters = Array.from(normalizeSpeechText(text, language));
  const ids = new BigInt64Array(
    characters.map((char) => BigInt(indexer[char.codePointAt(0)!] ?? -1)),
  );
  return { ids, mask: new Float32Array(ids.length).fill(1) };
}

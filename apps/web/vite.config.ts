import { defineConfig, type HtmlTagDescriptor, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function siteMetadata(): Plugin {
  let base = "/";
  let siteUrl: URL | undefined;
  const configuredUrl = process.env.DOC2AUDIO_SITE_URL?.trim();
  if (configuredUrl) {
    try {
      siteUrl = new URL(configuredUrl);
    } catch {
      throw new Error("DOC2AUDIO_SITE_URL must be an absolute HTTPS site URL.");
    }
    if (
      siteUrl.protocol !== "https:" ||
      siteUrl.username ||
      siteUrl.password ||
      siteUrl.search ||
      siteUrl.hash
    ) {
      throw new Error(
        "DOC2AUDIO_SITE_URL must use HTTPS without credentials, query, or fragment.",
      );
    }
    if (!siteUrl.pathname.endsWith("/")) siteUrl.pathname += "/";
  }
  return {
    name: "doc2audio-site-metadata",
    configResolved(config) {
      base = config.base;
      if (siteUrl && base.startsWith("/") && siteUrl.pathname !== base) {
        throw new Error(
          "DOC2AUDIO_SITE_URL path must match DOC2AUDIO_BASE (including the trailing slash).",
        );
      }
    },
    transformIndexHtml() {
      const image = siteUrl
        ? new URL("brand/social-card.png", siteUrl).href
        : `${base}brand/social-card.png`;
      const imageAlt = "DOC2AUDIO — 나만의 오디오 서재";
      const tags: HtmlTagDescriptor[] = [
        { tag: "meta", attrs: { property: "og:image", content: image } },
        {
          tag: "meta",
          attrs: { property: "og:image:type", content: "image/png" },
        },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { property: "og:image:alt", content: imageAlt } },
        { tag: "meta", attrs: { name: "twitter:image", content: image } },
        {
          tag: "meta",
          attrs: { name: "twitter:image:alt", content: imageAlt },
        },
      ];
      if (siteUrl) {
        tags.push(
          { tag: "meta", attrs: { property: "og:url", content: siteUrl.href } },
          { tag: "link", attrs: { rel: "canonical", href: siteUrl.href } },
        );
      }
      return tags.map((tag) => ({ ...tag, injectTo: "head" as const }));
    },
  };
}

export default defineConfig({
  base: process.env.DOC2AUDIO_BASE || "/",
  plugins: [react(), siteMetadata()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8010" },
  },
});

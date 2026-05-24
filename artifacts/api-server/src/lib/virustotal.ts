import { logger } from "./logger";
import { createHash } from "crypto";

export interface VtStats {
  malicious: number;
  suspicious: number;
  harmless: number;
  undetected: number;
}

export interface VtResult {
  stats: VtStats;
  permalink: string;
}

function urlToVtId(url: string): string {
  // VirusTotal URL id = base64url(url) without padding
  return Buffer.from(url).toString("base64url").replace(/=+$/, "");
}

async function fetchJson<T>(url: string, options: RequestInit): Promise<T | null> {
  try {
    const resp = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Check a URL against VirusTotal v3.
 * Strategy:
 *   1. Try GET /urls/{id} — instant, uses cached result (no quota cost)
 *   2. If 404 (never scanned), submit POST /urls then poll GET /analyses/{id}
 * Returns null if API key is missing or any error occurs.
 */
export async function checkVirusTotal(rawUrl: string): Promise<VtResult | null> {
  const apiKey = process.env["VIRUSTOTAL_API_KEY"];
  if (!apiKey) {
    logger.warn("VIRUSTOTAL_API_KEY not set — skipping VirusTotal check");
    return null;
  }

  const headers = { "x-apikey": apiKey, "Content-Type": "application/x-www-form-urlencoded" };
  const vtId = urlToVtId(rawUrl);
  const baseApi = "https://www.virustotal.com/api/v3";

  // 1. Try cached result first
  type VtUrlReport = { data: { attributes: { last_analysis_stats: VtStats }; links: { self: string } } };
  const cached = await fetchJson<VtUrlReport>(`${baseApi}/urls/${vtId}`, { headers });

  if (cached?.data?.attributes?.last_analysis_stats) {
    return {
      stats: cached.data.attributes.last_analysis_stats,
      permalink: `https://www.virustotal.com/gui/url/${vtId}`,
    };
  }

  // 2. Submit URL for scanning
  type VtSubmit = { data: { id: string } };
  const submitted = await fetchJson<VtSubmit>(`${baseApi}/urls`, {
    method: "POST",
    headers,
    body: `url=${encodeURIComponent(rawUrl)}`,
  });

  if (!submitted?.data?.id) {
    logger.warn("VirusTotal: failed to submit URL for scanning");
    return null;
  }

  const analysisId = submitted.data.id;

  // 3. Poll analysis result (max 3 attempts, 2s apart)
  type VtAnalysis = { data: { attributes: { status: string; stats: VtStats } } };
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const analysis = await fetchJson<VtAnalysis>(`${baseApi}/analyses/${analysisId}`, { headers });
    if (analysis?.data?.attributes?.status === "completed") {
      return {
        stats: analysis.data.attributes.stats,
        permalink: `https://www.virustotal.com/gui/url/${vtId}`,
      };
    }
  }

  logger.warn({ analysisId }, "VirusTotal: analysis did not complete in time");
  return null;
}

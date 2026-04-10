function extractCandidateType(candidateLine: string) {
  return candidateLine.match(/\btyp\s+([a-z]+)/i)?.[1] ?? "unknown";
}

export interface GatheredIceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

const FALLBACK_STUN_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      "stun:stun.cloudflare.com:3478",
      "stun:stun.l.google.com:19302",
    ],
  },
];

export function normalizeIceServers(iceServersPayload: unknown): RTCIceServer[] | null {
  if (!Array.isArray(iceServersPayload)) return null;

  const normalized = iceServersPayload.flatMap((server): RTCIceServer[] => {
    if (!server || typeof server !== "object") return [];

    const typedServer = server as {
      url?: unknown;
      urls?: unknown;
      username?: unknown;
      credential?: unknown;
    };

    const rawUrls = typedServer.urls ?? typedServer.url;
    const urls = Array.isArray(rawUrls)
      ? rawUrls.filter((url): url is string => typeof url === "string" && url.length > 0)
      : typeof rawUrls === "string" && rawUrls.length > 0
        ? rawUrls
        : null;

    if (!urls || (Array.isArray(urls) && urls.length === 0)) return [];

    return [{
      urls,
      ...(typeof typedServer.username === "string" ? { username: typedServer.username } : {}),
      ...(typeof typedServer.credential === "string" ? { credential: typedServer.credential } : {}),
    }];
  });

  return normalized.length > 0 ? normalized : null;
}

export function resolveIceServers(iceServersPayload: unknown) {
  const normalized = normalizeIceServers(iceServersPayload);
  if (normalized) {
    return {
      iceServers: normalized,
      source: "openai" as const,
    };
  }

  return {
    iceServers: FALLBACK_STUN_ICE_SERVERS,
    source: "fallback" as const,
  };
}

export function summarizeIceCandidate(candidate: RTCIceCandidate | RTCIceCandidateInit | null | undefined) {
  const candidateLine = candidate?.candidate;
  if (!candidateLine) return "end-of-candidates";

  const parts = candidateLine.split(" ");
  const protocol = parts[2] ?? "unknown";
  const address = parts[4] ?? "unknown";
  const port = parts[5] ?? "unknown";
  const type = extractCandidateType(candidateLine);
  return `type=${type} protocol=${protocol} address=${address} port=${port}`;
}

export function summarizeSdpCandidates(sdp: string) {
  const candidateLines = sdp.split(/\r?\n/).filter((line) => line.startsWith("a=candidate:"));
  if (candidateLines.length === 0) return "candidates=0";

  const types = [...new Set(candidateLines.map(extractCandidateType))];
  return `candidates=${candidateLines.length} types=${types.join(",")}`;
}

export function countSdpCandidates(sdp: string | null | undefined) {
  if (!sdp) return 0;
  return sdp.split(/\r?\n/).filter((line) => line.startsWith("a=candidate:")).length;
}

export function selectBestLocalSdp(
  offerSdp: string,
  ...descriptions: Array<RTCSessionDescription | null | undefined>
) {
  return descriptions
    .map((description) => description?.sdp)
    .filter((sdp): sdp is string => typeof sdp === "string" && sdp.length > 0)
    .sort((left, right) => countSdpCandidates(right) - countSdpCandidates(left))[0]
    ?? offerSdp;
}

export function mergeIceCandidatesIntoSdp(
  sdp: string,
  candidates: GatheredIceCandidate[],
) {
  if (countSdpCandidates(sdp) > 0 || candidates.length === 0) return sdp;

  const sections = sdp.replace(/\r\n/g, "\n").split(/\nm=/);
  if (sections.length <= 1) return sdp;

  const sessionSection = sections[0] ?? "";
  const mediaSections = sections.slice(1).map((section, index) => {
    const lines = `m=${section}`.split("\n").filter(Boolean);
    const mid = lines.find((line) => line.startsWith("a=mid:"))?.slice(6) ?? null;
    return { index, mid, lines };
  });

  const candidateBuckets = new Map<number, string[]>();
  const appendCandidate = (sectionIndex: number, candidateLine: string) => {
    const bucket = candidateBuckets.get(sectionIndex);
    if (bucket) {
      if (!bucket.includes(candidateLine)) {
        bucket.push(candidateLine);
      }
      return;
    }
    candidateBuckets.set(sectionIndex, [candidateLine]);
  };

  for (const candidate of candidates) {
    const candidateLine = `a=${candidate.candidate}`;
    if (!candidate.candidate.trim()) continue;

    if (
      typeof candidate.sdpMLineIndex === "number" &&
      candidate.sdpMLineIndex >= 0 &&
      candidate.sdpMLineIndex < mediaSections.length
    ) {
      appendCandidate(candidate.sdpMLineIndex, candidateLine);
      continue;
    }

    const matchingSectionIndex = mediaSections.findIndex((section) => section.mid === candidate.sdpMid);
    appendCandidate(matchingSectionIndex >= 0 ? matchingSectionIndex : 0, candidateLine);
  }

  if (candidateBuckets.size === 0) return sdp;

  const rebuiltSections = mediaSections.map((section) => {
    const candidateLines = candidateBuckets.get(section.index);
    if (!candidateLines || candidateLines.length === 0) {
      return section.lines;
    }

    const lines = [...section.lines];
    if (!lines.includes("a=end-of-candidates")) {
      lines.push(...candidateLines, "a=end-of-candidates");
    }
    return lines;
  });

  return [sessionSection.trimEnd(), ...rebuiltSections.map((section) => section.join("\r\n"))]
    .filter(Boolean)
    .join("\r\n")
    .concat("\r\n");
}

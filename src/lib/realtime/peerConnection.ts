function extractCandidateType(candidateLine: string) {
  return candidateLine.match(/\btyp\s+([a-z]+)/i)?.[1] ?? "unknown";
}

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

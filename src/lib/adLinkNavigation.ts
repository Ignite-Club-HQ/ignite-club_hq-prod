import type { NavigateFunction } from "react-router-dom";
import { safeOpenUrl } from "@/lib/safeOpenUrl";

interface AdLinkScope {
  clubId?: string | null;
  teamId?: string | null;
}

function replaceScopeTokens(path: string, scope: AdLinkScope): string | null {
  let resolved = path;

  if (resolved.includes(":clubId")) {
    if (!scope.clubId) return null;
    resolved = resolved.replaceAll(":clubId", scope.clubId);
  }

  if (resolved.includes(":teamId")) {
    if (!scope.teamId) return null;
    resolved = resolved.replaceAll(":teamId", scope.teamId);
  }

  return resolved;
}

export function resolveInternalAdLink(linkUrl: string | null | undefined, scope: AdLinkScope = {}): string | null {
  if (!linkUrl) return null;
  const trimmed = linkUrl.trim();
  if (!trimmed || trimmed.startsWith("//")) return null;

  if (trimmed.startsWith("/")) {
    return replaceScopeTokens(trimmed, scope);
  }

  try {
    const url = new URL(trimmed);
    if (url.origin !== window.location.origin) return null;
    return replaceScopeTokens(`${url.pathname}${url.search}${url.hash}`, scope);
  } catch {
    return null;
  }
}

export function openAdLink(linkUrl: string | null | undefined, navigate: NavigateFunction, scope: AdLinkScope = {}) {
  if (!linkUrl) return;
  const internalPath = resolveInternalAdLink(linkUrl, scope);
  if (internalPath) {
    navigate(internalPath);
    return;
  }
  safeOpenUrl(linkUrl);
}
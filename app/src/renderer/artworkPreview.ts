export type ArtworkPreview = { identity: string; url?: string; error?: string };

export function artworkPreviewIdentity(workspace: string | undefined, id: string | undefined, path: string | undefined, full: boolean) {
  const source = id ? `artifact:${id}` : path ? `path:${path}` : 'empty';
  return `${workspace || 'unscoped'}|${full ? 'full' : 'thumbnail'}|${source}`;
}

export function artworkPreviewForIdentity(preview: ArtworkPreview, identity: string): ArtworkPreview {
  return preview.identity === identity ? preview : { identity };
}

export function artworkPreviewAfterLoad(
  current: ArtworkPreview,
  identity: string,
  result: { url: string } | { error: string }
): ArtworkPreview {
  if (current.identity !== identity) return current;
  if ('url' in result) return { identity, url: result.url };
  // Keep a successfully rendered image when a background refresh fails.
  return current.url ? current : { identity, error: result.error };
}

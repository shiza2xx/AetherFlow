export type TextureMarkPreparation = {
  active: boolean;
  requested: boolean;
  identity: string | null;
  signature: string | null;
};

/** Stable identity for deciding whether an already active paint session can survive a target refresh. */
export function textureMarkBindingIdentity(preview: {
  id?: unknown;
  data?: { hash?: unknown; sourceInputHash?: unknown };
}, targets: readonly any[]): { identity: string; signature: string } {
  const identity = JSON.stringify([
    String(preview.id || ''),
    String(preview.data?.hash || ''),
    String(preview.data?.sourceInputHash || ''),
  ]);
  const signature = JSON.stringify(targets.map(target => ({
    key: String(target.key || ''),
    imageName: String(target.imageName || ''),
    width: Number(target.width),
    height: Number(target.height),
    imageHash: String(target.originalImageHash || ''),
    decodedPixelHash: String(target.decodedPixelHash || ''),
    bindings: (Array.isArray(target.bindings) ? target.bindings : []).map((binding: any) => [
      String(binding.meshName || ''), String(binding.materialName || ''), Number(binding.materialSlot),
      String(binding.imageNodeName || ''), Number(binding.uvIndex || 0),
      String(binding.uvDigest || ''), String(binding.displayUvSignature || ''),
    ]),
  })));
  return { identity, signature };
}

/** Keep an explicit paint session only while the exact verified viewer and binding set remain compatible. */
export function resolveTextureMarkPreparation(
  prior: TextureMarkPreparation,
  next: { identity: string; signature: string },
  verifiedTargetCount: number,
): TextureMarkPreparation {
  const compatible = prior.identity === next.identity && prior.signature === next.signature;
  const requestMatchesViewer = prior.identity === null || prior.identity === next.identity;
  const active = verifiedTargetCount > 0 && ((prior.requested && requestMatchesViewer) || (prior.active && compatible));
  return {
    active,
    requested: false,
    identity: verifiedTargetCount > 0 ? next.identity : null,
    signature: verifiedTargetCount > 0 ? next.signature : null,
  };
}

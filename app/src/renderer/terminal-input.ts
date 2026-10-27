/** Remove exact terminal-probe replies that Codex can misread as composer text. */
const terminalProbeReplies = [
  /\u001b\[\?[0-9]+(?:;[0-9]+)*c/g,
  /\u001b\[>[0-9]+(?:;[0-9]+)*c/g,
  /\u001b\]10;rgb:[0-9a-f]{1,4}\/[0-9a-f]{1,4}\/[0-9a-f]{1,4}(?:\u0007|\u001b\\)/gi,
  /\u001b\]11;rgb:[0-9a-f]{1,4}\/[0-9a-f]{1,4}\/[0-9a-f]{1,4}(?:\u0007|\u001b\\)/gi,
];

export function removeTerminalProbeReplies(data: string): string {
  return terminalProbeReplies.reduce((remaining, pattern) => remaining.replace(pattern, ''), data);
}

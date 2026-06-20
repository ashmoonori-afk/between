export function buildFindingModel(input) {
  const hunks = parseDiffHunks(input.trackedDiff ?? '')
  return {
    findings: input.findings.map((finding) => linkFinding(finding, input.diffHash, hunks)),
  }
}

export function parseDiffHunks(diff) {
  const hunks = []
  let file = ''
  let current = null
  for (const line of diff.split(/\r?\n/)) {
    const fileMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
    if (fileMatch) {
      file = fileMatch[2] ?? fileMatch[1] ?? ''
      current = null
      continue
    }
    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunkMatch) {
      const start = Number(hunkMatch[1])
      const count = Number(hunkMatch[2] ?? '1')
      current = {
        file,
        newStart: start,
        newEnd: Math.max(start, start + count - 1),
      }
      hunks.push(current)
      continue
    }
  }
  return hunks
}

function linkFinding(finding, diffHash, hunks) {
  const location = parseFindingLocation(finding.summary)
  const stale = diffHash !== null && finding.target_hash !== diffHash
  const hunkIndex =
    location && !stale
      ? hunks.findIndex(
          (hunk) =>
            hunk.file === location.file &&
            location.line >= hunk.newStart &&
            location.line <= hunk.newEnd,
        )
      : -1
  return {
    finding,
    location,
    stale,
    linked: hunkIndex >= 0,
    hunkIndex: hunkIndex >= 0 ? hunkIndex : null,
  }
}

function parseFindingLocation(summary) {
  const match = /^\[?([^:\]\s]+):(\d+)\]?/.exec(String(summary).trim())
  if (!match) return null
  return { file: match[1], line: Number(match[2]) }
}

import { escapeHtml } from './ide-panel-util.js'

export function topologyCard(profile) {
  return `<section class="topology lane">
    <div class="section-title"><span>IDE topology</span><strong>${escapeHtml(profile.rulesLabel)}</strong></div>
    <form id="topology-form" class="topology-form">
      <label><span>Builder agents</span><input id="builder-count" type="number" min="1" max="16" value="${profile.builderAgentCount}"></label>
      <label><span>Reviewer agents</span><input id="reviewer-count" type="number" min="1" max="16" value="${profile.reviewerAgentCount}"></label>
      <label><span>Permission mode</span><select id="permission-mode">${option('read_only', 'Read only', profile.permissionMode)}${option('guard', 'Guard', profile.permissionMode)}${option('full_access', 'Full access', profile.permissionMode)}</select></label>
      <label><span>Follow-up mode</span><select id="followup-mode">${option('steer', 'Steer', profile.followupMode)}${option('queue', 'Queue', profile.followupMode)}</select></label>
      <label><span>Working folder</span><input id="working-folder" type="text" value="${escapeHtml(profile.workingFolder)}"></label>
      <button type="submit">Apply</button>
    </form>
    <p class="policy">Broker policy enforced</p>
    <div class="targets">${profile.panes.map((pane) => `<code>${escapeHtml(pane.target)}</code>`).join('')}</div>
  </section>`
}

export function buildIdeProfileModel(profile) {
  const source = profile ?? {}
  const builderAgentCount = Number(source.builderAgentCount ?? 1)
  const reviewerAgentCount = Number(source.reviewerAgentCount ?? 1)
  const rulesMode = source.rulesMode === 'inherit_global' ? 'inherit_global' : 'project_only'
  const permissionMode =
    source.permissionMode === 'read_only' || source.permissionMode === 'full_access'
      ? source.permissionMode
      : 'guard'
  const followupMode = source.followupMode === 'queue' ? 'queue' : 'steer'
  const workingFolder = textField(source.workingFolder, '.')
  return {
    builderAgentCount,
    reviewerAgentCount,
    rulesMode,
    permissionMode,
    workingFolder,
    followupMode,
    rulesLabel: rulesMode === 'project_only' ? 'Global rules bypassed' : 'Global rules inherited',
    panes: Array.isArray(source.panes)
      ? source.panes
      : [
          ...buildPanes('builder', builderAgentCount),
          ...buildPanes('reviewer', reviewerAgentCount),
        ],
  }
}

function option(value, label, selectedValue) {
  const selected = value === selectedValue ? ' selected' : ''
  return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`
}

function textField(value, fallback) {
  const text = String(value ?? '').trim()
  return text || fallback
}

function buildPanes(role, count) {
  return Array.from({ length: count }, (_unused, index) => {
    const n = index + 1
    const label = `${role === 'builder' ? 'Builder' : 'Reviewer'} ${n}`
    return { id: `${role}-${n}`, label, role, target: `${role}:${n}` }
  })
}

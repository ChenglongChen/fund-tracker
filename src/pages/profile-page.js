/**
 * 我的 — 设置与主题切换。
 */
import { escapeHtml } from '../format.js';
import { app } from '../app/context.js';
import { renderShell } from '../components/shell.js';
import { renderBottomChrome, showIndexTicker } from '../components/index-dock.js';
import { renderThemeToggle } from '../components/theme-chrome.js';
import { themeToggleLabel } from '../theme.js';
import { API_MODE_LOCAL, API_MODE_REMOTE, readApiSettings } from '../api-settings.js';

function settingsRow(label, hint, actionHtml) {
  return `
    <div class="profile-settings-row">
      <div class="profile-settings-text">
        <p class="profile-settings-label">${escapeHtml(label)}</p>
        ${hint ? `<p class="profile-settings-hint">${escapeHtml(hint)}</p>` : ''}
      </div>
      <div class="profile-settings-action">${actionHtml}</div>
    </div>`;
}

function renderApiSettingsCard() {
  const { mode, baseUrl, token } = readApiSettings();
  const isDesktop = typeof window !== 'undefined' && window.fundTrackerDesktop?.isDesktop;
  const modeHint =
    mode === API_MODE_REMOTE
      ? '连接 Remote API（与 iPhone / 小程序同源）'
      : isDesktop
        ? 'Mac 内嵌本地 server（Application Support/data）'
        : '同源或 Vite dev proxy';

  return `
        <div class="profile-card">
          <h2 class="profile-card-title">API 连接</h2>
          ${settingsRow(
            '数据源',
            modeHint,
            `<select class="profile-field-input" id="profile-api-mode" aria-label="API 模式">
              <option value="${API_MODE_LOCAL}"${mode === API_MODE_LOCAL ? ' selected' : ''}>本地</option>
              <option value="${API_MODE_REMOTE}"${mode === API_MODE_REMOTE ? ' selected' : ''}>远程</option>
            </select>`,
          )}
          ${settingsRow(
            'Remote API 地址',
            '例：https://api.example.com（不含 /api 后缀）',
            `<input class="profile-field-input" id="profile-api-base" type="url" inputmode="url" autocomplete="off" placeholder="https://api.example.com" value="${escapeHtml(baseUrl)}" />`,
          )}
          ${settingsRow(
            'API Token',
            '与服务器 FUND_TRACKER_API_TOKEN 一致',
            `<input class="profile-field-input" id="profile-api-token" type="password" autocomplete="off" placeholder="Bearer token" value="${escapeHtml(token)}" />`,
          )}
          <div class="profile-settings-actions">
            <button type="button" class="btn-secondary" id="btn-profile-api-save">保存 API 设置</button>
            <button type="button" class="btn-ghost" id="btn-profile-export-portfolio">导出 portfolio.json</button>
            <button type="button" class="btn-ghost" id="btn-profile-pull-portfolio">从 Remote 拉取</button>
          </div>
          <p class="profile-settings-hint profile-settings-hint--block" id="profile-api-status" hidden></p>
        </div>`;
}

export function renderProfilePage() {
  const dockClass = showIndexTicker() ? ' has-index-dock' : '';
  const themeLabel = themeToggleLabel();
  const hideAssets = app().state.hideAssets;

  return renderShell(
    `
    <section class="profile-page has-bottom-nav${dockClass}">
      <header class="profile-page-head">
        <h1 class="profile-page-title">我的</h1>
      </header>
      <div class="holding-list-scroll tab-scroll profile-page-scroll" id="profile-scroll">
        <div class="profile-card">
          <h2 class="profile-card-title">显示</h2>
          ${settingsRow('深色 / 浅色模式', `当前：${themeLabel}模式`, renderThemeToggle())}
          ${settingsRow(
            '隐藏资产金额',
            hideAssets ? '已开启，点击页面金额可临时显示' : '已关闭',
            `<button type="button" class="profile-switch${hideAssets ? ' is-on' : ''}" id="btn-profile-privacy" aria-pressed="${hideAssets ? 'true' : 'false'}"><span class="profile-switch-knob"></span></button>`,
          )}
        </div>
        ${renderApiSettingsCard()}
        <div class="profile-card">
          <h2 class="profile-card-title">持仓管理</h2>
          <button type="button" class="profile-link-row" id="btn-profile-manage">
            <span>列表配置 / 添加基金</span>
            <span class="profile-link-chevron" aria-hidden="true">›</span>
          </button>
          <button type="button" class="profile-link-row" id="btn-profile-manage-headers">
            <span>表头与列显示</span>
            <span class="profile-link-chevron" aria-hidden="true">›</span>
          </button>
        </div>
        <div class="profile-card profile-card--flat">
          <p class="profile-about">fund-tracker · 多账户基金看板</p>
        </div>
      </div>
      ${renderBottomChrome()}
    </section>`,
  );
}

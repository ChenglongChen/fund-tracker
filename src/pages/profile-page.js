/**
 * 我的 — 设置与主题切换。
 */
import { escapeHtml } from '../format.js';
import { app } from '../app/context.js';
import { renderShell } from '../components/shell.js';
import { renderBottomChrome } from '../components/index-dock.js';
import { renderThemeToggle } from '../components/theme-chrome.js';
import { themeToggleLabel } from '../theme.js';
import { API_MODE_LOCAL, API_MODE_REMOTE, readApiSettings } from '../api-settings.js';

function settingsRow(label, hint, actionHtml, { field = false } = {}) {
  return `
    <div class="profile-settings-row${field ? ' profile-settings-row--field' : ''}">
      <div class="profile-settings-text">
        <p class="profile-settings-label">${escapeHtml(label)}</p>
        ${hint ? `<p class="profile-settings-hint">${escapeHtml(hint)}</p>` : ''}
      </div>
      <div class="profile-settings-action">${actionHtml}</div>
    </div>`;
}

function renderDesktopLanCard() {
  const isDesktop = typeof window !== 'undefined' && window.fundTrackerDesktop?.isDesktop;
  const { mode } = readApiSettings();
  if (!isDesktop || mode !== API_MODE_LOCAL) return '';

  return `
        <div class="profile-card">
          <div class="profile-card-head">
            <h2 class="profile-card-title">iPhone 同 WiFi 访问</h2>
          </div>
          <div class="profile-card-body profile-card-body--pad">
            <p class="profile-settings-hint profile-settings-hint--lead">Mac App 运行中且与 iPhone 同一 WiFi 时，Safari 打开：</p>
            <p class="profile-lan-url" id="profile-lan-url">正在检测局域网地址…</p>
            <div class="profile-settings-actions profile-settings-actions--inline">
              <button type="button" class="btn-ghost" id="btn-profile-open-data-dir">打开数据目录</button>
            </div>
            <p class="profile-settings-hint profile-settings-hint--foot">若无法访问，请在 Mac「系统设置 → 网络 → 防火墙」允许传入连接。</p>
          </div>
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
          <div class="profile-card-head">
            <h2 class="profile-card-title">API 连接</h2>
          </div>
          <div class="profile-card-body">
            ${settingsRow(
              '数据源',
              modeHint,
              `<select class="profile-field-input" id="profile-api-mode" aria-label="API 模式">
                <option value="${API_MODE_LOCAL}"${mode === API_MODE_LOCAL ? ' selected' : ''}>本地</option>
                <option value="${API_MODE_REMOTE}"${mode === API_MODE_REMOTE ? ' selected' : ''}>远程</option>
              </select>`,
              { field: true },
            )}
            ${settingsRow(
              'Remote API 地址',
              '例：https://api.example.com（不含 /api 后缀）',
              `<input class="profile-field-input" id="profile-api-base" type="url" inputmode="url" autocomplete="off" placeholder="https://api.example.com" value="${escapeHtml(baseUrl)}" />`,
              { field: true },
            )}
            ${settingsRow(
              'API Token',
              '与服务器 FUND_TRACKER_API_TOKEN 一致',
              `<input class="profile-field-input" id="profile-api-token" type="password" autocomplete="off" placeholder="Bearer token" value="${escapeHtml(token)}" />`,
              { field: true },
            )}
            <div class="profile-settings-actions">
              <button type="button" class="btn-secondary" id="btn-profile-api-save">保存 API 设置</button>
              <button type="button" class="btn-ghost" id="btn-profile-export-portfolio">导出 portfolio.json</button>
              <button type="button" class="btn-ghost" id="btn-profile-pull-portfolio">从 Remote 拉取</button>
            </div>
            <p class="profile-settings-hint profile-settings-hint--foot" id="profile-api-status" hidden></p>
          </div>
        </div>`;
}

export function renderProfilePage() {
  const themeLabel = themeToggleLabel();
  const hideAssets = app().state.hideAssets;

  return renderShell(
    `
    <section class="portfolio-page profile-page has-bottom-nav">
      <div class="portfolio-sticky profile-page-sticky">
        <header class="profile-page-head">
          <h1 class="profile-page-title">我的</h1>
        </header>
      </div>
      <div class="holding-list-scroll tab-scroll profile-page-scroll" id="profile-scroll">
        <div class="profile-page-content">
          <div class="profile-card">
            <div class="profile-card-head">
              <h2 class="profile-card-title">显示</h2>
            </div>
            <div class="profile-card-body">
              ${settingsRow('深色 / 浅色模式', `当前：${themeLabel}模式`, renderThemeToggle())}
              ${settingsRow(
                '隐藏资产金额',
                hideAssets ? '已开启，点击页面金额可临时显示' : '已关闭',
                `<button type="button" class="profile-switch${hideAssets ? ' is-on' : ''}" id="btn-profile-privacy" aria-pressed="${hideAssets ? 'true' : 'false'}"><span class="profile-switch-knob"></span></button>`,
              )}
            </div>
          </div>
          ${renderApiSettingsCard()}
          ${renderDesktopLanCard()}
          <div class="profile-card">
            <div class="profile-card-head">
              <h2 class="profile-card-title">持仓管理</h2>
            </div>
            <div class="profile-card-body profile-card-body--links">
              <button type="button" class="profile-link-row" id="btn-profile-manage">
                <span>列表配置 / 添加基金</span>
                <span class="profile-link-chevron" aria-hidden="true">›</span>
              </button>
              <button type="button" class="profile-link-row" id="btn-profile-manage-headers">
                <span>表头与列显示</span>
                <span class="profile-link-chevron" aria-hidden="true">›</span>
              </button>
            </div>
          </div>
          <p class="profile-about">fund-tracker · 多账户基金看板</p>
        </div>
      </div>
      ${renderBottomChrome()}
    </section>`,
  );
}

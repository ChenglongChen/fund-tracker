/**
 * 我的 — 设置与主题切换。
 */
import { escapeHtml } from '../format.js';
import { app } from '../app/context.js';
import { renderShell } from '../components/shell.js';
import { renderBottomChrome, showIndexTicker } from '../components/index-dock.js';
import { renderThemeToggle } from '../components/theme-chrome.js';
import { themeToggleLabel } from '../theme.js';

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
      <div class="holding-list-scroll page-scroll profile-page-scroll" id="profile-scroll">
        <div class="profile-card">
          <h2 class="profile-card-title">显示</h2>
          ${settingsRow('深色 / 浅色模式', `当前：${themeLabel}模式`, renderThemeToggle())}
          ${settingsRow(
            '隐藏资产金额',
            hideAssets ? '已开启，点击页面金额可临时显示' : '已关闭',
            `<button type="button" class="profile-switch${hideAssets ? ' is-on' : ''}" id="btn-profile-privacy" aria-pressed="${hideAssets ? 'true' : 'false'}"><span class="profile-switch-knob"></span></button>`,
          )}
        </div>
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

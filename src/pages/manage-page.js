import { isEditableScope } from '../accounts.js';
import { metricColumnDef } from '../column-layout.js';
import { escapeHtml } from '../format.js';
import { app } from '../app/context.js';
import { renderShell, renderLoading, renderSubpageNav } from '../components/shell.js';

export function defaultConfigDraft() {
  return { code: '', name: '', amount: '', totalProfit: '', yesterdayProfit: '' };
}

export function renderManageTabs(active) {
  return `
    <div class="manage-tabs" role="tablist">
      <button type="button" class="manage-tab ${active === 'holdings' ? 'is-active' : ''}" data-manage-tab="holdings" role="tab" id="manage-tab-holdings" aria-selected="${active === 'holdings' ? 'true' : 'false'}" aria-controls="manage-panel">持有管理</button>
      <button type="button" class="manage-tab ${active === 'headers' ? 'is-active' : ''}" data-manage-tab="headers" role="tab" id="manage-tab-headers" aria-selected="${active === 'headers' ? 'true' : 'false'}" aria-controls="manage-panel">表头设置</button>
    </div>`;
}

export function renderManageHoldingsTab() {
  const accountFunds = app().getFunds().filter((f) => f.accountId === app().state.activeScope);
  const order = app().state.manageFundOrderDraft.length
    ? app().state.manageFundOrderDraft
    : accountFunds.map((f) => f.id);
  const byId = new Map(accountFunds.map((f) => [f.id, f]));
  const items = order
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((f, idx) => {
      const checked = app().state.manageSelected.includes(f.id);
      return `
      <li class="manage-fund-item" data-fund-id="${f.id}">
        <label class="manage-check">
          <input type="checkbox" class="manage-fund-check" data-fund-id="${f.id}" ${checked ? 'checked' : ''} />
          <span class="manage-check-ui"></span>
        </label>
        <div class="manage-fund-main">
          <p class="manage-fund-name">${escapeHtml(f.name)}</p>
          <p class="manage-fund-code">${escapeHtml(f.code)}</p>
        </div>
        <div class="manage-fund-actions">
          <button type="button" class="manage-icon-btn" data-fund-pin="${f.id}" title="置顶" aria-label="置顶">↑</button>
          <button type="button" class="manage-icon-btn" data-fund-up="${f.id}" ${idx === 0 ? 'disabled' : ''} aria-label="上移">≡</button>
        </div>
      </li>`;
    })
    .join('');

  const allSelected = order.length > 0 && app().state.manageSelected.length === order.length;

  return `
    <div class="manage-toolbar">
      <label class="manage-select-all">
        <input type="checkbox" id="manage-select-all" ${allSelected ? 'checked' : ''} />
        <span>全选</span>
      </label>
      <span class="manage-toolbar-hint">置顶 · 排序</span>
    </div>
    <ul class="manage-fund-list">${items}</ul>
    <footer class="manage-footer">
      <button type="button" class="manage-footer-btn" id="btn-manage-delete" ${app().state.manageSelected.length ? '' : 'disabled'}>删除</button>
      <button type="button" class="manage-footer-btn manage-footer-btn--primary" id="btn-manage-done">完成</button>
    </footer>`;
}

export function renderManageHeadersTab() {
  const amountOn = app().state.nameSubline === 'amount';
  const colRows = app().state.metricColumnOrder
    .map((key, idx) => {
      const col = metricColumnDef(key);
      const visible = app().state.metricColumnVisible[key] !== false;
      return `
      <li class="manage-header-item" data-col-key="${key}">
        <span class="manage-header-name">${escapeHtml(col.title)}</span>
        <button type="button" class="manage-icon-btn ${visible ? 'is-on' : ''}" data-col-visible="${key}" title="显示" aria-label="${visible ? '隐藏列' : '显示列'}">${visible ? '<svg class="manage-eye-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>' : '—'}</button>
        <button type="button" class="manage-icon-btn" data-col-pin="${key}" ${idx === 0 ? 'disabled' : ''} aria-label="置顶">↑</button>
        <button type="button" class="manage-icon-btn" data-col-up="${key}" ${idx === 0 ? 'disabled' : ''} aria-label="上移">≡</button>
      </li>`;
    })
    .join('');

  return `
    <div class="manage-prefs">
      <label class="manage-switch-row">
        <span>显示 基金名称 + 持有金额</span>
        <input type="radio" name="name-subline" value="amount" ${amountOn ? 'checked' : ''} />
      </label>
    </div>
    <div class="manage-header-table-head">
      <span>表头名称</span><span>显示</span><span>置顶</span><span>排序</span>
    </div>
    <ul class="manage-header-list">${colRows}</ul>
    <footer class="manage-footer manage-footer--single">
      <button type="button" class="manage-footer-btn manage-footer-btn--primary" id="btn-manage-done">完成</button>
    </footer>`;
}

export function renderManageAddPage() {
  const draft = app().state.configDraft ?? defaultConfigDraft();
  return renderShell(
    `
    <section class="subpage manage-page">
      ${renderSubpageNav('添加基金')}
      <div class="subpage-body">
        ${app().state.manageError ? `<p class="sheet-error">${escapeHtml(app().state.manageError)}</p>` : ''}
        <div class="form-grid form-grid--page">
          <label class="form-field form-field--full">
            <span class="form-label">基金代码</span>
            <input class="form-input" id="add-fund-code" inputmode="numeric" maxlength="6" placeholder="6位，如 022184" value="${escapeHtml(draft.code)}" />
          </label>
          <label class="form-field form-field--full">
            <span class="form-label">名称（可选）</span>
            <input class="form-input" id="add-fund-name" placeholder="留空自动识别" value="${escapeHtml(draft.name)}" />
          </label>
          <label class="form-field">
            <span class="form-label">持仓金额</span>
            <input class="form-input" id="add-fund-amount" inputmode="decimal" value="${escapeHtml(draft.amount)}" />
          </label>
          <label class="form-field">
            <span class="form-label">持有收益</span>
            <input class="form-input" id="add-fund-total-profit" inputmode="decimal" value="${escapeHtml(draft.totalProfit)}" />
          </label>
          <label class="form-field form-field--full">
            <span class="form-label">当日收益（可选）</span>
            <input class="form-input" id="add-fund-daily-profit" inputmode="decimal" value="${escapeHtml(draft.yesterdayProfit)}" />
          </label>
        </div>
        <div class="fund-edit-page-actions">
          <button type="button" class="sheet-btn sheet-btn--primary" id="btn-add-fund-submit"${app().state.formBusy ? ' disabled' : ''}>${app().state.formBusy ? '提交中…' : '确认添加'}</button>
        </div>
      </div>
    </section>`,
  );
}

export function renderManagePage() {
  const tab = app().state.manageTab === 'headers' ? 'headers' : 'holdings';
  const body = tab === 'headers' ? renderManageHeadersTab() : renderManageHoldingsTab();
  const accountName = app().accountById(app().state.activeScope)?.name ?? '账户';

  return renderShell(
    `
    <section class="subpage manage-page">
      ${renderSubpageNav(`${accountName} · 持有配置`, {
        rightHtml: `<button type="button" class="subpage-nav-link" id="btn-manage-add">添加基金</button>`,
      })}
      ${renderManageTabs(tab)}
      <div class="manage-body" id="manage-panel" role="tabpanel" aria-labelledby="manage-tab-${tab}">
        ${app().state.manageError ? `<p class="sheet-error">${escapeHtml(app().state.manageError)}</p>` : ''}
        ${body}
      </div>
    </section>`,
  );
}

export function renderFundEditPage() {
  const fund = app().fundById(app().state.detailId);
  if (!fund) return renderLoading();

  return renderShell(
    `
    <section class="subpage fund-edit-page">
      ${renderSubpageNav('编辑持仓')}
      <div class="subpage-body">
        ${app().state.fundEditError ? `<p class="sheet-error">${escapeHtml(app().state.fundEditError)}</p>` : ''}
        <p class="fund-edit-hint">${escapeHtml(fund.name)} · ${escapeHtml(fund.code)}</p>
        <div class="form-grid form-grid--page">
          <label class="form-field form-field--full">
            <span class="form-label">基金名称</span>
            <input class="form-input" id="edit-fund-name" value="${escapeHtml(fund.name)}" />
          </label>
          <label class="form-field">
            <span class="form-label">持仓金额</span>
            <input class="form-input" id="edit-fund-amount" inputmode="decimal" value="${fund.amount}" />
          </label>
          <label class="form-field">
            <span class="form-label">持有收益</span>
            <input class="form-input" id="edit-fund-total-profit" inputmode="decimal" value="${fund.totalProfit}" />
          </label>
          <label class="form-field form-field--full">
            <span class="form-label">当日收益</span>
            <input class="form-input" id="edit-fund-daily-profit" inputmode="decimal" value="${fund.yesterdayProfit ?? 0}" />
          </label>
        </div>
        <div class="fund-edit-page-actions">
          <button type="button" class="sheet-btn sheet-btn--primary" id="btn-save-fund"${app().state.formBusy ? ' disabled' : ''}>${app().state.formBusy ? '保存中…' : '保存'}</button>
          <button type="button" class="sheet-btn sheet-btn--danger" id="btn-delete-fund"${app().state.formBusy ? ' disabled' : ''}>删除基金</button>
        </div>
      </div>
    </section>`,
  );
}

export function patchManageSelection() {
  const order = app().state.manageFundOrderDraft.length
    ? app().state.manageFundOrderDraft
    : app().getFunds().filter((f) => f.accountId === app().state.activeScope).map((f) => f.id);
  const allSelected = order.length > 0 && app().state.manageSelected.length === order.length;
  const selectAll = document.getElementById('manage-select-all');
  if (selectAll) selectAll.checked = allSelected;
  const deleteBtn = document.getElementById('btn-manage-delete');
  if (deleteBtn) deleteBtn.disabled = app().state.manageSelected.length === 0;
  document.querySelectorAll('.manage-fund-check').forEach((input) => {
    const id = parseInt(input.getAttribute('data-fund-id') || '', 10);
    if (id) input.checked = app().state.manageSelected.includes(id);
  });
}

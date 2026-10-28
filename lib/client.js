window.__ModuleLoader__.load({
  id: '@qwqbig/dsh-archive-delete',
  factory: function(require) {
    var module = {exports: {}}; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  createArchiveApi: () => createArchiveApi,
  startClient: () => startClient
});
module.exports = __toCommonJS(client_exports);
var import_react2 = require("react");

// src/contracts.ts
var PACKAGE_NAME = "@qwqbig/dsh-archive-delete";
var API_PATH = "/api/dsh-archive-delete";
var ArchiveError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ArchiveError";
  }
};

// src/client-state.ts
var ClientTransportError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ClientTransportError";
  }
};
function selectableIds(state) {
  if (!state.overview) return [];
  return state.tab === "archived" ? state.overview.archived.filter((item) => !item.pending).map((item) => item.id) : state.overview.trash.map((item) => item.id);
}
function visibleSelection(state) {
  const visible = new Set(selectableIds(state));
  return state.selected.filter((id) => visible.has(id));
}
function canExecutePreview(preview, now = Date.now()) {
  return preview !== null && preview.expiresAt > now && preview.items.some((item) => item.disposition !== "blocked");
}
var ArchiveClientController = class {
  constructor(api, createId = () => globalThis.crypto.randomUUID(), now = () => Date.now()) {
    this.api = api;
    this.createId = createId;
    this.now = now;
  }
  state = {
    open: false,
    tab: "archived",
    overview: null,
    selected: [],
    loading: false,
    busy: false,
    preview: null,
    result: null,
    error: null,
    uncertainRequest: false
  };
  listeners = /* @__PURE__ */ new Set();
  loadGeneration = 0;
  previewGeneration = 0;
  openGeneration = 0;
  disposed = false;
  uncertainMutation = null;
  knownTitles = /* @__PURE__ */ new Map();
  getSnapshot = () => this.state;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  update(patch) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  async open(sessionId) {
    const generation = ++this.openGeneration;
    this.update({ open: true, tab: "archived", selected: [], preview: null, error: this.uncertainMutation ? this.state.error : null });
    await this.refresh();
    if (!sessionId || generation !== this.openGeneration || !this.state.open || this.state.busy || this.uncertainMutation || this.state.error || !this.state.overview?.support.supported) return;
    if (!selectableIds(this.state).includes(sessionId)) return;
    this.update({ selected: [sessionId] });
    await this.preview("trash", [sessionId]);
  }
  close = () => {
    this.openGeneration++;
    this.previewGeneration++;
    this.update({ open: false, preview: null, selected: [], loading: false });
  };
  setTab = (tab) => {
    if (this.state.busy || this.state.loading || this.state.tab === tab) return;
    this.previewGeneration++;
    this.update({ tab, selected: [], preview: null, error: null });
  };
  toggle = (id) => {
    if (this.state.busy || this.state.loading || this.uncertainMutation || !selectableIds(this.state).includes(id)) return;
    const selected = new Set(visibleSelection(this.state));
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    this.update({ selected: [...selected], preview: null });
  };
  selectAll = (selected) => {
    if (this.state.busy || this.state.loading || this.uncertainMutation) return;
    this.update({ selected: selected ? selectableIds(this.state) : [], preview: null });
  };
  async refresh() {
    const generation = ++this.loadGeneration;
    this.update({ loading: true });
    try {
      const received = await this.api.list();
      if (generation !== this.loadGeneration || this.disposed) return;
      for (const item of received.archived) this.knownTitles.set(item.id, item.title);
      for (const item of received.trash) {
        this.knownTitles.set(item.id, item.title);
        this.knownTitles.set(item.sessionId, item.title);
      }
      const overview = { ...received, recentResults: received.recentResults.map(this.withKnownTitles) };
      this.update({ overview, loading: false, error: this.uncertainMutation ? this.state.error : null });
      this.update({ selected: visibleSelection(this.state) });
      const recovered = this.uncertainMutation ? overview.recentResults.find((item) => item.operationId === this.uncertainMutation?.requestId) : void 0;
      if (recovered) {
        this.uncertainMutation = null;
        this.update({ result: recovered, preview: null, selected: [], error: null, uncertainRequest: false });
      }
    } catch (error) {
      if (generation !== this.loadGeneration || this.disposed) return;
      this.update({ loading: false, error: { ...this.error(error, false), code: "list-failed" } });
    }
  }
  async preview(action, ids = visibleSelection(this.state)) {
    if (this.state.busy || this.uncertainMutation || ids.length === 0) return;
    const generation = ++this.previewGeneration;
    this.update({ loading: true, error: null, preview: null });
    try {
      const preview = await this.api.preview(action, [...new Set(ids)]);
      if (generation !== this.previewGeneration || !this.state.open || this.disposed) return;
      for (const item of preview.items) if (item.title) this.knownTitles.set(item.id, item.title);
      this.update({ preview, loading: false });
    } catch (error) {
      if (generation !== this.previewGeneration || this.disposed) return;
      this.update({ loading: false, error: this.error(error, false) });
    }
  }
  dismissPreview = () => {
    if (this.state.busy || this.uncertainMutation) return;
    this.previewGeneration++;
    this.update({ preview: null, error: null });
  };
  async confirm() {
    if (this.state.busy || this.state.loading || this.uncertainMutation) return;
    const preview = this.state.preview;
    if (!canExecutePreview(preview, this.now())) {
      this.update({ error: { code: "preview-expired", message: "The preview has expired. Review the selection again.", uncertain: false } });
      return;
    }
    await this.perform({ kind: "execute", previewId: preview.id, requestId: this.createId() });
  }
  async cancelPending(ids) {
    if (this.state.busy || this.uncertainMutation || ids.length === 0) return;
    await this.perform({ kind: "cancel", ids: [...new Set(ids)], requestId: this.createId() });
  }
  async retryUncertain() {
    if (this.state.busy || !this.uncertainMutation) return;
    await this.perform(this.uncertainMutation);
  }
  async retryItem(id) {
    const result = this.state.result ?? this.state.overview?.recentResults[0];
    if (!result || !result.items.some((item) => item.id === id && item.status === "failed")) return;
    if (result.action === "cancel") await this.cancelPending([id]);
    else await this.preview(result.action, [id]);
  }
  async perform(mutation) {
    this.update({ busy: true, error: null });
    try {
      const result = mutation.kind === "execute" ? await this.api.execute(mutation.previewId, mutation.requestId) : await this.api.cancelPending(mutation.ids, mutation.requestId);
      this.uncertainMutation = null;
      this.update({ busy: false, preview: null, selected: [], result: this.withKnownTitles(result), error: null, uncertainRequest: false });
      await this.refresh();
    } catch (error) {
      const uncertain = error instanceof ClientTransportError;
      this.uncertainMutation = uncertain ? mutation : null;
      this.update({ busy: false, error: this.error(error, uncertain), uncertainRequest: uncertain });
    }
  }
  /** Retain readable titles only in this client's memory; durable receipts stay redacted. */
  withKnownTitles = (result) => ({
    ...result,
    items: result.items.map((item) => ({ ...item, title: item.title || this.knownTitles.get(item.id) || "" }))
  });
  error(error, uncertain) {
    if (error instanceof ArchiveError) return { code: error.code, message: error.message, uncertain };
    return {
      code: uncertain ? "outcome-unknown" : "request-failed",
      message: error instanceof Error ? error.message : String(error),
      uncertain
    };
  }
  dispose() {
    this.disposed = true;
    this.loadGeneration++;
    this.previewGeneration++;
    this.knownTitles.clear();
    this.listeners.clear();
  }
};

// src/client-ui.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var CLIENT_NAMESPACE = "qwqbig.archiveDelete";
var en = {
  title: "Archive cleanup",
  manage: "Manage archives and trash",
  menuTrash: "Move to trash",
  archived: "Archived",
  trash: "Trash",
  close: "Close",
  refresh: "Refresh",
  cancel: "Cancel",
  back: "Back",
  loading: "Loading\u2026",
  working: "Processing the selected records\u2026",
  intro: "Move archived conversations to a recoverable trash. Nothing expires automatically.",
  scope: "Session logs and their dedicated subagent logs are included. Shared attachments, spill files, project files and other plugins\u2019 caches are retained.",
  noArchives: "No archived conversations.",
  noTrash: "The trash is empty.",
  selectAll: "Select all available records ({n})",
  selected: "{n} selected",
  moveSelected: "Move selected to trash",
  restoreSelected: "Restore selected",
  purgeSelected: "Delete permanently",
  moveTitle: "Move these conversations to trash?",
  restoreTitle: "Restore these conversations?",
  purgeTitle: "Permanently delete these conversations?",
  moveDescription: "Review every target before confirming. Idle conversations still held by DSH can wait for the next start.",
  restoreDescription: "Restore the original logs in their archived state. A missing workspace becomes Ungrouped; existing paths will never be overwritten.",
  purgeDescription: "This removes the selected trash records and their session logs from this machine. It cannot be undone.",
  confirmTrash: "Confirm move to trash",
  confirmRestore: "Confirm restore",
  confirmPurge: "Confirm permanent deletion",
  previewExpired: "This preview expired. Go back and review your selection again.",
  previewEmpty: "No eligible records remain. Go back and refresh the list.",
  archivedHint: "Only archived conversations are eligible. Running work and uncertain relationships are protected.",
  trashHint: "Restored conversations stay archived. The trash is retained until you choose to clear it.",
  pending: "Waiting to move after restart",
  pendingHint: "The logs remain in their original location until DSH releases them. No disk space has been freed yet.",
  cancelPending: "Cancel pending move",
  pendingCancelled: "Pending move cancelled",
  childCount: "{n} dedicated subagent conversation(s)",
  memberCount: "{n} conversation(s)",
  ready: "Ready",
  blocked: "Skipped",
  pendingPreview: "Will wait for the next start",
  previewCount: "{n} selected target(s)",
  previewMembers: "{n} total conversation(s), including dedicated subagents",
  previewSize: "Session log size: {size}",
  expires: "Confirmation is valid until {time}.",
  result: "Latest operation",
  resultSummary: "{succeeded} succeeded \xB7 {pending} pending \xB7 {skipped} skipped \xB7 {failed} failed",
  retry: "Review and retry",
  retryRequest: "Retry the same request",
  unknown: "The request outcome is unknown. Refresh to check the host, or retry the same request without creating a second operation.",
  error: "The operation could not be completed.",
  unsupported: "Data operations are unavailable on this host.",
  supportDetails: "Host: {version} \xB7 {platform}",
  errorDetails: "Details",
  ungrouped: "Ungrouped",
  "status.moved": "Moved to trash",
  "status.pending": "Pending restart",
  "status.restored": "Restored",
  "status.purged": "Permanently deleted",
  "status.cancelled": "Cancelled",
  "status.skipped": "Skipped",
  "status.failed": "Failed",
  checking: "Checking the selected records\u2026",
  operationContinues: "Closing this window does not cancel an operation already sent to DSH.",
  listFailure: "Unable to read the current records. Refresh to try again."
};
var zh = {
  title: "\u5F52\u6863\u6E05\u7406",
  manage: "\u7BA1\u7406\u5F52\u6863\u4E0E\u56DE\u6536\u7AD9",
  menuTrash: "\u79FB\u5165\u56DE\u6536\u7AD9",
  archived: "\u5DF2\u5F52\u6863",
  trash: "\u56DE\u6536\u7AD9",
  close: "\u5173\u95ED",
  refresh: "\u5237\u65B0",
  cancel: "\u53D6\u6D88",
  back: "\u8FD4\u56DE",
  loading: "\u6B63\u5728\u8BFB\u53D6\u2026",
  working: "\u6B63\u5728\u5904\u7406\u9009\u4E2D\u7684\u8BB0\u5F55\u2026",
  intro: "\u5C06\u5DF2\u5F52\u6863\u4F1A\u8BDD\u79FB\u5165\u53EF\u6062\u590D\u7684\u56DE\u6536\u7AD9\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u8FC7\u671F\u6E05\u9664\u3002",
  scope: "\u5904\u7406\u8303\u56F4\u5305\u542B\u4F1A\u8BDD\u65E5\u5FD7\u53CA\u5176\u4E13\u5C5E\u5B50\u4EE3\u7406\u65E5\u5FD7\u3002\u5171\u4EAB\u9644\u4EF6\u3001spill \u6587\u4EF6\u3001\u9879\u76EE\u6587\u4EF6\u548C\u5176\u4ED6\u63D2\u4EF6\u7F13\u5B58\u4F1A\u4FDD\u7559\u3002",
  noArchives: "\u6CA1\u6709\u5DF2\u5F52\u6863\u4F1A\u8BDD\u3002",
  noTrash: "\u56DE\u6536\u7AD9\u4E3A\u7A7A\u3002",
  selectAll: "\u5168\u9009\u53EF\u64CD\u4F5C\u8BB0\u5F55\uFF08{n}\uFF09",
  selected: "\u5DF2\u9009\u62E9 {n} \u9879",
  moveSelected: "\u5C06\u6240\u9009\u79FB\u5165\u56DE\u6536\u7AD9",
  restoreSelected: "\u6062\u590D\u6240\u9009",
  purgeSelected: "\u6C38\u4E45\u6E05\u9664",
  moveTitle: "\u5C06\u8FD9\u4E9B\u4F1A\u8BDD\u79FB\u5165\u56DE\u6536\u7AD9\uFF1F",
  restoreTitle: "\u6062\u590D\u8FD9\u4E9B\u4F1A\u8BDD\uFF1F",
  purgeTitle: "\u6C38\u4E45\u6E05\u9664\u8FD9\u4E9B\u4F1A\u8BDD\uFF1F",
  moveDescription: "\u8BF7\u6838\u5BF9\u6BCF\u4E2A\u76EE\u6807\u3002\u95F2\u7F6E\u4F46\u4ECD\u88AB DSH \u5360\u7528\u7684\u4F1A\u8BDD\uFF0C\u53EF\u4EE5\u7B49\u5F85\u4E0B\u6B21\u542F\u52A8\u540E\u5904\u7406\u3002",
  restoreDescription: "\u6062\u590D\u539F\u59CB\u65E5\u5FD7\u5E76\u4FDD\u6301\u5DF2\u5F52\u6863\u72B6\u6001\u3002\u539F\u5DE5\u4F5C\u533A\u4E0D\u5B58\u5728\u65F6\u5F52\u5165\u201C\u672A\u5206\u7EC4\u201D\uFF0C\u4E0D\u4F1A\u8986\u76D6\u5DF2\u6709\u8DEF\u5F84\u3002",
  purgeDescription: "\u5C06\u4ECE\u672C\u673A\u79FB\u9664\u9009\u4E2D\u7684\u56DE\u6536\u7AD9\u8BB0\u5F55\u53CA\u5176\u4F1A\u8BDD\u65E5\u5FD7\uFF0C\u6B64\u64CD\u4F5C\u65E0\u6CD5\u64A4\u9500\u3002",
  confirmTrash: "\u786E\u8BA4\u79FB\u5165\u56DE\u6536\u7AD9",
  confirmRestore: "\u786E\u8BA4\u6062\u590D",
  confirmPurge: "\u786E\u8BA4\u6C38\u4E45\u6E05\u9664",
  previewExpired: "\u9884\u89C8\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u8FD4\u56DE\u5E76\u91CD\u65B0\u6838\u5BF9\u76EE\u6807\u3002",
  previewEmpty: "\u6CA1\u6709\u53EF\u64CD\u4F5C\u8BB0\u5F55\uFF0C\u8BF7\u8FD4\u56DE\u5E76\u5237\u65B0\u5217\u8868\u3002",
  archivedHint: "\u4EC5\u652F\u6301\u5DF2\u5F52\u6863\u4F1A\u8BDD\uFF1B\u6B63\u5728\u8FD0\u884C\u7684\u5DE5\u4F5C\u548C\u5173\u8054\u4E0D\u660E\u7684\u8BB0\u5F55\u4F1A\u53D7\u5230\u4FDD\u62A4\u3002",
  trashHint: "\u6062\u590D\u540E\u4F1A\u8BDD\u4ECD\u4E3A\u5DF2\u5F52\u6863\u72B6\u6001\u3002\u56DE\u6536\u7AD9\u5185\u5BB9\u4F1A\u4FDD\u7559\uFF0C\u76F4\u5230\u4F60\u4E3B\u52A8\u6E05\u9664\u3002",
  pending: "\u5F85\u91CD\u542F\u540E\u79FB\u5165\u56DE\u6536\u7AD9",
  pendingHint: "\u65E5\u5FD7\u4ECD\u5728\u539F\u4F4D\u7F6E\uFF0CDSH \u91CA\u653E\u5360\u7528\u540E\u624D\u4F1A\u79FB\u52A8\uFF0C\u76EE\u524D\u5C1A\u672A\u91CA\u653E\u78C1\u76D8\u7A7A\u95F4\u3002",
  cancelPending: "\u53D6\u6D88\u5F85\u5904\u7406",
  pendingCancelled: "\u5DF2\u53D6\u6D88\u5F85\u5904\u7406",
  childCount: "{n} \u4E2A\u4E13\u5C5E\u5B50\u4EE3\u7406\u4F1A\u8BDD",
  memberCount: "{n} \u4E2A\u4F1A\u8BDD",
  ready: "\u53EF\u6267\u884C",
  blocked: "\u8DF3\u8FC7",
  pendingPreview: "\u5C06\u7B49\u5F85\u4E0B\u6B21\u542F\u52A8",
  previewCount: "\u5DF2\u9009\u62E9 {n} \u4E2A\u76EE\u6807",
  previewMembers: "\u5408\u8BA1 {n} \u4E2A\u4F1A\u8BDD\uFF08\u5305\u542B\u4E13\u5C5E\u5B50\u4EE3\u7406\uFF09",
  previewSize: "\u4F1A\u8BDD\u65E5\u5FD7\u5927\u5C0F\uFF1A{size}",
  expires: "\u672C\u6B21\u786E\u8BA4\u5728 {time} \u524D\u6709\u6548\u3002",
  result: "\u6700\u8FD1\u64CD\u4F5C",
  resultSummary: "\u6210\u529F {succeeded} \xB7 \u5F85\u5904\u7406 {pending} \xB7 \u8DF3\u8FC7 {skipped} \xB7 \u5931\u8D25 {failed}",
  retry: "\u91CD\u65B0\u6838\u5BF9\u5E76\u91CD\u8BD5",
  retryRequest: "\u91CD\u8BD5\u540C\u4E00\u6B21\u8BF7\u6C42",
  unknown: "\u8BF7\u6C42\u7ED3\u679C\u672A\u77E5\u3002\u53EF\u4EE5\u5237\u65B0\u6838\u5BF9\u5BBF\u4E3B\u72B6\u6001\uFF0C\u6216\u91CD\u8BD5\u540C\u4E00\u6B21\u8BF7\u6C42\uFF0C\u4E0D\u4F1A\u521B\u5EFA\u7B2C\u4E8C\u6B21\u64CD\u4F5C\u3002",
  error: "\u64CD\u4F5C\u672A\u80FD\u5B8C\u6210\u3002",
  unsupported: "\u5F53\u524D\u5BBF\u4E3B\u6682\u4E0D\u652F\u6301\u6570\u636E\u64CD\u4F5C\u3002",
  supportDetails: "\u5BBF\u4E3B\uFF1A{version} \xB7 {platform}",
  errorDetails: "\u8BE6\u60C5",
  ungrouped: "\u672A\u5206\u7EC4",
  "status.moved": "\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9",
  "status.pending": "\u5F85\u91CD\u542F\u5904\u7406",
  "status.restored": "\u5DF2\u6062\u590D",
  "status.purged": "\u5DF2\u6C38\u4E45\u6E05\u9664",
  "status.cancelled": "\u5DF2\u53D6\u6D88",
  "status.skipped": "\u5DF2\u8DF3\u8FC7",
  "status.failed": "\u5931\u8D25",
  checking: "\u6B63\u5728\u6838\u5BF9\u6240\u9009\u8BB0\u5F55\u2026",
  operationContinues: "\u5173\u95ED\u6B64\u7A97\u53E3\u4E0D\u4F1A\u53D6\u6D88\u5DF2\u7ECF\u53D1\u9001\u7ED9 DSH \u7684\u64CD\u4F5C\u3002",
  listFailure: "\u65E0\u6CD5\u8BFB\u53D6\u5F53\u524D\u8BB0\u5F55\uFF0C\u8BF7\u5237\u65B0\u91CD\u8BD5\u3002"
};
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "\u2014";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
function formatTime(timestamp) {
  const language = typeof document === "undefined" ? "en" : document.documentElement.lang || "en";
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(language) : "\u2014";
}
function isoTime(timestamp) {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : void 0;
}
function ErrorNotice({ error, t, onRefresh, onRetry, disabled, Button }) {
  const message = error.uncertain ? t("unknown") : error.code === "preview-expired" ? t("previewExpired") : error.code === "list-failed" ? t("listFailure") : t("error");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dad-alert dad-error", role: "alert", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: message }),
    !error.uncertain && error.code !== "preview-expired" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: t("errorDetails") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: error.message }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: error.code })
    ] }),
    error.uncertain && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { size: "sm", variant: "outline", onClick: onRefresh, disabled, children: t("refresh") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { size: "sm", variant: "outline", onClick: onRetry, disabled, children: t("retryRequest") })
    ] })
  ] });
}
function PreviewContent({ preview, t }) {
  const members = preview.items.reduce((sum, item) => sum + item.memberIds.length, 0);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-preview", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-summary", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("previewCount", { n: preview.items.length }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("previewMembers", { n: members }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "dad-preview-list", children: preview.items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-row-title", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: item.title || item.sessionId }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `dad-pill dad-pill-${item.disposition}`, children: t(item.disposition === "ready" ? "ready" : item.disposition === "pending" ? "pendingPreview" : "blocked") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("memberCount", { n: item.memberIds.length }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatBytes(item.sizeBytes) })
      ] }),
      item.message && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dad-item-reason", children: item.message })
    ] }, item.id)) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dad-boundary", children: t("scope") }),
    preview.action === "trash" && preview.items.some((item) => item.disposition === "pending") && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dad-alert", children: t("pendingHint") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dad-muted", children: t("expires", { time: formatTime(preview.expiresAt) }) })
  ] });
}
function ResultContent({ result, t, retry, disabled, Button }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dad-results", "aria-label": t("result"), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: t("result") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: t("resultSummary", result.counts) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: result.items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: item.title || item.id }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `dad-result-status dad-result-${item.status}`, children: t(`status.${item.status}`) }),
        item.message && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: item.message })
      ] }),
      item.status === "failed" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { size: "sm", variant: "outline", disabled, onClick: () => retry(item.id), children: t("retry") })
    ] }, item.id)) })
  ] });
}
function ArchiveDialog({ controller, primitives, t }) {
  const state = (0, import_react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArchiveDialogView, { state, controller, primitives, t });
}
function ArchiveDialogView({ state, controller, primitives, t }) {
  const { Button, Checkbox, Modal } = primitives;
  const tabsId = (0, import_react.useId)();
  const tabRefs = (0, import_react.useRef)([]);
  const backAnchor = (0, import_react.useRef)(null);
  const selected = visibleSelection(state);
  const selectedSet = new Set(selected);
  const eligibleIds = selectableIds(state);
  const supported = state.overview?.support.supported === true;
  const uncertain = state.uncertainRequest;
  const locked = state.busy || state.loading || uncertain;
  const preview = state.preview;
  const previewId = preview?.id;
  const result = state.result ?? state.overview?.recentResults[0] ?? null;
  const actionTitle = { trash: "moveTitle", restore: "restoreTitle", purge: "purgeTitle" };
  const actionDescription = { trash: "moveDescription", restore: "restoreDescription", purge: "purgeDescription" };
  const actionConfirm = { trash: "confirmTrash", restore: "confirmRestore", purge: "confirmPurge" };
  (0, import_react.useEffect)(() => {
    if (!state.open) return;
    if (previewId) backAnchor.current?.querySelector("button")?.focus();
    else tabRefs.current[state.tab === "archived" ? 0 : 1]?.focus();
  }, [state.open, previewId, state.tab]);
  const changeTab = (tab, focus = false) => {
    controller.setTab(tab);
    if (focus) tabRefs.current[tab === "archived" ? 0 : 1]?.focus();
  };
  const footer = preview ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { ref: backAnchor, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "outline", disabled: state.busy || uncertain, onClick: controller.dismissPreview, "data-modal-autofocus": "", children: t("back") }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: preview.action === "purge" ? "outline" : "primary", className: preview.action === "purge" ? "dad-danger" : void 0, disabled: locked || !supported || !canExecutePreview(preview), onClick: () => {
      void controller.confirm();
    }, children: t(actionConfirm[preview.action]) })
  ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dad-selection", "aria-live": "polite", children: t("selected", { n: selected.length }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "outline", onClick: controller.close, children: t("close") }),
    state.tab === "archived" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "primary", disabled: locked || !supported || selected.length === 0, onClick: () => {
      void controller.preview("trash");
    }, children: t("moveSelected") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "outline", disabled: locked || !supported || selected.length === 0, onClick: () => {
        void controller.preview("restore");
      }, children: t("restoreSelected") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { variant: "outline", className: "dad-danger", disabled: locked || !supported || selected.length === 0, onClick: () => {
        void controller.preview("purge");
      }, children: t("purgeSelected") })
    ] })
  ] });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Modal, { open: state.open, onClose: controller.close, title: preview ? t(actionTitle[preview.action]) : t("title"), description: preview ? t(actionDescription[preview.action]) : t("intro"), closeLabel: t("close"), className: "dad-dialog", contentClassName: "dad-content", footer, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-shell", children: [
    state.error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ErrorNotice, { error: uncertain ? { ...state.error, uncertain: true } : state.error, t, onRefresh: () => {
      void controller.refresh();
    }, onRetry: () => {
      void controller.retryUncertain();
    }, disabled: state.busy || state.loading, Button }),
    state.overview && !supported && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dad-alert", role: "status", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("unsupported") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: state.overview.support.reason }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: t("supportDetails", { version: state.overview.support.version, platform: state.overview.support.platform }) })
    ] }),
    state.busy && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dad-progress", role: "status", children: t("working") }),
    preview ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PreviewContent, { preview, t }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-toolbar", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dad-tabs", role: "tablist", "aria-label": t("title"), onKeyDown: (event) => {
          if (locked) return;
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          changeTab(event.key === "Home" ? "archived" : event.key === "End" ? "trash" : state.tab === "archived" ? "trash" : "archived", true);
        }, children: ["archived", "trash"].map((tab, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { ref: (element) => {
          tabRefs.current[index] = element;
        }, type: "button", role: "tab", id: `${tabsId}-${tab}`, "aria-controls": `${tabsId}-panel`, "aria-selected": state.tab === tab, tabIndex: state.tab === tab ? 0 : -1, disabled: locked, "data-modal-autofocus": state.tab === tab ? "" : void 0, onClick: () => changeTab(tab), children: [
          t(tab),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dad-count", children: state.overview?.[tab].length ?? 0 })
        ] }, tab)) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { size: "sm", variant: "outline", disabled: state.loading || state.busy, onClick: () => {
          void controller.refresh();
        }, children: t("refresh") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dad-muted", children: t(state.tab === "archived" ? "archivedHint" : "trashHint") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checkbox, { checked: eligibleIds.length > 0 && selected.length === eligibleIds.length, disabled: locked || !supported || eligibleIds.length === 0, onChange: controller.selectAll, label: t("selectAll", { n: eligibleIds.length }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "tabpanel", id: `${tabsId}-panel`, "aria-labelledby": `${tabsId}-${state.tab}`, "aria-busy": state.loading, className: "dad-list", children: [
        state.loading && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: t("loading") }),
        !state.loading && state.overview && state.overview[state.tab].length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dad-empty", children: t(state.tab === "archived" ? "noArchives" : "noTrash") }),
        state.tab === "archived" ? state.overview?.archived.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-row-main", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checkbox, { checked: selectedSet.has(item.id), disabled: locked || !supported || item.pending === true, onChange: () => controller.toggle(item.id), label: item.title || item.id }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-meta", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item.workspace || t("ungrouped") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatBytes(item.sizeBytes) }),
              item.descendantCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("childCount", { n: item.descendantCount }) })
            ] }),
            item.pending && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dad-pending", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("pending") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("pendingHint") }),
              item.pendingReason && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item.pendingReason })
            ] })
          ] }),
          item.pending && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { size: "sm", variant: "outline", disabled: locked || !supported, onClick: () => {
            void controller.cancelPending([item.id]);
          }, children: t("cancelPending") })
        ] }, item.id)) : state.overview?.trash.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dad-row", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-row-main", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checkbox, { checked: selectedSet.has(item.id), disabled: locked || !supported, onChange: () => controller.toggle(item.id), label: item.title || item.sessionId }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-meta", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", { dateTime: isoTime(item.trashedAt), children: formatTime(item.trashedAt) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatBytes(item.sizeBytes) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("memberCount", { n: item.memberCount }) })
          ] })
        ] }) }, item.id))
      ] }),
      result && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ResultContent, { result, t, retry: (id) => {
        void controller.retryItem(id);
      }, disabled: locked || !supported, Button })
    ] }),
    (state.busy || uncertain) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dad-muted", children: t("operationContinues") })
  ] }) });
}
var CLIENT_CSS = `
.dad-dialog{width:min(880px,calc(100vw - 32px));max-width:calc(100vw - 32px)}
.dad-content{max-height:min(80vh,780px);overflow:auto}
.dad-shell{display:flex;flex-direction:column;gap:14px;min-width:0;color:var(--dsw-alias-label-primary,CanvasText)}
.dad-shell p,.dad-shell h3{margin:0}.dad-shell h3{font-size:13px;font-weight:600}
.dad-toolbar,.dad-actions,.dad-row-title,.dad-meta,.dad-summary{display:flex;align-items:center;gap:10px}
.dad-toolbar{justify-content:space-between}.dad-tabs{display:flex;gap:4px;padding:3px;border-radius:12px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08))}
.dad-tabs button{display:flex;align-items:center;gap:7px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,GrayText);padding:7px 11px;font:inherit;border-radius:9px;cursor:pointer}
.dad-tabs button[aria-selected=true]{color:var(--dsw-alias-label-primary,CanvasText);background:var(--dsw-alias-bg-base,Canvas);box-shadow:0 1px 3px #0001}
.dad-tabs button:focus-visible,.dad-actions button:focus-visible{outline:2px solid var(--dsw-alias-button-primary-bg,#2878e0);outline-offset:2px}
.dad-tabs button:disabled{cursor:default;opacity:.55}.dad-count{font-size:11px;opacity:.7}.dad-muted,.dad-meta{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,GrayText)}
.dad-meta{gap:5px 12px;flex-wrap:wrap;margin-top:4px}.dad-meta>span:first-child{overflow-wrap:anywhere}.dad-selection{margin-right:auto;font-size:12px;color:var(--dsw-alias-label-secondary,GrayText)}
.dad-list{min-height:80px;max-height:360px;overflow:auto;border-top:1px solid var(--dsw-alias-border-l1,#8883);border-bottom:1px solid var(--dsw-alias-border-l1,#8883)}
.dad-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:12px 2px;border-bottom:1px solid var(--dsw-alias-border-l1,#8882)}.dad-row:last-child{border-bottom:0}.dad-row-main{flex:1;min-width:0}.dad-row-main>label{min-width:0;align-items:flex-start}.dad-row-main>label>span{overflow-wrap:anywhere}
.dad-pending{display:flex;flex-direction:column;gap:3px;margin-top:7px!important;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,GrayText)}.dad-pending strong{color:var(--dsw-alias-label-primary,CanvasText)}
.dad-empty{padding:30px 12px;text-align:center;color:var(--dsw-alias-label-secondary,GrayText)}
.dad-alert{padding:11px 13px;border:1px solid var(--dsw-alias-border-l1,#8884);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#8881);font-size:12px;line-height:1.65}.dad-alert p+p{margin-top:5px}.dad-alert details{margin-top:5px}.dad-alert code{font-size:11px;overflow-wrap:anywhere}
.dad-error{border-color:var(--dsw-alias-status-error,#bd3d3d);color:var(--dsw-alias-label-primary,CanvasText)}.dad-actions{margin-top:8px;flex-wrap:wrap}.dad-actions button{font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l1,#8885);border-radius:7px;padding:4px 8px;cursor:pointer}
.dad-progress{font-size:12px;padding:8px 0;color:var(--dsw-alias-label-secondary,GrayText)}
.dad-preview-list,.dad-results ul{list-style:none;padding:0;margin:0}.dad-preview-list{max-height:320px;overflow:auto;border:1px solid var(--dsw-alias-border-l1,#8883);border-radius:12px;margin-top:12px}.dad-preview-list li{padding:12px;border-bottom:1px solid var(--dsw-alias-border-l1,#8883)}.dad-preview-list li:last-child{border-bottom:0}.dad-row-title{justify-content:space-between;align-items:flex-start}.dad-row-title strong{font-size:13px;overflow-wrap:anywhere}.dad-summary{align-items:flex-start;flex-direction:column;gap:4px;font-size:12px}.dad-summary>span{color:var(--dsw-alias-label-secondary,GrayText)}
.dad-pill{font-size:11px;white-space:nowrap;border:1px solid var(--dsw-alias-border-l1,#8883);border-radius:99px;padding:1px 7px}.dad-pill-blocked,.dad-result-failed{color:var(--dsw-alias-status-error,#bd3d3d)}.dad-item-reason{font-size:12px;line-height:1.6;margin-top:7px!important;overflow-wrap:anywhere}.dad-boundary{font-size:12px;line-height:1.7;margin:14px 0!important;color:var(--dsw-alias-label-secondary,GrayText)}
.dad-danger{color:var(--dsw-alias-status-error,#bd3d3d)!important}.dad-results{border-top:1px solid var(--dsw-alias-border-l1,#8883);padding-top:12px}.dad-results>p{font-size:12px;line-height:1.7;margin-top:5px}.dad-results li{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;font-size:12px;margin-top:8px}.dad-results li strong{font-weight:500;overflow-wrap:anywhere}.dad-result-status{margin-left:9px;color:var(--dsw-alias-label-secondary,GrayText)}.dad-results li p{font-size:12px;line-height:1.6;margin-top:3px;overflow-wrap:anywhere}
@media(max-width:560px){.dad-toolbar{align-items:flex-start}.dad-row{flex-direction:column}.dad-row-title{flex-direction:column}.dad-dialog{width:calc(100vw - 20px);max-width:calc(100vw - 20px)}}
`;

// src/client.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function isOverview(value) {
  return object(value) && object(value.support) && typeof value.support.supported === "boolean" && typeof value.support.version === "string" && typeof value.support.platform === "string" && Array.isArray(value.archived) && value.archived.every((item) => object(item) && typeof item.id === "string" && typeof item.title === "string" && typeof item.workspace === "string" && finite(item.sizeBytes) && finite(item.descendantCount)) && Array.isArray(value.trash) && value.trash.every((item) => object(item) && typeof item.id === "string" && typeof item.sessionId === "string" && typeof item.title === "string" && finite(item.trashedAt) && finite(item.sizeBytes) && finite(item.memberCount)) && Array.isArray(value.recentResults) && value.recentResults.every(isBatchResult);
}
function isPreview(value) {
  return object(value) && typeof value.id === "string" && ["trash", "restore", "purge"].includes(String(value.action)) && finite(value.expiresAt) && Array.isArray(value.items) && value.items.every((item) => object(item) && typeof item.id === "string" && typeof item.title === "string" && typeof item.sessionId === "string" && strings(item.memberIds) && finite(item.sizeBytes) && ["ready", "pending", "blocked"].includes(String(item.disposition)));
}
function isBatchResult(value) {
  return object(value) && typeof value.operationId === "string" && ["trash", "restore", "purge", "cancel"].includes(String(value.action)) && object(value.counts) && ["succeeded", "pending", "skipped", "failed"].every((key) => finite(value.counts[key])) && Array.isArray(value.items) && value.items.every((item) => object(item) && typeof item.id === "string" && typeof item.title === "string" && ["moved", "pending", "restored", "purged", "cancelled", "skipped", "failed"].includes(String(item.status)));
}
function createArchiveApi(transport = globalThis.fetch.bind(globalThis), baseUri) {
  const base = baseUri ?? document.baseURI;
  const endpoint = new URL(API_PATH.replace(/^\//, ""), base).href;
  const request = async (body, accepts) => {
    let response;
    try {
      response = await transport(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body)
      });
    } catch {
      throw new ClientTransportError("The connection to DSH was interrupted.");
    }
    let envelope;
    try {
      envelope = await response.json();
    } catch {
      throw new ClientTransportError("DSH returned an unreadable response.");
    }
    if (object(envelope) && envelope.ok === false && object(envelope.error) && typeof envelope.error.code === "string" && typeof envelope.error.message === "string") {
      throw new ArchiveError(envelope.error.code, envelope.error.message);
    }
    if (!response.ok || !object(envelope) || envelope.ok !== true || !accepts(envelope.value)) {
      throw new ClientTransportError("DSH returned an unexpected response.");
    }
    return envelope.value;
  };
  return {
    list: () => request({ action: "list" }, isOverview),
    preview: (operation, ids) => request({ action: "preview", operation, ids }, isPreview),
    execute: (previewId, requestId) => request({ action: "execute", previewId, requestId }, isBatchResult),
    cancelPending: (ids, requestId) => request({ action: "cancelPending", ids, requestId }, isBatchResult)
  };
}
function startClient(require2, apiFactory = () => createArchiveApi()) {
  const primitives = require2("@deepseek-ai/dsh-client-ui-primitives");
  return {
    name: "archive-delete-client",
    inject: ["slots", "locale", "workspaces"],
    apply(ctx) {
      const controller = new ArchiveClientController(apiFactory());
      const disposers = [];
      ctx.effect(() => ctx.locale.register(CLIENT_NAMESPACE, { en, zh }), "archive-delete: locale");
      ctx.effect(() => {
        if (typeof document === "undefined") return () => {
        };
        const style = document.createElement("style");
        style.dataset.dshArchiveDelete = "";
        style.textContent = CLIENT_CSS;
        document.head.append(style);
        return () => style.remove();
      }, "archive-delete: styles");
      function MoveToTrashItem({ sessionId, useMenuOpenState, t }) {
        const [, setMenuOpen] = useMenuOpenState();
        const subscribe = (0, import_react2.useCallback)((listener) => ctx.workspaces.list.subscribe(listener), []);
        const snapshot = (0, import_react2.useCallback)(() => ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId), [sessionId]);
        const archived = (0, import_react2.useSyncExternalStore)(subscribe, snapshot, snapshot);
        if (!archived) return null;
        return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(primitives.MenuItemButton, { separatorBefore: true, onSelect: () => {
          setMenuOpen(false);
          void controller.open(sessionId);
        }, children: t("menuTrash") });
      }
      function Overlay({ t }) {
        return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ArchiveDialog, { controller, primitives, t });
      }
      function ConfigCard({ view, t }) {
        if (view === "summary") return null;
        return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(primitives.Button, { variant: "outline", onClick: () => {
          void controller.open();
        }, children: t("manage") });
      }
      disposers.push(ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
        name: "sidebar.workspaces.session.menu.item",
        id: "qwqbig.archive-delete.trash",
        order: 520,
        locale: CLIENT_NAMESPACE
      }, MoveToTrashItem)));
      disposers.push(ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay",
        id: "qwqbig.archive-delete.dialog",
        locale: CLIENT_NAMESPACE
      }, Overlay)));
      disposers.push(ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
        name: "plugins.bundle.config",
        key: PACKAGE_NAME,
        locale: CLIENT_NAMESPACE
      }, ConfigCard)));
      ctx.effect(() => () => {
        controller.dispose();
        for (const dispose of disposers.reverse()) dispose();
      }, "archive-delete: client lifecycle");
    }
  };
}

    return module.exports.startClient(require);
  }
});

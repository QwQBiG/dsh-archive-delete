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
var PAGE_SIZE = 100;
var ClientTransportError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ClientTransportError";
  }
};
function pageItems(items, page) {
  return items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
}
function pageCount(state) {
  return Math.max(1, Math.ceil((state.overview?.[state.tab].length ?? 0) / PAGE_SIZE));
}
function selectableIds(state) {
  if (!state.overview) return [];
  return state.tab === "archived" ? pageItems(state.overview.archived, state.page).filter((item) => !item.pending).map((item) => item.id) : pageItems(state.overview.trash, state.page).map((item) => item.id);
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
    page: 0,
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
    this.update({ open: true, tab: "archived", page: 0, selected: [], preview: null, error: this.uncertainMutation ? this.state.error : null });
    await this.refresh();
    if (!sessionId || generation !== this.openGeneration || !this.state.open || this.state.busy || this.uncertainMutation || this.state.error || !this.state.overview?.support.supported) return;
    const index = this.state.overview.archived.findIndex((item) => item.id === sessionId && !item.pending);
    if (index < 0) return;
    this.update({ page: Math.floor(index / PAGE_SIZE), selected: [sessionId] });
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
    this.update({ tab, page: 0, selected: [], preview: null, error: null });
  };
  setPage = (page) => {
    if (this.state.busy || this.state.loading || this.uncertainMutation || !Number.isInteger(page)) return;
    const next = Math.max(0, Math.min(page, pageCount(this.state) - 1));
    if (next === this.state.page) return;
    this.previewGeneration++;
    this.update({ page: next, selected: [], preview: null, error: null });
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
      this.update({ overview, page: Math.min(this.state.page, pageCount({ overview, tab: this.state.tab }) - 1), loading: false, error: this.uncertainMutation ? this.state.error : null });
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
  title: "Archives & trash",
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
  intro: "Clean up archived conversations, with the option to restore them.",
  scope: "Session logs and their dedicated subagent logs are included. Shared attachments, spill files, project files and other plugins\u2019 caches are retained.",
  noArchives: "No archived conversations",
  noTrash: "Your trash is empty",
  emptyArchivesHint: "Conversations you archive in DSH will appear here.",
  emptyTrashHint: "Moved conversations stay here until you restore or delete them.",
  selectAll: "Select all ({n})",
  selected: "{n} selected",
  moveSelected: "Move selected to trash",
  restoreSelected: "Restore selected",
  purgeSelected: "Delete permanently",
  moveTitle: "Move these conversations to trash?",
  restoreTitle: "Restore these conversations?",
  purgeTitle: "Permanently delete these conversations?",
  moveDescription: "Review the selected conversations and their dedicated subagents.",
  restoreDescription: "Restore the original logs in their archived state. A missing workspace becomes Ungrouped; existing paths will never be overwritten.",
  purgeDescription: "Delete the selected session logs and recovery records from this machine. This cannot be undone.",
  confirmTrash: "Confirm move to trash",
  confirmRestore: "Confirm restore",
  confirmPurge: "Confirm permanent deletion",
  previewExpired: "This preview expired. Go back and review your selection again.",
  previewEmpty: "No eligible records remain. Go back and refresh the list.",
  archivedHint: "Running work and uncertain relationships stay protected.",
  trashHint: "Restored conversations remain archived.",
  retention: "No automatic deletion",
  scopeTitle: "What this includes",
  pages: "Conversation pages",
  previousPage: "Previous",
  nextPage: "Next",
  pageNumber: "Page {page} of {pages}",
  pending: "Pending restart",
  pendingHint: "Still held by DSH. No disk space has been freed yet.",
  cancelPending: "Cancel pending move",
  pendingCancelled: "Pending move cancelled",
  childCount: "Subagents: {n}",
  memberCount: "Conversations: {n}",
  ready: "Ready",
  blocked: "Protected",
  pendingPreview: "After restart",
  previewCount: "Selected: {n}",
  previewMembers: "Conversations: {n}",
  previewSize: "Session log size: {size}",
  expires: "Confirmation is valid until {time}.",
  result: "Latest result",
  resultDetails: "View details",
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
  listFailure: "Unable to read the current records. Refresh to try again.",
  reasonActive: "This conversation or a related task is active. Finish it before continuing.",
  reasonBusy: "Another process holds the session write lock. Close that instance and review again.",
  reasonLoaded: "DSH still holds this idle conversation. The move will wait for the next start.",
  reasonChanged: "The archive state or session content changed. Review a new preview.",
  reasonRecovery: "An interrupted operation needs recovery before another change is allowed.",
  reasonInterrupted: "This operation was interrupted. Review its current state before retrying.",
  reasonPending: "This conversation is already waiting for the next start.",
  reasonArchived: "Only archived conversations can be moved to trash.",
  reasonMissing: "The selected record no longer exists. Refresh the list.",
  reasonLineage: "A related conversation has uncertain ownership. This group is protected.",
  reasonPath: "A storage path or file is unsafe or has changed. No overwrite is allowed.",
  reasonConflict: "A restore destination already exists. It will not be overwritten.",
  reasonOverlap: "These selections share a related conversation. Select each group once.",
  reasonPlatform: "This release supports macOS Desktop only.",
  reasonVersion: "This release is verified only with DSH 0.2.1-rc.3.",
  reasonBackend: "The official JSONL storage backend is required.",
  reasonCapabilities: "Required DSH services are unavailable or incompatible.",
  reasonInitialization: "Archive storage could not be initialized. Check the host diagnostics and reload the plugin.",
  reasonStoreBusy: "Another DSH process owns this trash store. Close that instance before continuing."
};
var zh = {
  title: "\u5F52\u6863\u4E0E\u56DE\u6536\u7AD9",
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
  intro: "\u6E05\u7406\u5DF2\u5F52\u6863\u4F1A\u8BDD\uFF0C\u9700\u8981\u65F6\u53EF\u4EE5\u6062\u590D\u3002",
  scope: "\u5904\u7406\u8303\u56F4\u5305\u542B\u4F1A\u8BDD\u65E5\u5FD7\u53CA\u5176\u4E13\u5C5E\u5B50\u4EE3\u7406\u65E5\u5FD7\u3002\u5171\u4EAB\u9644\u4EF6\u3001spill \u6587\u4EF6\u3001\u9879\u76EE\u6587\u4EF6\u548C\u5176\u4ED6\u63D2\u4EF6\u7F13\u5B58\u4F1A\u4FDD\u7559\u3002",
  noArchives: "\u6682\u65E0\u5DF2\u5F52\u6863\u4F1A\u8BDD",
  noTrash: "\u56DE\u6536\u7AD9\u4E3A\u7A7A",
  emptyArchivesHint: "\u5728 DSH \u4E2D\u5F52\u6863\u7684\u4F1A\u8BDD\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002",
  emptyTrashHint: "\u79FB\u5165\u7684\u4F1A\u8BDD\u4F1A\u4FDD\u7559\uFF0C\u76F4\u5230\u4F60\u9009\u62E9\u6062\u590D\u6216\u6E05\u9664\u3002",
  selectAll: "\u5168\u9009\uFF08{n}\uFF09",
  selected: "\u5DF2\u9009\u62E9 {n} \u9879",
  moveSelected: "\u5C06\u6240\u9009\u79FB\u5165\u56DE\u6536\u7AD9",
  restoreSelected: "\u6062\u590D\u6240\u9009",
  purgeSelected: "\u6C38\u4E45\u6E05\u9664",
  moveTitle: "\u5C06\u8FD9\u4E9B\u4F1A\u8BDD\u79FB\u5165\u56DE\u6536\u7AD9\uFF1F",
  restoreTitle: "\u6062\u590D\u8FD9\u4E9B\u4F1A\u8BDD\uFF1F",
  purgeTitle: "\u6C38\u4E45\u6E05\u9664\u8FD9\u4E9B\u4F1A\u8BDD\uFF1F",
  moveDescription: "\u8BF7\u6838\u5BF9\u6240\u9009\u4F1A\u8BDD\u53CA\u5176\u4E13\u5C5E\u5B50\u4EE3\u7406\u7684\u5904\u7406\u8303\u56F4\u3002",
  restoreDescription: "\u6062\u590D\u539F\u59CB\u65E5\u5FD7\u5E76\u4FDD\u6301\u5DF2\u5F52\u6863\u72B6\u6001\u3002\u539F\u5DE5\u4F5C\u533A\u4E0D\u5B58\u5728\u65F6\u5F52\u5165\u201C\u672A\u5206\u7EC4\u201D\uFF0C\u4E0D\u4F1A\u8986\u76D6\u5DF2\u6709\u8DEF\u5F84\u3002",
  purgeDescription: "\u5C06\u4ECE\u672C\u673A\u6E05\u9664\u6240\u9009\u4F1A\u8BDD\u7684\u65E5\u5FD7\u4E0E\u6062\u590D\u8BB0\u5F55\uFF0C\u6B64\u64CD\u4F5C\u65E0\u6CD5\u64A4\u9500\u3002",
  confirmTrash: "\u786E\u8BA4\u79FB\u5165\u56DE\u6536\u7AD9",
  confirmRestore: "\u786E\u8BA4\u6062\u590D",
  confirmPurge: "\u786E\u8BA4\u6C38\u4E45\u6E05\u9664",
  previewExpired: "\u9884\u89C8\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u8FD4\u56DE\u5E76\u91CD\u65B0\u6838\u5BF9\u76EE\u6807\u3002",
  previewEmpty: "\u6CA1\u6709\u53EF\u64CD\u4F5C\u8BB0\u5F55\uFF0C\u8BF7\u8FD4\u56DE\u5E76\u5237\u65B0\u5217\u8868\u3002",
  archivedHint: "\u8FD0\u884C\u4E2D\u7684\u5DE5\u4F5C\u4E0E\u5173\u8054\u4E0D\u660E\u7684\u4F1A\u8BDD\u4F1A\u53D7\u5230\u4FDD\u62A4\u3002",
  trashHint: "\u6062\u590D\u540E\u4F1A\u8BDD\u4ECD\u4FDD\u6301\u5DF2\u5F52\u6863\u72B6\u6001\u3002",
  retention: "\u4E0D\u4F1A\u81EA\u52A8\u6E05\u9664",
  scopeTitle: "\u5904\u7406\u8303\u56F4",
  pages: "\u4F1A\u8BDD\u5206\u9875",
  previousPage: "\u4E0A\u4E00\u9875",
  nextPage: "\u4E0B\u4E00\u9875",
  pageNumber: "\u7B2C {page} / {pages} \u9875",
  pending: "\u5F85\u91CD\u542F\u5904\u7406",
  pendingHint: "DSH \u4ECD\u5360\u7528\u6B64\u4F1A\u8BDD\uFF0C\u76EE\u524D\u5C1A\u672A\u91CA\u653E\u78C1\u76D8\u7A7A\u95F4\u3002",
  cancelPending: "\u53D6\u6D88\u5F85\u5904\u7406",
  pendingCancelled: "\u5DF2\u53D6\u6D88\u5F85\u5904\u7406",
  childCount: "\u5B50\u4EE3\u7406 {n}",
  memberCount: "\u4F1A\u8BDD {n} \u4E2A",
  ready: "\u53EF\u6267\u884C",
  blocked: "\u5DF2\u4FDD\u62A4",
  pendingPreview: "\u91CD\u542F\u540E\u5904\u7406",
  previewCount: "\u5DF2\u9009\u62E9 {n} \u9879",
  previewMembers: "\u5171 {n} \u4E2A\u4F1A\u8BDD",
  previewSize: "\u4F1A\u8BDD\u65E5\u5FD7\u5927\u5C0F\uFF1A{size}",
  expires: "\u672C\u6B21\u786E\u8BA4\u5728 {time} \u524D\u6709\u6548\u3002",
  result: "\u6700\u8FD1\u7ED3\u679C",
  resultDetails: "\u67E5\u770B\u660E\u7EC6",
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
  listFailure: "\u65E0\u6CD5\u8BFB\u53D6\u5F53\u524D\u8BB0\u5F55\uFF0C\u8BF7\u5237\u65B0\u91CD\u8BD5\u3002",
  reasonActive: "\u6B64\u4F1A\u8BDD\u6216\u5173\u8054\u4EFB\u52A1\u6B63\u5728\u8FD0\u884C\uFF0C\u8BF7\u5B8C\u6210\u540E\u91CD\u65B0\u6838\u5BF9\u3002",
  reasonBusy: "\u5176\u4ED6\u8FDB\u7A0B\u6301\u6709\u4F1A\u8BDD\u5199\u9501\uFF0C\u8BF7\u5173\u95ED\u76F8\u5E94\u5B9E\u4F8B\u540E\u91CD\u65B0\u6838\u5BF9\u3002",
  reasonLoaded: "DSH \u4ECD\u6301\u6709\u6B64\u95F2\u7F6E\u4F1A\u8BDD\uFF0C\u5C06\u7B49\u5F85\u4E0B\u6B21\u542F\u52A8\u540E\u79FB\u5165\u56DE\u6536\u7AD9\u3002",
  reasonChanged: "\u5F52\u6863\u72B6\u6001\u6216\u4F1A\u8BDD\u5185\u5BB9\u5DF2\u7ECF\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u9884\u89C8\u5E76\u786E\u8BA4\u3002",
  reasonRecovery: "\u5B58\u5728\u9700\u8981\u6062\u590D\u7684\u4E2D\u65AD\u64CD\u4F5C\uFF0C\u6062\u590D\u5B8C\u6210\u524D\u4E0D\u80FD\u7EE7\u7EED\u4FEE\u6539\u3002",
  reasonInterrupted: "\u4E0A\u6B21\u64CD\u4F5C\u5DF2\u4E2D\u65AD\uFF0C\u8BF7\u6838\u5BF9\u5F53\u524D\u72B6\u6001\u540E\u91CD\u65B0\u786E\u8BA4\u3002",
  reasonPending: "\u6B64\u4F1A\u8BDD\u5DF2\u5728\u7B49\u5F85\u4E0B\u6B21\u542F\u52A8\u540E\u5904\u7406\u3002",
  reasonArchived: "\u53EA\u6709\u5DF2\u5F52\u6863\u4F1A\u8BDD\u53EF\u4EE5\u79FB\u5165\u56DE\u6536\u7AD9\u3002",
  reasonMissing: "\u6240\u9009\u8BB0\u5F55\u5DF2\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5237\u65B0\u5217\u8868\u3002",
  reasonLineage: "\u5173\u8054\u4F1A\u8BDD\u7684\u5F52\u5C5E\u4E0D\u660E\u786E\uFF0C\u5DF2\u4FDD\u62A4\u6B64\u7EC4\u8BB0\u5F55\u3002",
  reasonPath: "\u5B58\u50A8\u8DEF\u5F84\u6216\u6587\u4EF6\u4E0D\u5B89\u5168\uFF0C\u6216\u5DF2\u7ECF\u53D8\u5316\uFF0C\u4E0D\u4F1A\u8986\u76D6\u5DF2\u6709\u5185\u5BB9\u3002",
  reasonConflict: "\u6062\u590D\u4F4D\u7F6E\u5DF2\u6709\u5185\u5BB9\uFF0C\u4E0D\u4F1A\u8986\u76D6\u3002",
  reasonOverlap: "\u6240\u9009\u76EE\u6807\u5305\u542B\u540C\u4E00\u4E2A\u5173\u8054\u4F1A\u8BDD\uFF0C\u8BF7\u52FF\u91CD\u590D\u9009\u62E9\u540C\u7EC4\u8BB0\u5F55\u3002",
  reasonPlatform: "\u6B64\u7248\u672C\u4EC5\u652F\u6301 macOS \u684C\u9762\u7AEF\u3002",
  reasonVersion: "\u6B64\u7248\u672C\u4EC5\u9A8C\u8BC1\u652F\u6301 DSH 0.2.1-rc.3\u3002",
  reasonBackend: "\u9700\u8981\u4F7F\u7528\u5B98\u65B9 JSONL \u5B58\u50A8\u540E\u7AEF\u3002",
  reasonCapabilities: "\u6240\u9700\u7684 DSH \u670D\u52A1\u4E0D\u53EF\u7528\u6216\u4E0D\u517C\u5BB9\u3002",
  reasonInitialization: "\u56DE\u6536\u7AD9\u5B58\u50A8\u521D\u59CB\u5316\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5BBF\u4E3B\u8BCA\u65AD\u540E\u91CD\u65B0\u52A0\u8F7D\u63D2\u4EF6\u3002",
  reasonStoreBusy: "\u5176\u4ED6 DSH \u8FDB\u7A0B\u6B63\u5728\u4F7F\u7528\u6B64\u56DE\u6536\u7AD9\uFF0C\u8BF7\u5173\u95ED\u76F8\u5E94\u5B9E\u4F8B\u540E\u7EE7\u7EED\u3002"
};
function localizeReason(code, message, t) {
  const keys = {
    active: "reasonActive",
    busy: "reasonBusy",
    "host-loaded": "reasonLoaded",
    "source-changed": "reasonChanged",
    "stale-preview": "reasonChanged",
    "preview-expired": "previewExpired",
    "recovery-required": "reasonRecovery",
    "operation-interrupted": "reasonInterrupted",
    "purge-interrupted": "reasonInterrupted",
    "already-pending": "reasonPending",
    "not-archived": "reasonArchived",
    "session-missing": "reasonMissing",
    "missing-session": "reasonMissing",
    "session-not-found": "reasonMissing",
    "dependent-session": "reasonLineage",
    "ambiguous-lineage": "reasonLineage",
    "ambiguous-workspace": "reasonLineage",
    "unsafe-path": "reasonPath",
    "unsafe-lock": "reasonPath",
    "unknown-file": "reasonPath",
    "unknown-artifact": "reasonPath",
    "path-conflict": "reasonConflict",
    "restore-conflict": "reasonConflict",
    "overlapping-targets": "reasonOverlap",
    "store-busy": "reasonStoreBusy"
  };
  const key = code ? keys[code] : void 0;
  return key ? t(key) : message;
}
function supportReason(message, t) {
  if (!message) return t("reasonCapabilities");
  if (message.startsWith("Only macOS")) return t("reasonPlatform");
  if (message.startsWith("This release is verified only")) return t("reasonVersion");
  if (message.includes("official JSONL")) return t("reasonBackend");
  if (message.includes("Another DSH process")) return t("reasonStoreBusy");
  if (message.startsWith("Archive storage could not be initialized")) return t("reasonInitialization");
  if (message.includes("unavailable") || message.includes("incompatible")) return t("reasonCapabilities");
  return message;
}
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
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: localizeReason(error.code, error.message, t) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: error.code })
    ] }),
    error.uncertain && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { size: "sm", variant: "outline", onClick: onRefresh, disabled, children: t("refresh") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { size: "sm", variant: "outline", onClick: onRetry, disabled, children: t("retryRequest") })
    ] })
  ] });
}
function ArchiveIcon({ trash = false }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", children: trash ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" }) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 5h16v4H4zM6 9v11h12V9M10 13h4" }) }) });
}
function EmptyState({ tab, t }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-empty", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dad-empty-icon", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArchiveIcon, { trash: tab === "trash" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t(tab === "archived" ? "noArchives" : "noTrash") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t(tab === "archived" ? "emptyArchivesHint" : "emptyTrashHint") })
  ] });
}
function PreviewContent({ preview, t }) {
  const members = preview.items.reduce((sum, item) => sum + item.memberIds.length, 0);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-preview", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-summary", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("previewCount", { n: preview.items.length }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("previewMembers", { n: members }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatBytes(preview.items.reduce((sum, item) => sum + item.sizeBytes, 0)) })
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
      (item.disposition === "pending" || item.message) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dad-item-reason", children: item.disposition === "pending" ? t("pendingHint") : localizeReason(item.code, item.message, t) })
    ] }, item.id)) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: `dad-boundary${preview.action === "purge" ? " dad-boundary-danger" : ""}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dad-boundary-icon", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArchiveIcon, { trash: preview.action === "purge" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("scopeTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("scope") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dad-expiry", children: t("expires", { time: formatTime(preview.expiresAt) }) })
  ] });
}
function ResultContent({ result, t, retry, disabled, Button }) {
  const hasProblems = result.counts.failed > 0 || result.counts.skipped > 0;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "dad-results", "aria-label": t("result"), open: hasProblems || void 0, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dad-result-label", children: t("result") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: hasProblems ? "dad-result-summary dad-result-attention" : "dad-result-summary", role: "status", children: t("resultSummary", result.counts) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dad-result-disclosure", "aria-label": t("resultDetails"), children: "\u2304" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: result.items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: item.title || item.id }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `dad-result-status dad-result-${item.status}`, children: t(`status.${item.status}`) }),
        item.message && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: localizeReason(item.code, item.message, t) })
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
  const pages = pageCount(state);
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
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: supportReason(state.overview.support.reason, t) }),
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
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-list-heading", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checkbox, { checked: eligibleIds.length > 0 && selected.length === eligibleIds.length, disabled: locked || !supported || eligibleIds.length === 0, onChange: controller.selectAll, label: t("selectAll", { n: eligibleIds.length }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dad-retention", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", children: "\u25F7" }),
          t("retention")
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "tabpanel", id: `${tabsId}-panel`, "aria-labelledby": `${tabsId}-${state.tab}`, "aria-busy": state.loading, className: "dad-list", children: [
        state.loading && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: t("loading") }),
        !state.loading && state.overview && state.overview[state.tab].length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, { tab: state.tab, t }),
        state.tab === "archived" ? pageItems(state.overview?.archived ?? [], state.page).map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-row", "data-selected": selectedSet.has(item.id), "data-pending": item.pending === true, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-row-main", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checkbox, { checked: selectedSet.has(item.id), disabled: locked || !supported || item.pending === true, onChange: () => controller.toggle(item.id), label: item.title || item.id }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-meta", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dad-workspace", children: item.workspace || t("ungrouped") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatBytes(item.sizeBytes) }),
              item.descendantCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dad-badge", children: t("childCount", { n: item.descendantCount }) }),
              item.pending && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dad-badge dad-badge-pending", children: t("pending") })
            ] }),
            item.pending && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dad-pending", children: t("pendingHint") })
          ] }),
          item.pending && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { size: "sm", variant: "outline", disabled: locked || !supported, onClick: () => {
            void controller.cancelPending([item.id]);
          }, children: t("cancelPending") })
        ] }, item.id)) : pageItems(state.overview?.trash ?? [], state.page).map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dad-row", "data-selected": selectedSet.has(item.id), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-row-main", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checkbox, { checked: selectedSet.has(item.id), disabled: locked || !supported, onChange: () => controller.toggle(item.id), label: item.title || item.sessionId }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-meta", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", { dateTime: isoTime(item.trashedAt), children: formatTime(item.trashedAt) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatBytes(item.sizeBytes) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dad-badge", children: t("memberCount", { n: item.memberCount }) })
          ] })
        ] }) }, item.id))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-list-foot", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dad-hint", children: t(state.tab === "archived" ? "archivedHint" : "trashHint") }),
        pages > 1 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", { className: "dad-pagination", "aria-label": t("pages"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { size: "sm", variant: "ghost", disabled: locked || state.page === 0, onClick: () => controller.setPage(state.page - 1), children: t("previousPage") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("pageNumber", { page: state.page + 1, pages }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { size: "sm", variant: "ghost", disabled: locked || state.page + 1 >= pages, onClick: () => controller.setPage(state.page + 1), children: t("nextPage") })
        ] })
      ] }),
      result && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ResultContent, { result, t, retry: (id) => {
        void controller.retryItem(id);
      }, disabled: locked || !supported, Button })
    ] }),
    (state.busy || uncertain) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dad-muted", children: t("operationContinues") })
  ] }) });
}
var CLIENT_CSS = `
.dad-dialog{width:min(780px,calc(100vw - 32px));max-width:calc(100vw - 32px)}
.dad-content{max-height:min(65vh,540px);overflow:auto}
.dad-shell{--dad-border:var(--dsw-alias-border-l1,#8883);--dad-muted:var(--dsw-alias-label-secondary,GrayText);--dad-primary:var(--dsw-alias-label-primary,CanvasText);display:flex;flex-direction:column;gap:12px;min-width:0;color:var(--dad-primary);font-size:13px;line-height:1.5}
.dad-shell p,.dad-shell h3{margin:0}.dad-shell button{font:inherit}
.dad-toolbar,.dad-actions,.dad-row-title,.dad-meta,.dad-summary,.dad-list-heading,.dad-list-foot,.dad-pagination{display:flex;align-items:center;gap:10px}
.dad-toolbar{justify-content:space-between;gap:16px}
.dad-tabs{display:flex;gap:3px;padding:3px;border:1px solid var(--dad-border);border-radius:11px;background:var(--dsw-alias-bg-layer-1,#8881)}
.dad-tabs button{display:flex;align-items:center;gap:8px;border:0;background:transparent;color:var(--dad-muted);padding:7px 13px;font-size:13px;font-weight:500;border-radius:8px;cursor:pointer}
.dad-tabs button[aria-selected=true]{color:var(--dad-primary);background:var(--dsw-alias-bg-base,Canvas);box-shadow:0 1px 3px #0001}
.dad-tabs button:focus-visible,.dad-row:focus-within{outline:2px solid var(--dsw-alias-button-primary-bg,#2878e0);outline-offset:2px}
.dad-tabs button:disabled{cursor:default;opacity:.55}.dad-count{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:18px;padding:0 4px;border-radius:5px;background:color-mix(in srgb,var(--dad-primary) 6%,transparent);font-size:10px;font-weight:600;font-variant-numeric:tabular-nums}
.dad-list-heading{justify-content:space-between;gap:12px;padding:1px 2px;color:var(--dad-muted);font-size:12px}.dad-retention{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-size:11px}.dad-retention>span{font-size:15px;line-height:1}
.dad-list{display:flex;flex-direction:column;gap:7px;min-height:70px;max-height:290px;overflow:auto;padding:3px 3px 4px;scrollbar-gutter:stable}
.dad-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:11px 12px;border:1px solid var(--dad-border);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#88805);transition:border-color .15s,background .15s}
.dad-row[data-selected=true]{border-color:color-mix(in srgb,var(--dad-primary) 32%,transparent);background:color-mix(in srgb,var(--dad-primary) 6%,transparent)}
.dad-row[data-pending=true]{border-style:dashed}.dad-row-main{flex:1;min-width:0}.dad-row-main>label{min-width:0;align-items:flex-start;font-size:13px;font-weight:500}.dad-row-main>label>span{overflow-wrap:anywhere}
.dad-meta{gap:5px 10px;flex-wrap:wrap;margin-top:5px;padding-left:25px;color:var(--dad-muted);font-size:11px;line-height:1.5}.dad-meta>span,.dad-meta>time{overflow-wrap:anywhere}.dad-workspace{max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dad-badge{padding:1px 6px;border-radius:5px;background:color-mix(in srgb,var(--dad-primary) 5%,transparent);font-size:10px}.dad-badge-pending{border:1px solid var(--dad-border);background:transparent}
.dad-pending{margin:6px 0 0 25px!important;color:var(--dad-muted);font-size:11px;line-height:1.5}.dad-row>button{flex-shrink:0;margin-top:1px}
.dad-list-foot{align-items:flex-start;justify-content:space-between;gap:12px}.dad-hint,.dad-expiry{color:var(--dad-muted);font-size:11px;line-height:1.5}.dad-hint{padding:1px 2px}.dad-pagination{flex-shrink:0;gap:5px;font-size:11px;color:var(--dad-muted)}.dad-pagination button{padding:1px 5px;min-height:22px}.dad-pagination>span{font-variant-numeric:tabular-nums;white-space:nowrap}
.dad-selection{margin-right:auto;font-size:12px;color:var(--dsw-alias-label-secondary,GrayText)}
.dad-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;min-height:180px;padding:25px 18px;text-align:center;border:1px dashed var(--dad-border);border-radius:12px;color:var(--dad-muted)}.dad-empty strong{color:var(--dad-primary);font-size:13px;font-weight:500}.dad-empty p{max-width:340px;font-size:12px}.dad-empty-icon{display:flex;align-items:center;justify-content:center;width:42px;height:42px;margin-bottom:5px;border:1px solid var(--dad-border);border-radius:13px;background:var(--dsw-alias-bg-layer-1,#8881)}
.dad-alert{padding:10px 12px;border:1px solid var(--dad-border);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#8881);font-size:12px;line-height:1.6}.dad-alert p+p{margin-top:5px}.dad-alert details{margin-top:5px}.dad-alert code{font-size:11px;overflow-wrap:anywhere}
.dad-error{border-color:var(--dsw-alias-status-error,#bd3d3d)}.dad-actions{margin-top:8px;flex-wrap:wrap}.dad-progress{font-size:12px;padding:3px 0;color:var(--dad-muted)}.dad-muted{color:var(--dad-muted);font-size:12px;line-height:1.6}
.dad-summary{gap:8px;flex-wrap:wrap;padding:0 1px;font-size:12px}.dad-summary>strong{font-weight:600}.dad-summary>span{color:var(--dad-muted)}.dad-summary>span:before{content:'\xB7';margin-right:8px;opacity:.6}
.dad-preview-list,.dad-results ul{list-style:none;padding:0;margin:0}.dad-preview-list{display:flex;flex-direction:column;gap:7px;max-height:250px;overflow:auto;margin-top:12px;padding:2px 2px 3px}.dad-preview-list li{padding:12px;border:1px solid var(--dad-border);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#88805)}.dad-preview-list .dad-meta{padding-left:0}.dad-row-title{justify-content:space-between;align-items:flex-start}.dad-row-title strong{font-size:13px;font-weight:500;overflow-wrap:anywhere}
.dad-pill{flex-shrink:0;font-size:10px;white-space:nowrap;border:1px solid var(--dad-border);border-radius:6px;padding:2px 7px;color:var(--dad-muted)}.dad-pill-ready{background:color-mix(in srgb,var(--dad-primary) 5%,transparent)}.dad-pill-blocked,.dad-result-attention{color:var(--dsw-alias-status-error,#bd3d3d)}.dad-item-reason{font-size:11px;line-height:1.5;margin-top:7px!important;color:var(--dad-muted);overflow-wrap:anywhere}
.dad-boundary{display:flex;align-items:flex-start;gap:10px;margin:13px 2px 10px;padding:11px 12px;border:1px solid var(--dad-border);border-radius:10px;font-size:11px;line-height:1.6;color:var(--dad-muted)}.dad-boundary-icon{display:flex;flex-shrink:0;margin-top:1px}.dad-boundary strong{display:block;margin-bottom:3px;font-size:11px;font-weight:600;color:var(--dad-primary)}.dad-boundary-danger{border-color:color-mix(in srgb,var(--dsw-alias-status-error,#bd3d3d) 30%,transparent)}.dad-boundary-danger .dad-boundary-icon{color:var(--dsw-alias-status-error,#bd3d3d)}.dad-expiry{padding:0 3px}
.dad-danger{color:var(--dsw-alias-status-error,#bd3d3d)!important}.dad-results{border:1px solid var(--dad-border);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#88805);font-size:11px}.dad-results summary{display:flex;align-items:center;gap:10px;list-style:none;padding:10px 12px;cursor:pointer}.dad-results summary::-webkit-details-marker{display:none}.dad-results summary:focus-visible{outline:2px solid var(--dsw-alias-button-primary-bg,#2878e0);outline-offset:2px;border-radius:9px}.dad-result-label{font-weight:500;white-space:nowrap}.dad-result-summary{flex:1;color:var(--dad-muted);font-variant-numeric:tabular-nums}.dad-result-disclosure{font-size:16px;line-height:1;color:var(--dad-muted);transition:transform .15s}.dad-results[open] .dad-result-disclosure{transform:rotate(180deg)}.dad-results[open] summary{border-bottom:1px solid var(--dad-border)}.dad-results ul{padding:0 12px;max-height:190px;overflow:auto}.dad-results li{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--dad-border)}.dad-results li:last-child{border-bottom:0}.dad-results li>div{min-width:0}.dad-results li strong{font-weight:500;overflow-wrap:anywhere}.dad-result-status{display:inline-block;margin-left:8px;font-size:10px;color:var(--dad-muted)}.dad-result-failed{color:var(--dsw-alias-status-error,#bd3d3d)}.dad-results li p{font-size:11px;line-height:1.5;margin-top:4px;overflow-wrap:anywhere}
@media(prefers-reduced-motion:reduce){.dad-row,.dad-result-disclosure{transition:none}}
@media(max-width:560px){.dad-dialog{width:calc(100vw - 20px);max-width:calc(100vw - 20px)}.dad-content{max-height:65vh}.dad-toolbar{gap:8px}.dad-tabs button{padding:6px 9px}.dad-row{padding:10px;gap:8px}.dad-row-title{flex-wrap:wrap;gap:6px}.dad-list-foot{flex-direction:column;gap:6px}.dad-retention{font-size:10px}.dad-results summary{flex-wrap:wrap;gap:4px 9px}.dad-result-summary{flex-basis:75%}.dad-result-disclosure{margin-left:auto}.dad-workspace{max-width:100%}}
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

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
var import_react3 = require("react");

// src/contracts.ts
var PACKAGE_NAME = "@qwqbig/dsh-archive-delete";
var API_PATH = "/api/dsh-archive-delete";
var SUPPORTED_DSH_VERSION = "0.2.1-rc.3";
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
function sortedItems(items, sort) {
  return sort === "size-desc" ? items.toSorted((a, b) => b.sizeBytes - a.sizeBytes) : items;
}
function pageCount(state) {
  return state.tab === "storage" ? 1 : Math.max(1, Math.ceil((state.overview?.[state.tab].length ?? 0) / PAGE_SIZE));
}
function selectableIds(state) {
  if (!state.overview || state.tab === "storage") return [];
  return state.tab === "archived" ? pageItems(sortedItems(state.overview.archived, state.sort), state.page).filter((item) => !item.pending).map((item) => item.id) : pageItems(sortedItems(state.overview.trash, state.sort), state.page).map((item) => item.id);
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
    sort: "default",
    overview: null,
    selected: [],
    loading: false,
    busy: false,
    preview: null,
    result: null,
    error: null,
    uncertainRequest: false,
    storage: { workspaceId: "", scanning: false, result: null, error: null, cancelled: false }
  };
  listeners = /* @__PURE__ */ new Set();
  loadGeneration = 0;
  previewGeneration = 0;
  openGeneration = 0;
  scanGeneration = 0;
  scanAbort = null;
  disposed = false;
  uncertainMutation = null;
  knownTitles = /* @__PURE__ */ new Map();
  getSnapshot = () => this.state;
  get storageAvailable() {
    return typeof this.api.storage === "function";
  }
  setMaintenance = (maintenance) => {
    this.update({ maintenance, ...maintenance ? { preview: null, selected: [] } : {} });
  };
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
    this.previewGeneration++;
    this.cancelStorage();
    this.update({ open: true, tab: "archived", page: 0, selected: [], preview: null, error: this.uncertainMutation ? this.state.error : null });
    await this.refresh();
    if (!sessionId || generation !== this.openGeneration || !this.state.open || this.state.busy || this.uncertainMutation || this.state.error || !this.state.overview?.support.supported) return;
    const index = sortedItems(this.state.overview.archived, this.state.sort).findIndex((item) => item.id === sessionId && !item.pending);
    if (index < 0) return;
    this.update({ page: Math.floor(index / PAGE_SIZE), selected: [sessionId] });
    await this.preview("trash", [sessionId]);
  }
  close = () => {
    this.openGeneration++;
    this.previewGeneration++;
    this.cancelStorage();
    this.update({ open: false, preview: null, selected: [], loading: false });
  };
  setTab = (tab) => {
    if (this.state.busy || this.state.loading || this.uncertainMutation || this.state.tab === tab) return;
    this.previewGeneration++;
    this.cancelStorage();
    this.update({ tab, page: 0, selected: [], preview: null, error: null });
  };
  setSort = (sort) => {
    if (this.state.busy || this.state.loading || this.uncertainMutation || this.state.tab === "storage" || !["default", "size-desc"].includes(sort) || this.state.sort === sort) return;
    this.previewGeneration++;
    this.update({ sort, page: 0, selected: [], preview: null, error: null });
  };
  setStorageWorkspace = (workspaceId) => {
    if (!this.state.open || this.state.tab !== "storage" || this.state.storage.workspaceId === workspaceId || workspaceId !== "" && !this.state.overview?.storageWorkspaces?.some((item) => item.id === workspaceId)) return;
    this.cancelStorage();
    this.update({ storage: { workspaceId, scanning: false, result: null, error: null, cancelled: false } });
  };
  /** Read-only scans have their own lifetime and cannot create or resolve mutations. */
  async scanStorage(scope) {
    if (this.disposed || !this.state.open || this.state.tab !== "storage" || !this.api.storage || !this.state.overview?.support.supported) return;
    const workspaceId = scope === "workspace" ? this.state.storage.workspaceId : void 0;
    if (scope === "workspace" && (!workspaceId || !this.state.overview.storageWorkspaces?.some((item) => item.id === workspaceId))) return;
    this.cancelStorage();
    const generation = ++this.scanGeneration;
    const abort = new AbortController();
    this.scanAbort = abort;
    this.update({ storage: { ...this.state.storage, scanning: true, result: null, error: null, cancelled: false } });
    try {
      const result = await this.api.storage(workspaceId, abort.signal);
      if (generation !== this.scanGeneration || abort.signal.aborted || this.disposed || !this.state.open || this.state.tab !== "storage") return;
      if (result.scope !== scope || result.workspaceId !== workspaceId) throw new ClientTransportError("DSH returned storage details for a different scope.");
      this.scanAbort = null;
      this.update({ storage: { ...this.state.storage, scanning: false, result, error: null } });
    } catch (error) {
      if (generation !== this.scanGeneration || abort.signal.aborted || this.disposed || !this.state.open || this.state.tab !== "storage") return;
      this.scanAbort = null;
      this.update({ storage: { ...this.state.storage, scanning: false, error: this.error(error, false) } });
    }
  }
  cancelStorage = () => {
    this.scanGeneration++;
    this.scanAbort?.abort();
    this.scanAbort = null;
    if (this.state.storage.scanning) this.update({ storage: { ...this.state.storage, scanning: false, cancelled: true } });
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
      if (this.state.storage.workspaceId && !overview.storageWorkspaces?.some((item) => item.id === this.state.storage.workspaceId)) {
        this.cancelStorage();
        this.update({ storage: { workspaceId: "", scanning: false, result: null, error: null, cancelled: false } });
      }
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
    if (this.state.maintenance || this.state.busy || this.state.tab === "storage" || this.uncertainMutation || ids.length === 0) return;
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
    if (this.state.maintenance || this.state.busy || this.state.loading || this.uncertainMutation) return;
    const preview = this.state.preview;
    if (!canExecutePreview(preview, this.now())) {
      this.update({ error: { code: "preview-expired", message: "The preview has expired. Review the selection again.", uncertain: false } });
      return;
    }
    await this.perform({ kind: "execute", previewId: preview.id, requestId: this.createId() });
  }
  async cancelPending(ids) {
    if (this.state.maintenance || this.state.busy || this.uncertainMutation || ids.length === 0) return;
    await this.perform({ kind: "cancel", ids: [...new Set(ids)], requestId: this.createId() });
  }
  /** Cancel the old queued consent before offering a new, explicit confirmation. */
  async reviewPending(id) {
    if (this.state.maintenance || this.disposed || !this.state.open || this.state.busy || this.state.loading || this.uncertainMutation || this.state.tab !== "archived" || !this.state.overview?.support.supported || !pageItems(sortedItems(this.state.overview.archived, this.state.sort), this.state.page).some((item) => item.id === id && item.pending)) return;
    await this.perform({ kind: "cancel", ids: [id], requestId: this.createId(), review: { id, openGeneration: this.openGeneration } });
  }
  async retryUncertain() {
    if (this.state.maintenance || this.state.busy || !this.uncertainMutation) return;
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
      if (mutation.kind === "cancel" && mutation.review) {
        const review = mutation.review;
        if (this.disposed || review.openGeneration !== this.openGeneration || !this.state.open || this.state.error || this.state.loading || this.uncertainMutation || this.state.tab !== "archived" || !this.state.overview?.support.supported || result.action !== "cancel" || !result.items.some((item) => item.id === review.id && item.status === "cancelled")) return;
        const index = sortedItems(this.state.overview.archived, this.state.sort).findIndex((item) => item.id === review.id && !item.pending);
        if (index < 0) return;
        this.update({ page: Math.floor(index / PAGE_SIZE), selected: [review.id] });
        await this.preview("trash", [review.id]);
      }
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
    this.cancelStorage();
    this.disposed = true;
    this.loadGeneration++;
    this.previewGeneration++;
    this.knownTitles.clear();
    this.listeners.clear();
  }
};

// src/client-ui.tsx
var import_react2 = require("react");

// src/update-ui.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var updateEn = {
  updateTitle: "Plugin updates",
  updateCurrent: "Running {version}",
  updateInstalled: "Installed {version}",
  updateCheck: "Check for updates",
  updateChecking: "Checking GitHub\u2026",
  updateAutomatic: "Checks GitHub daily while DSH is running. Installation always requires your confirmation.",
  updateCurrentStatus: "This version is up to date.",
  updateUnknownStatus: "The latest version has not been checked.",
  updateAvailable: "{version} is available",
  updateIncompatible: "No verified update is available for this DSH version.",
  updateChecked: "Last checked: {time}",
  updateReview: "Review update",
  updateRelease: "Release details",
  updateNotes: "What changed",
  updateConfirmTitle: "Install version {version}?",
  updateConfirm: "Confirm upgrade",
  updateCancel: "Cancel",
  updateScope: "This replaces this plugin in the current DSH profile. Archive work pauses during installation; your conversations and trash are retained. DSH may require a full quit and reopen to load the new version.",
  updateInstalling: "Verifying and installing the confirmed update\u2026",
  updateRestart: "The new version is installed. Fully quit DSH and reopen it to finish loading it.",
  updateDone: "The new version is installed and active.",
  updateFailed: "The update did not complete.",
  updateInterrupted: "The previous update was interrupted. Check again before retrying.",
  updateUnknownOutcome: "The installation outcome is uncertain. Check its status or retry the same request. If it remains uncertain, fully quit DSH and reopen it to reconcile.",
  updateReconcile: "Check installation status",
  updateRetry: "Retry the same request",
  updateUnavailable: "The native update manager is unavailable in this profile.",
  updateBusy: "Finish the current operation before upgrading.",
  updateErrorNetwork: "GitHub could not be reached. Your installed version is unchanged; try checking again later.",
  updateErrorService: "The plugin service could not be reached. Check that the plugin is loaded, then try again.",
  updateErrorRate: "GitHub has limited update requests. Try checking again later.",
  updateErrorChanged: "The release changed. Check again and review the new details.",
  updateErrorIntegrity: "The release package or metadata could not be verified. Nothing will be installed from this confirmation.",
  updateErrorState: "Update records or the cached package need attention. Check host diagnostics before retrying.",
  updateErrorHost: "The native manager could not complete this upgrade. Check host diagnostics and the installed version.",
  updateErrorGeneric: "The update could not be completed. Check again or inspect the host diagnostics.",
  updateDetails: "Diagnostic code",
  updateNoNotes: "This release has no notes.",
  updateWaiting: "Archive changes are paused for this plugin update."
};
var updateZh = {
  updateTitle: "\u63D2\u4EF6\u66F4\u65B0",
  updateCurrent: "\u6B63\u5728\u8FD0\u884C {version}",
  updateInstalled: "\u5DF2\u5B89\u88C5 {version}",
  updateCheck: "\u68C0\u67E5\u66F4\u65B0",
  updateChecking: "\u6B63\u5728\u68C0\u67E5 GitHub\u2026",
  updateAutomatic: "DSH \u8FD0\u884C\u671F\u95F4\u6BCF\u5929\u68C0\u67E5 GitHub\uFF0C\u5B89\u88C5\u59CB\u7EC8\u9700\u8981\u4F60\u786E\u8BA4\u3002",
  updateCurrentStatus: "\u5F53\u524D\u7248\u672C\u5DF2\u662F\u6700\u65B0\u3002",
  updateUnknownStatus: "\u5C1A\u672A\u68C0\u67E5\u6700\u65B0\u7248\u672C\u3002",
  updateAvailable: "\u53D1\u73B0\u65B0\u7248\u672C {version}",
  updateIncompatible: "\u6682\u65E0\u5DF2\u9A8C\u8BC1\u517C\u5BB9\u5F53\u524D DSH \u7684\u66F4\u65B0\u3002",
  updateChecked: "\u4E0A\u6B21\u68C0\u67E5\uFF1A{time}",
  updateReview: "\u67E5\u770B\u5E76\u5347\u7EA7",
  updateRelease: "\u53D1\u884C\u8BE6\u60C5",
  updateNotes: "\u66F4\u65B0\u5185\u5BB9",
  updateConfirmTitle: "\u5B89\u88C5\u7248\u672C {version}\uFF1F",
  updateConfirm: "\u786E\u8BA4\u5347\u7EA7",
  updateCancel: "\u53D6\u6D88",
  updateScope: "\u66FF\u6362\u5F53\u524D DSH profile \u4E2D\u7684\u672C\u63D2\u4EF6\uFF0C\u5B89\u88C5\u671F\u95F4\u6682\u505C\u5F52\u6863\u64CD\u4F5C\uFF0C\u4F1A\u8BDD\u4E0E\u56DE\u6536\u7AD9\u4F1A\u4FDD\u7559\u3002DSH \u53EF\u80FD\u9700\u8981\u5B8C\u6574\u9000\u51FA\u5E76\u91CD\u65B0\u6253\u5F00\uFF0C\u624D\u80FD\u52A0\u8F7D\u65B0\u7248\u672C\u3002",
  updateInstalling: "\u6B63\u5728\u6821\u9A8C\u5E76\u5B89\u88C5\u5DF2\u786E\u8BA4\u7684\u66F4\u65B0\u2026",
  updateRestart: "\u65B0\u7248\u672C\u5DF2\u5B89\u88C5\uFF0C\u8BF7\u5B8C\u6574\u9000\u51FA DSH \u5E76\u91CD\u65B0\u6253\u5F00\uFF0C\u5B8C\u6210\u65B0\u7248\u52A0\u8F7D\u3002",
  updateDone: "\u65B0\u7248\u672C\u5DF2\u5B89\u88C5\u5E76\u751F\u6548\u3002",
  updateFailed: "\u5347\u7EA7\u672A\u5B8C\u6210\u3002",
  updateInterrupted: "\u4E0A\u6B21\u5347\u7EA7\u4E2D\u65AD\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u540E\u518D\u8BD5\u3002",
  updateUnknownOutcome: "\u5B89\u88C5\u7ED3\u679C\u5C1A\u65E0\u6CD5\u786E\u8BA4\uFF0C\u8BF7\u6838\u5BF9\u72B6\u6001\u6216\u91CD\u8BD5\u540C\u4E00\u6B21\u8BF7\u6C42\uFF1B\u82E5\u4ECD\u65E0\u6CD5\u786E\u8BA4\uFF0C\u8BF7\u5B8C\u6574\u9000\u51FA DSH \u5E76\u91CD\u65B0\u6253\u5F00\u4EE5\u6838\u5BF9\u8BB0\u5F55\u3002",
  updateReconcile: "\u6838\u5BF9\u5B89\u88C5\u72B6\u6001",
  updateRetry: "\u91CD\u8BD5\u540C\u4E00\u6B21\u8BF7\u6C42",
  updateUnavailable: "\u5F53\u524D profile \u7684\u539F\u751F\u66F4\u65B0\u7BA1\u7406\u5668\u4E0D\u53EF\u7528\u3002",
  updateBusy: "\u8BF7\u5148\u5B8C\u6210\u5F53\u524D\u64CD\u4F5C\uFF0C\u518D\u5347\u7EA7\u63D2\u4EF6\u3002",
  updateErrorNetwork: "\u65E0\u6CD5\u8FDE\u63A5 GitHub\uFF0C\u5DF2\u5B89\u88C5\u7248\u672C\u4FDD\u6301\u4E0D\u53D8\uFF0C\u8BF7\u7A0D\u540E\u91CD\u65B0\u68C0\u67E5\u3002",
  updateErrorService: "\u65E0\u6CD5\u8FDE\u63A5\u63D2\u4EF6\u670D\u52A1\uFF0C\u8BF7\u786E\u8BA4\u63D2\u4EF6\u5DF2\u52A0\u8F7D\u540E\u518D\u8BD5\u3002",
  updateErrorRate: "GitHub \u9650\u5236\u4E86\u66F4\u65B0\u8BF7\u6C42\uFF0C\u8BF7\u7A0D\u540E\u91CD\u65B0\u68C0\u67E5\u3002",
  updateErrorChanged: "\u53D1\u884C\u5185\u5BB9\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u5E76\u6838\u5BF9\u65B0\u7248\u8BF4\u660E\u3002",
  updateErrorIntegrity: "\u53D1\u884C\u5305\u6216\u5143\u6570\u636E\u672A\u901A\u8FC7\u6821\u9A8C\uFF0C\u672C\u6B21\u786E\u8BA4\u4E0D\u4F1A\u5B89\u88C5\u5B83\u3002",
  updateErrorState: "\u66F4\u65B0\u8BB0\u5F55\u6216\u7F13\u5B58\u5B89\u88C5\u5305\u9700\u8981\u5904\u7406\uFF0C\u8BF7\u67E5\u770B\u5BBF\u4E3B\u8BCA\u65AD\u540E\u518D\u8BD5\u3002",
  updateErrorHost: "\u539F\u751F\u7BA1\u7406\u5668\u672A\u5B8C\u6210\u6B64\u6B21\u5347\u7EA7\uFF0C\u8BF7\u6838\u5BF9\u5BBF\u4E3B\u8BCA\u65AD\u4E0E\u5DF2\u5B89\u88C5\u7248\u672C\u3002",
  updateErrorGeneric: "\u66F4\u65B0\u672A\u80FD\u5B8C\u6210\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u6216\u67E5\u770B\u5BBF\u4E3B\u8BCA\u65AD\u3002",
  updateDetails: "\u8BCA\u65AD\u4EE3\u7801",
  updateNoNotes: "\u6B64\u7248\u672C\u672A\u63D0\u4F9B\u66F4\u65B0\u8BF4\u660E\u3002",
  updateWaiting: "\u63D2\u4EF6\u5347\u7EA7\u671F\u95F4\u6682\u505C\u5F52\u6863\u53D8\u66F4\u3002"
};
function reason(code, t) {
  if (code === "update-service-unavailable") return t("updateErrorService");
  if (/rate/.test(code)) return t("updateErrorRate");
  if (/network|timeout|unreachable/.test(code)) return t("updateErrorNetwork");
  if (/changed|stale/.test(code)) return t("updateErrorChanged");
  if (/integrity|checksum|package-invalid|metadata|unsafe-archive|response-too-large|redirect-rejected/.test(code)) return t("updateErrorIntegrity");
  if (/state|cache|path/.test(code)) return t("updateErrorState");
  if (/unavailable/.test(code)) return t("updateUnavailable");
  if (/host|manager|install|activation|build/.test(code)) return t("updateErrorHost");
  if (code === "update-outcome-unknown") return t("updateUnknownOutcome");
  return t("updateErrorGeneric");
}
function UpdateCard({ controller, Button, t, archiveBusy = false }) {
  const state = (0, import_react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  if (!controller.available) return null;
  const data = state.data;
  const installation = data?.installation;
  const restart = data && data.currentVersion !== data.installedVersion || installation?.status === "restart-required";
  const busy = archiveBusy || state.checking || state.installing || state.uncertain;
  const canReview = data?.availability === "available" && data.canInstall && !state.error && !restart && installation?.status !== "unknown" && installation?.status !== "installing";
  const status = state.installing || installation?.status === "installing" ? t("updateInstalling") : restart ? t("updateRestart") : state.uncertain || installation?.status === "unknown" ? t("updateUnknownOutcome") : installation?.status === "failed" ? t("updateFailed") : installation?.status === "interrupted" ? t("updateInterrupted") : installation?.status === "installed" ? t("updateDone") : data?.availability === "available" ? t("updateAvailable", { version: data.candidate.version }) : data?.availability === "current" ? t("updateCurrentStatus") : data?.availability === "incompatible" ? t("updateIncompatible") : t("updateUnknownStatus");
  const code = state.error ?? (data?.availability === "error" ? data.code : installation?.code);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dad-update", "aria-label": t("updateTitle"), "aria-busy": state.installing || state.checking, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-update-heading", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("updateTitle") }),
        data && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
          t("updateCurrent", { version: data.currentVersion }),
          data.currentVersion !== data.installedVersion && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            " \xB7 ",
            t("updateInstalled", { version: data.installedVersion })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { size: "sm", variant: "outline", disabled: state.installing || state.checking, onClick: () => {
        void controller.check(true);
      }, children: t(state.checking ? "updateChecking" : state.uncertain ? "updateReconcile" : "updateCheck") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", className: restart || state.uncertain ? "dad-update-attention" : "", children: status }),
    code && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: reason(code, t) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: t("updateDetails") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: code })
      ] })
    ] }),
    data?.candidate && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-update-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: data.candidate.releaseUrl, target: "_blank", rel: "noreferrer", children: t("updateRelease") }),
      canReview && !state.reviewId && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { size: "sm", variant: "primary", disabled: busy, onClick: controller.review, children: t("updateReview") })
    ] }),
    state.reviewId && data?.candidate && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-update-review", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("updateConfirmTitle", { version: data.candidate.version }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { open: true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: t("updateNotes") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { children: data.candidate.notes || t("updateNoNotes") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("updateScope") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dad-update-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { size: "sm", variant: "outline", disabled: state.installing, onClick: controller.cancelReview, children: t("updateCancel") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { size: "sm", variant: "primary", disabled: busy, onClick: () => {
          void controller.confirm();
        }, children: t("updateConfirm") })
      ] })
    ] }),
    state.uncertain && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, { size: "sm", variant: "outline", disabled: state.installing || state.checking, onClick: () => {
      void controller.retry();
    }, children: t("updateRetry") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dad-hint", children: [
      t("updateAutomatic"),
      data?.checkedAt !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        " ",
        t("updateChecked", { time: new Date(data.checkedAt).toLocaleString() })
      ] })
    ] })
  ] });
}
var UPDATE_CSS = `
.dad-update{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l1,#8883);border-radius:10px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary,CanvasText);min-width:0}
.dad-update p{margin:0}.dad-update-heading,.dad-update-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.dad-update-heading>div{display:flex;flex-direction:column;min-width:0}.dad-update-heading small{color:var(--dsw-alias-label-secondary,GrayText);overflow-wrap:anywhere}.dad-update a{color:var(--dsw-alias-button-primary-bg,#2878e0)}.dad-update a:focus-visible{outline:2px solid currentColor;outline-offset:2px}.dad-update-review{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l1,#8883);border-radius:8px}.dad-update pre{max-height:200px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:6px 0}.dad-update details{min-width:0}.dad-update summary{cursor:pointer}.dad-update code{overflow-wrap:anywhere}.dad-update-attention{color:var(--dsw-alias-status-warning,#a57420)}
`;

// src/client-ui.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var CLIENT_NAMESPACE = "qwqbig.archiveDelete";
var en = {
  ...updateEn,
  title: "Archives, trash & storage",
  manage: "Manage archives, trash and storage",
  menuTrash: "Move to trash",
  archived: "Archived",
  trash: "Trash",
  storage: "Storage overview",
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
  moveDescription: "Review the selected conversations and dedicated subagents. Confirmation can try to release idle DSH sessions without restarting. Active work and other processes remain protected; a session that cannot be released stays pending.",
  restoreDescription: "Restore the original logs in their archived state. A missing workspace becomes Ungrouped; existing paths will never be overwritten.",
  purgeDescription: "Confirm to delete the selected session logs and recovery records now, without restarting DSH. Busy entries remain protected. This cannot be undone.",
  confirmTrash: "Confirm move to trash",
  confirmRestore: "Confirm restore",
  confirmPurge: "Confirm permanent deletion",
  previewExpired: "This preview expired. Go back and review your selection again.",
  previewEmpty: "No eligible records remain. Go back and refresh the list.",
  archivedHint: "Running work and uncertain relationships stay protected.",
  trashHint: "Permanently delete selected trash after confirmation without restarting DSH. Restored conversations remain archived.",
  retention: "No automatic deletion",
  scopeTitle: "What this includes",
  pages: "Conversation pages",
  previousPage: "Previous",
  nextPage: "Next",
  pageNumber: "Page {page} of {pages}",
  pending: "Pending restart",
  pendingHint: "No disk space has been freed yet. Confirmation can try releasing an idle DSH session without restarting; if release is unavailable, the move stays pending.",
  cancelPending: "Cancel pending move",
  reviewPending: "Cancel waiting and review",
  pendingCancelled: "Pending move cancelled",
  childCount: "Subagents: {n}",
  memberCount: "Conversations: {n}",
  ready: "Ready",
  blocked: "Protected",
  pendingPreview: "Try idle release",
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
  reasonLoaded: "DSH still holds this idle conversation. It remains pending; cancel waiting and review to try again, or let the next startup recheck it.",
  reasonLifecycle: "DSH could not safely verify who owns this conversation. Its logs have not been moved. Refresh and review again.",
  reasonRelease: "DSH could not safely release this idle conversation. Its logs have not been moved. Refresh and review again.",
  reasonChanged: "The archive state or session content changed. Review a new preview.",
  reasonRecovery: "An interrupted operation needs recovery before another change is allowed.",
  reasonInterrupted: "This operation was interrupted. Review its current state before retrying.",
  reasonPending: "This conversation is already pending. Cancel waiting and review for a fresh confirmation.",
  reasonArchived: "Only archived conversations can be moved to trash.",
  reasonMissing: "The selected record no longer exists. Refresh the list.",
  reasonLineage: "A related conversation has uncertain ownership. This group is protected.",
  reasonPath: "A storage path or file is unsafe or has changed. No overwrite is allowed.",
  reasonConflict: "A restore destination already exists. It will not be overwritten.",
  reasonOverlap: "These selections share a related conversation. Select each group once.",
  reasonPlatform: "This release supports macOS and Windows Desktop.",
  reasonVersion: "DSH Desktop {required} is required. Current version: {current}. Update DSH Desktop to {required}, then restart this plugin.",
  reasonBackend: "The official JSONL storage backend is required.",
  reasonCapabilities: "Required DSH services are unavailable or incompatible.",
  reasonInitialization: "Archive storage could not be initialized. Check the host diagnostics and reload the plugin.",
  reasonStoreBusy: "Another DSH process owns this trash store. Close that instance before continuing.",
  sort: "Sort",
  sortDefault: "Default order",
  sortSize: "Largest first",
  storageIntro: "See where DSH and a selected workspace store files. Scans are read-only and start only when you request them.",
  storageHost: "DSH storage",
  storageHostScan: "Scan DSH storage",
  storageWorkspace: "Workspace",
  storageWorkspaceChoose: "Choose a workspace\u2026",
  storageWorkspaceScan: "Scan selected workspace",
  storageWorkspaceHint: "Choose one registered workspace to scan. Other project folders are not scanned.",
  storageReadOnly: "Read-only",
  storageScanning: "Reading file metadata\u2026",
  storageCancel: "Cancel scan",
  storageRefreshWorkspaces: "Refresh workspace list",
  storageReasonBusy: "The previous scan is still finishing. Wait a moment, then scan again.",
  storageReasonClosed: "The plugin is stopping. Reload it before scanning again.",
  storageReasonWorkspaceChanged: "The workspace changed during the scan. Refresh the workspace list, select it again and rescan.",
  storageReasonWorkspaceMissing: "This workspace is no longer registered. Refresh the workspace list and choose another.",
  storageReasonUnsafeWorkspace: "Choose a project folder outside protected DSH storage. Home folders, drive roots and redirected paths cannot be scanned as workspaces.",
  storageCancelled: "Scan cancelled. Start a new scan when you are ready.",
  storageFailed: "Storage could not be read. Try a new scan.",
  storageUnavailable: "Storage overview is unavailable on this host.",
  storageEmpty: "Start a scan to see storage usage",
  storageEmptyHint: "Opening this tab does not scan files.",
  storageMeasured: "Measured file size",
  storageMetric: "Logical file bytes, with verified duplicate paths and hard links counted once. This is not disk space that can be reclaimed.",
  storageComplete: "Scan completed",
  storagePartial: "Partial scan",
  storagePartialHint: "Some entries were skipped or a scan limit was reached. The size shown covers only the files measured.",
  storageObserved: "Observed {time} \xB7 {duration} ms",
  storageWindow: "Scan started {time}",
  storageFiles: "{unique} unique files \xB7 {paths} file paths",
  storageDirectoryFiles: "{n} file paths",
  storageUnknown: "Unknown",
  storageMissing: "Not found",
  storageCategoryUnavailable: "Unavailable",
  storageCategoryComplete: "Complete",
  storageCategoryPartial: "Partial",
  storageBreakdown: "Storage categories",
  storageOverlap: "Some categories overlap. Their sizes cannot be added together; the total above removes verified duplicates.",
  storageIdentity: "File identity was unavailable for {n} paths; duplicate detection may be incomplete.",
  storageDeduplicated: "Counted once: {links} duplicate hard links and {paths} repeated paths.",
  storageDetails: "Files, folders and scan details",
  storageLargest: "Largest measured files",
  storageDirectories: "Top-level folders",
  storageRootFiles: "Files at the root",
  storageDirectoryMetric: "Folder totals count file paths, including hard-link aliases, and may overlap other categories.",
  storageNoFiles: "No files measured in this category.",
  storageNoDirectories: "No folder totals available.",
  storageSource: "Origin unknown",
  storageProvenance: "File origin has not been identified. These results cannot establish that files were AI-generated, unnecessary or safe to delete.",
  storageNotSnapshot: "Files can change while a scan is running. Results describe the observation window, not a fixed snapshot.",
  storageIssues: "Scan notes",
  storageOtherIssue: "Some entries could not be measured ({code}).",
  storageIssueTime: "Time limit reached",
  storageIssueEntries: "Entry limit reached",
  storageIssueDepth: "Folder depth limit reached",
  storageIssueCancelled: "Scan cancelled",
  storageIssueLink: "Symbolic link skipped",
  storageIssueDevice: "Another volume skipped",
  storageIssueSpecial: "Special file skipped",
  storageIssueChanged: "File or folder changed during the scan",
  storageIssueUnreadable: "File or folder could not be read",
  storageIssueRoot: "Storage location is unavailable",
  storageIssueSize: "Size could not be represented exactly",
  storageIssueMemory: "This index is held in memory; there is no disk file to measure.",
  storageSkipped: "Skipped or uncertain entries",
  storageCounterSymlinks: "Symbolic links: {n}",
  storageCounterUnreadable: "Unreadable: {n}",
  storageCounterChanged: "Changed: {n}",
  storageCounterUnsupported: "Unsupported: {n}",
  storageCounterCrossDevice: "Other volumes: {n}",
  storageCounterDepth: "Depth limits: {n}",
  storageCounterHardlinks: "Duplicate hard links: {n}",
  storageCounterPaths: "Duplicate paths: {n}",
  storageCounterExcluded: "Separately categorized paths: {n}",
  storageCategorySessions: "Session logs",
  storageCategoryTrash: "Trash",
  storageCategoryStaging: "Operation staging",
  storageCategoryReceipts: "Operation receipts",
  storageCategoryOperations: "Operation records",
  storageCategoryAttachments: "Attachments",
  storageCategoryCache: "DSH cache",
  storageCategoryAttachmentCache: "Attachment cache",
  storageCategorySpill: "Spill files",
  storageCategorySettings: "DSH settings",
  storageCategoryWorkspace: "Workspace files",
  storageCategoryProfiles: "Plugin profiles",
  storageCategorySearch: "Search index",
  storageCategoryOther: "Other DSH files"
};
var zh = {
  ...updateZh,
  title: "\u5F52\u6863\u3001\u56DE\u6536\u7AD9\u4E0E\u5B58\u50A8",
  manage: "\u7BA1\u7406\u5F52\u6863\u3001\u56DE\u6536\u7AD9\u4E0E\u5B58\u50A8",
  menuTrash: "\u79FB\u5165\u56DE\u6536\u7AD9",
  archived: "\u5DF2\u5F52\u6863",
  trash: "\u56DE\u6536\u7AD9",
  storage: "\u5B58\u50A8\u6982\u89C8",
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
  moveDescription: "\u8BF7\u6838\u5BF9\u6240\u9009\u4F1A\u8BDD\u53CA\u4E13\u5C5E\u5B50\u4EE3\u7406\u3002\u786E\u8BA4\u540E\u53EF\u5C1D\u8BD5\u5B89\u5168\u91CA\u653E DSH \u6301\u6709\u7684\u95F2\u7F6E\u4F1A\u8BDD\uFF0C\u65E0\u9700\u91CD\u542F\uFF1B\u8FD0\u884C\u4E2D\u7684\u4EFB\u52A1\u548C\u5176\u4ED6\u8FDB\u7A0B\u7684\u5360\u7528\u4F1A\u53D7\u4FDD\u62A4\uFF0C\u65E0\u6CD5\u91CA\u653E\u65F6\u4ECD\u4FDD\u7559\u5F85\u5904\u7406\u3002",
  restoreDescription: "\u6062\u590D\u539F\u59CB\u65E5\u5FD7\u5E76\u4FDD\u6301\u5DF2\u5F52\u6863\u72B6\u6001\u3002\u539F\u5DE5\u4F5C\u533A\u4E0D\u5B58\u5728\u65F6\u5F52\u5165\u201C\u672A\u5206\u7EC4\u201D\uFF0C\u4E0D\u4F1A\u8986\u76D6\u5DF2\u6709\u8DEF\u5F84\u3002",
  purgeDescription: "\u786E\u8BA4\u540E\u76F4\u63A5\u6E05\u9664\u6240\u9009\u4F1A\u8BDD\u65E5\u5FD7\u4E0E\u6062\u590D\u8BB0\u5F55\uFF0C\u65E0\u9700\u91CD\u542F DSH\u3002\u4ECD\u88AB\u5360\u7528\u7684\u6761\u76EE\u4F1A\u53D7\u4FDD\u62A4\uFF0C\u6B64\u64CD\u4F5C\u65E0\u6CD5\u64A4\u9500\u3002",
  confirmTrash: "\u786E\u8BA4\u79FB\u5165\u56DE\u6536\u7AD9",
  confirmRestore: "\u786E\u8BA4\u6062\u590D",
  confirmPurge: "\u786E\u8BA4\u6C38\u4E45\u6E05\u9664",
  previewExpired: "\u9884\u89C8\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u8FD4\u56DE\u5E76\u91CD\u65B0\u6838\u5BF9\u76EE\u6807\u3002",
  previewEmpty: "\u6CA1\u6709\u53EF\u64CD\u4F5C\u8BB0\u5F55\uFF0C\u8BF7\u8FD4\u56DE\u5E76\u5237\u65B0\u5217\u8868\u3002",
  archivedHint: "\u8FD0\u884C\u4E2D\u7684\u5DE5\u4F5C\u4E0E\u5173\u8054\u4E0D\u660E\u7684\u4F1A\u8BDD\u4F1A\u53D7\u5230\u4FDD\u62A4\u3002",
  trashHint: "\u56DE\u6536\u7AD9\u5185\u5BB9\u786E\u8BA4\u540E\u5373\u53EF\u6C38\u4E45\u6E05\u9664\uFF0C\u65E0\u9700\u91CD\u542F DSH\uFF1B\u6062\u590D\u540E\u4ECD\u4FDD\u6301\u5DF2\u5F52\u6863\u72B6\u6001\u3002",
  retention: "\u4E0D\u4F1A\u81EA\u52A8\u6E05\u9664",
  scopeTitle: "\u5904\u7406\u8303\u56F4",
  pages: "\u4F1A\u8BDD\u5206\u9875",
  previousPage: "\u4E0A\u4E00\u9875",
  nextPage: "\u4E0B\u4E00\u9875",
  pageNumber: "\u7B2C {page} / {pages} \u9875",
  pending: "\u5F85\u91CD\u542F\u5904\u7406",
  pendingHint: "\u76EE\u524D\u5C1A\u672A\u91CA\u653E\u78C1\u76D8\u7A7A\u95F4\u3002\u786E\u8BA4\u540E\u53EF\u5C1D\u8BD5\u5B89\u5168\u91CA\u653E DSH \u6301\u6709\u7684\u95F2\u7F6E\u4F1A\u8BDD\uFF0C\u65E0\u9700\u91CD\u542F\uFF1B\u65E0\u6CD5\u91CA\u653E\u65F6\u4ECD\u4FDD\u7559\u5F85\u5904\u7406\u3002",
  cancelPending: "\u53D6\u6D88\u5F85\u5904\u7406",
  reviewPending: "\u53D6\u6D88\u7B49\u5F85\u5E76\u91CD\u65B0\u6838\u5BF9",
  pendingCancelled: "\u5DF2\u53D6\u6D88\u5F85\u5904\u7406",
  childCount: "\u5B50\u4EE3\u7406 {n}",
  memberCount: "\u4F1A\u8BDD {n} \u4E2A",
  ready: "\u53EF\u6267\u884C",
  blocked: "\u5DF2\u4FDD\u62A4",
  pendingPreview: "\u5C1D\u8BD5\u91CA\u653E\u95F2\u7F6E\u5360\u7528",
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
  reasonLoaded: "DSH \u4ECD\u6301\u6709\u6B64\u95F2\u7F6E\u4F1A\u8BDD\uFF0C\u6682\u4FDD\u7559\u5F85\u5904\u7406\uFF1B\u53EF\u4EE5\u53D6\u6D88\u7B49\u5F85\u5E76\u91CD\u65B0\u6838\u5BF9\u540E\u518D\u8BD5\uFF0C\u6216\u7B49\u4E0B\u6B21\u542F\u52A8\u590D\u67E5\u3002",
  reasonLifecycle: "DSH \u65E0\u6CD5\u5B89\u5168\u786E\u8BA4\u6B64\u4F1A\u8BDD\u7684\u6301\u6709\u72B6\u6001\uFF0C\u65E5\u5FD7\u5C1A\u672A\u79FB\u52A8\u3002\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u6838\u5BF9\u3002",
  reasonRelease: "DSH \u672A\u80FD\u5B89\u5168\u91CA\u653E\u6B64\u95F2\u7F6E\u4F1A\u8BDD\uFF0C\u65E5\u5FD7\u5C1A\u672A\u79FB\u52A8\u3002\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u6838\u5BF9\u3002",
  reasonChanged: "\u5F52\u6863\u72B6\u6001\u6216\u4F1A\u8BDD\u5185\u5BB9\u5DF2\u7ECF\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u9884\u89C8\u5E76\u786E\u8BA4\u3002",
  reasonRecovery: "\u5B58\u5728\u9700\u8981\u6062\u590D\u7684\u4E2D\u65AD\u64CD\u4F5C\uFF0C\u6062\u590D\u5B8C\u6210\u524D\u4E0D\u80FD\u7EE7\u7EED\u4FEE\u6539\u3002",
  reasonInterrupted: "\u4E0A\u6B21\u64CD\u4F5C\u5DF2\u4E2D\u65AD\uFF0C\u8BF7\u6838\u5BF9\u5F53\u524D\u72B6\u6001\u540E\u91CD\u65B0\u786E\u8BA4\u3002",
  reasonPending: "\u6B64\u4F1A\u8BDD\u5DF2\u5904\u4E8E\u5F85\u5904\u7406\u72B6\u6001\uFF0C\u8BF7\u53D6\u6D88\u7B49\u5F85\u5E76\u91CD\u65B0\u6838\u5BF9\u540E\u786E\u8BA4\u3002",
  reasonArchived: "\u53EA\u6709\u5DF2\u5F52\u6863\u4F1A\u8BDD\u53EF\u4EE5\u79FB\u5165\u56DE\u6536\u7AD9\u3002",
  reasonMissing: "\u6240\u9009\u8BB0\u5F55\u5DF2\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5237\u65B0\u5217\u8868\u3002",
  reasonLineage: "\u5173\u8054\u4F1A\u8BDD\u7684\u5F52\u5C5E\u4E0D\u660E\u786E\uFF0C\u5DF2\u4FDD\u62A4\u6B64\u7EC4\u8BB0\u5F55\u3002",
  reasonPath: "\u5B58\u50A8\u8DEF\u5F84\u6216\u6587\u4EF6\u4E0D\u5B89\u5168\uFF0C\u6216\u5DF2\u7ECF\u53D8\u5316\uFF0C\u4E0D\u4F1A\u8986\u76D6\u5DF2\u6709\u5185\u5BB9\u3002",
  reasonConflict: "\u6062\u590D\u4F4D\u7F6E\u5DF2\u6709\u5185\u5BB9\uFF0C\u4E0D\u4F1A\u8986\u76D6\u3002",
  reasonOverlap: "\u6240\u9009\u76EE\u6807\u5305\u542B\u540C\u4E00\u4E2A\u5173\u8054\u4F1A\u8BDD\uFF0C\u8BF7\u52FF\u91CD\u590D\u9009\u62E9\u540C\u7EC4\u8BB0\u5F55\u3002",
  reasonPlatform: "\u6B64\u7248\u672C\u652F\u6301 macOS \u548C Windows \u684C\u9762\u7AEF\u3002",
  reasonVersion: "\u9700\u8981 DSH \u684C\u9762\u7AEF {required}\uFF0C\u5F53\u524D\u7248\u672C\u4E3A {current}\u3002\u8BF7\u5C06 DSH \u684C\u9762\u7AEF\u66F4\u65B0\u81F3 {required}\uFF0C\u7136\u540E\u91CD\u65B0\u542F\u52A8\u6B64\u63D2\u4EF6\u3002",
  reasonBackend: "\u9700\u8981\u4F7F\u7528\u5B98\u65B9 JSONL \u5B58\u50A8\u540E\u7AEF\u3002",
  reasonCapabilities: "\u6240\u9700\u7684 DSH \u670D\u52A1\u4E0D\u53EF\u7528\u6216\u4E0D\u517C\u5BB9\u3002",
  reasonInitialization: "\u56DE\u6536\u7AD9\u5B58\u50A8\u521D\u59CB\u5316\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5BBF\u4E3B\u8BCA\u65AD\u540E\u91CD\u65B0\u52A0\u8F7D\u63D2\u4EF6\u3002",
  reasonStoreBusy: "\u5176\u4ED6 DSH \u8FDB\u7A0B\u6B63\u5728\u4F7F\u7528\u6B64\u56DE\u6536\u7AD9\uFF0C\u8BF7\u5173\u95ED\u76F8\u5E94\u5B9E\u4F8B\u540E\u7EE7\u7EED\u3002",
  sort: "\u6392\u5E8F",
  sortDefault: "\u9ED8\u8BA4\u987A\u5E8F",
  sortSize: "\u6309\u5927\u5C0F\u4ECE\u5927\u5230\u5C0F",
  storageIntro: "\u67E5\u770B DSH \u53CA\u6307\u5B9A\u5DE5\u4F5C\u533A\u7684\u6587\u4EF6\u5206\u5E03\u3002\u626B\u63CF\u4EC5\u8BFB\u53D6\u4FE1\u606F\uFF0C\u7531\u4F60\u4E3B\u52A8\u5F00\u59CB\u3002",
  storageHost: "DSH \u5B58\u50A8",
  storageHostScan: "\u626B\u63CF DSH \u5B58\u50A8",
  storageWorkspace: "\u5DE5\u4F5C\u533A",
  storageWorkspaceChoose: "\u8BF7\u9009\u62E9\u5DE5\u4F5C\u533A\u2026",
  storageWorkspaceScan: "\u626B\u63CF\u6240\u9009\u5DE5\u4F5C\u533A",
  storageWorkspaceHint: "\u9009\u62E9\u4E00\u4E2A\u5DF2\u767B\u8BB0\u7684\u5DE5\u4F5C\u533A\u540E\u626B\u63CF\uFF0C\u4E0D\u4F1A\u904D\u5386\u5176\u4ED6\u9879\u76EE\u76EE\u5F55\u3002",
  storageReadOnly: "\u53EA\u8BFB",
  storageScanning: "\u6B63\u5728\u8BFB\u53D6\u6587\u4EF6\u4FE1\u606F\u2026",
  storageCancel: "\u53D6\u6D88\u626B\u63CF",
  storageRefreshWorkspaces: "\u5237\u65B0\u5DE5\u4F5C\u533A\u5217\u8868",
  storageReasonBusy: "\u4E0A\u4E00\u6B21\u626B\u63CF\u4ECD\u5728\u7ED3\u675F\uFF0C\u8BF7\u7A0D\u5019\u518D\u626B\u63CF\u3002",
  storageReasonClosed: "\u63D2\u4EF6\u6B63\u5728\u505C\u6B62\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u540E\u518D\u626B\u63CF\u3002",
  storageReasonWorkspaceChanged: "\u626B\u63CF\u671F\u95F4\u5DE5\u4F5C\u533A\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u5DE5\u4F5C\u533A\u5217\u8868\uFF0C\u91CD\u65B0\u9009\u62E9\u540E\u518D\u626B\u63CF\u3002",
  storageReasonWorkspaceMissing: "\u6B64\u5DE5\u4F5C\u533A\u5DF2\u4E0D\u518D\u767B\u8BB0\uFF0C\u8BF7\u5237\u65B0\u5DE5\u4F5C\u533A\u5217\u8868\u540E\u91CD\u65B0\u9009\u62E9\u3002",
  storageReasonUnsafeWorkspace: "\u8BF7\u9009\u62E9\u53D7\u4FDD\u62A4\u7684 DSH \u5B58\u50A8\u4EE5\u5916\u7684\u9879\u76EE\u76EE\u5F55\uFF1B\u7528\u6237\u4E3B\u76EE\u5F55\u3001\u78C1\u76D8\u6839\u76EE\u5F55\u548C\u91CD\u5B9A\u5411\u8DEF\u5F84\u4E0D\u80FD\u4F5C\u4E3A\u5DE5\u4F5C\u533A\u626B\u63CF\u3002",
  storageCancelled: "\u5DF2\u53D6\u6D88\u626B\u63CF\uFF0C\u9700\u8981\u65F6\u53EF\u4EE5\u91CD\u65B0\u5F00\u59CB\u3002",
  storageFailed: "\u65E0\u6CD5\u8BFB\u53D6\u5B58\u50A8\u4FE1\u606F\uFF0C\u8BF7\u91CD\u65B0\u626B\u63CF\u3002",
  storageUnavailable: "\u5F53\u524D\u5BBF\u4E3B\u6682\u4E0D\u652F\u6301\u5B58\u50A8\u6982\u89C8\u3002",
  storageEmpty: "\u5F00\u59CB\u626B\u63CF\u540E\u67E5\u770B\u5B58\u50A8\u5206\u5E03",
  storageEmptyHint: "\u6253\u5F00\u6B64\u9875\u7B7E\u4E0D\u4F1A\u81EA\u52A8\u626B\u63CF\u6587\u4EF6\u3002",
  storageMeasured: "\u5DF2\u7EDF\u8BA1\u6587\u4EF6\u5927\u5C0F",
  storageMetric: "\u7EDF\u8BA1\u903B\u8F91\u6587\u4EF6\u5927\u5C0F\uFF0C\u5DF2\u9A8C\u8BC1\u7684\u91CD\u590D\u8DEF\u5F84\u4E0E\u786C\u94FE\u63A5\u4EC5\u8BA1\u4E00\u6B21\u3002\u6B64\u6570\u503C\u4E0D\u4EE3\u8868\u53EF\u91CA\u653E\u7684\u78C1\u76D8\u7A7A\u95F4\u3002",
  storageComplete: "\u626B\u63CF\u5B8C\u6210",
  storagePartial: "\u90E8\u5206\u626B\u63CF",
  storagePartialHint: "\u90E8\u5206\u6761\u76EE\u88AB\u8DF3\u8FC7\u6216\u5DF2\u8FBE\u5230\u626B\u63CF\u4E0A\u9650\uFF0C\u663E\u793A\u7684\u5927\u5C0F\u4EC5\u5305\u542B\u5DF2\u7EDF\u8BA1\u6587\u4EF6\u3002",
  storageObserved: "\u7EDF\u8BA1\u4E8E {time} \xB7 \u7528\u65F6 {duration} \u6BEB\u79D2",
  storageWindow: "\u626B\u63CF\u5F00\u59CB\u4E8E {time}",
  storageFiles: "{unique} \u4E2A\u72EC\u7ACB\u6587\u4EF6 \xB7 {paths} \u4E2A\u6587\u4EF6\u8DEF\u5F84",
  storageDirectoryFiles: "{n} \u4E2A\u6587\u4EF6\u8DEF\u5F84",
  storageUnknown: "\u672A\u77E5",
  storageMissing: "\u672A\u627E\u5230",
  storageCategoryUnavailable: "\u4E0D\u53EF\u7528",
  storageCategoryComplete: "\u5B8C\u6574",
  storageCategoryPartial: "\u90E8\u5206",
  storageBreakdown: "\u5B58\u50A8\u5206\u7C7B",
  storageOverlap: "\u90E8\u5206\u5206\u7C7B\u5B58\u5728\u91CD\u53E0\uFF0C\u5927\u5C0F\u4E0D\u80FD\u76F4\u63A5\u76F8\u52A0\uFF1B\u4E0A\u65B9\u603B\u8BA1\u5DF2\u79FB\u9664\u80FD\u591F\u9A8C\u8BC1\u7684\u91CD\u590D\u9879\u3002",
  storageIdentity: "\u6709 {n} \u4E2A\u8DEF\u5F84\u65E0\u6CD5\u9A8C\u8BC1\u6587\u4EF6\u6807\u8BC6\uFF0C\u53EF\u80FD\u65E0\u6CD5\u5B8C\u6574\u8BC6\u522B\u91CD\u590D\u9879\u3002",
  storageDeduplicated: "\u5DF2\u5408\u5E76\u8BA1\u6570\uFF1A\u91CD\u590D\u786C\u94FE\u63A5 {links} \u4E2A\uFF0C\u91CD\u590D\u8DEF\u5F84 {paths} \u4E2A\u3002",
  storageDetails: "\u6587\u4EF6\u3001\u76EE\u5F55\u4E0E\u626B\u63CF\u8BE6\u60C5",
  storageLargest: "\u5DF2\u7EDF\u8BA1\u7684\u5927\u6587\u4EF6",
  storageDirectories: "\u4E00\u7EA7\u76EE\u5F55",
  storageRootFiles: "\u6839\u76EE\u5F55\u4E0B\u7684\u6587\u4EF6",
  storageDirectoryMetric: "\u76EE\u5F55\u5927\u5C0F\u6309\u6587\u4EF6\u8DEF\u5F84\u7EDF\u8BA1\uFF0C\u5305\u542B\u786C\u94FE\u63A5\u522B\u540D\uFF0C\u4E5F\u53EF\u80FD\u4E0E\u5176\u4ED6\u5206\u7C7B\u91CD\u53E0\u3002",
  storageNoFiles: "\u6B64\u5206\u7C7B\u5C1A\u672A\u7EDF\u8BA1\u5230\u6587\u4EF6\u3002",
  storageNoDirectories: "\u6682\u65E0\u76EE\u5F55\u7EDF\u8BA1\u3002",
  storageSource: "\u6765\u6E90\u672A\u77E5",
  storageProvenance: "\u5C1A\u672A\u5224\u65AD\u6587\u4EF6\u6765\u6E90\uFF0C\u4E0D\u80FD\u636E\u6B64\u8BA4\u5B9A\u6587\u4EF6\u7531 AI \u751F\u6210\u3001\u4E0D\u518D\u9700\u8981\u6216\u53EF\u4EE5\u5B89\u5168\u5220\u9664\u3002",
  storageNotSnapshot: "\u626B\u63CF\u671F\u95F4\u6587\u4EF6\u53EF\u80FD\u53D8\u5316\uFF0C\u7ED3\u679C\u53CD\u6620\u672C\u6B21\u89C2\u5BDF\u65F6\u6BB5\uFF0C\u5E76\u975E\u56FA\u5B9A\u5FEB\u7167\u3002",
  storageIssues: "\u626B\u63CF\u8BF4\u660E",
  storageOtherIssue: "\u90E8\u5206\u6761\u76EE\u65E0\u6CD5\u7EDF\u8BA1\uFF08{code}\uFF09\u3002",
  storageIssueTime: "\u5DF2\u8FBE\u5230\u65F6\u95F4\u4E0A\u9650",
  storageIssueEntries: "\u5DF2\u8FBE\u5230\u6761\u76EE\u6570\u91CF\u4E0A\u9650",
  storageIssueDepth: "\u5DF2\u8FBE\u5230\u76EE\u5F55\u6DF1\u5EA6\u4E0A\u9650",
  storageIssueCancelled: "\u626B\u63CF\u5DF2\u53D6\u6D88",
  storageIssueLink: "\u5DF2\u8DF3\u8FC7\u7B26\u53F7\u94FE\u63A5",
  storageIssueDevice: "\u5DF2\u8DF3\u8FC7\u5176\u4ED6\u5377",
  storageIssueSpecial: "\u5DF2\u8DF3\u8FC7\u7279\u6B8A\u6587\u4EF6",
  storageIssueChanged: "\u626B\u63CF\u671F\u95F4\u6587\u4EF6\u6216\u76EE\u5F55\u53D1\u751F\u53D8\u5316",
  storageIssueUnreadable: "\u65E0\u6CD5\u8BFB\u53D6\u6587\u4EF6\u6216\u76EE\u5F55",
  storageIssueRoot: "\u5B58\u50A8\u4F4D\u7F6E\u4E0D\u53EF\u7528",
  storageIssueSize: "\u65E0\u6CD5\u7CBE\u786E\u8868\u793A\u6587\u4EF6\u5927\u5C0F",
  storageIssueMemory: "\u6B64\u7D22\u5F15\u5B58\u4E8E\u5185\u5B58\uFF0C\u6CA1\u6709\u53EF\u7EDF\u8BA1\u7684\u78C1\u76D8\u6587\u4EF6\u3002",
  storageSkipped: "\u8DF3\u8FC7\u6216\u65E0\u6CD5\u786E\u8BA4\u7684\u6761\u76EE",
  storageCounterSymlinks: "\u7B26\u53F7\u94FE\u63A5 {n}",
  storageCounterUnreadable: "\u65E0\u6CD5\u8BFB\u53D6 {n}",
  storageCounterChanged: "\u53D1\u751F\u53D8\u5316 {n}",
  storageCounterUnsupported: "\u4E0D\u652F\u6301 {n}",
  storageCounterCrossDevice: "\u5176\u4ED6\u5377 {n}",
  storageCounterDepth: "\u6DF1\u5EA6\u9650\u5236 {n}",
  storageCounterHardlinks: "\u91CD\u590D\u786C\u94FE\u63A5 {n}",
  storageCounterPaths: "\u91CD\u590D\u8DEF\u5F84 {n}",
  storageCounterExcluded: "\u5DF2\u5355\u72EC\u5206\u7C7B\u7684\u8DEF\u5F84 {n}",
  storageCategorySessions: "\u4F1A\u8BDD\u65E5\u5FD7",
  storageCategoryTrash: "\u56DE\u6536\u7AD9",
  storageCategoryStaging: "\u64CD\u4F5C\u6682\u5B58",
  storageCategoryReceipts: "\u64CD\u4F5C\u56DE\u6267",
  storageCategoryOperations: "\u64CD\u4F5C\u8BB0\u5F55",
  storageCategoryAttachments: "\u9644\u4EF6",
  storageCategoryCache: "DSH \u7F13\u5B58",
  storageCategoryAttachmentCache: "\u9644\u4EF6\u7F13\u5B58",
  storageCategorySpill: "\u6EA2\u51FA\u6587\u4EF6",
  storageCategorySettings: "DSH \u8BBE\u7F6E",
  storageCategoryWorkspace: "\u5DE5\u4F5C\u533A\u6587\u4EF6",
  storageCategoryProfiles: "\u63D2\u4EF6\u73AF\u5883",
  storageCategorySearch: "\u641C\u7D22\u7D22\u5F15",
  storageCategoryOther: "\u5176\u4ED6 DSH \u6587\u4EF6"
};
function localizeReason(code, message, t) {
  const keys = {
    active: "reasonActive",
    busy: "reasonBusy",
    "host-loaded": "reasonLoaded",
    "ambiguous-lifecycle": "reasonLifecycle",
    "release-failed": "reasonRelease",
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
    "store-busy": "reasonStoreBusy",
    "update-in-progress": "updateWaiting",
    "update-restart-required": "updateRestart"
  };
  const key = code ? keys[code] : void 0;
  return key ? t(key) : message;
}
function supportReason(status, t) {
  const message = status.reason;
  if (!message) return t("reasonCapabilities");
  if (message.startsWith("Only macOS")) return t("reasonPlatform");
  if (message.startsWith("DSH Desktop ") && message.includes(" is required;")) return t("reasonVersion", { required: SUPPORTED_DSH_VERSION, current: status.version });
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
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "dad-alert dad-error", role: "alert", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: message }),
    !error.uncertain && error.code !== "preview-expired" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { children: t("errorDetails") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: localizeReason(error.code, error.message, t) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: error.code })
    ] }),
    error.uncertain && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { size: "sm", variant: "outline", onClick: onRefresh, disabled, children: t("refresh") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { size: "sm", variant: "outline", onClick: onRetry, disabled, children: t("retryRequest") })
    ] })
  ] });
}
function ArchiveIcon({ trash = false }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", children: trash ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_jsx_runtime2.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" }) }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_jsx_runtime2.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M4 5h16v4H4zM6 9v11h12V9M10 13h4" }) }) });
}
function EmptyState({ tab, t }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-empty", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dad-empty-icon", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ArchiveIcon, { trash: tab === "trash" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: t(tab === "archived" ? "noArchives" : "noTrash") }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: t(tab === "archived" ? "emptyArchivesHint" : "emptyTrashHint") })
  ] });
}
function storageCategoryTitle(category, t) {
  const names = {
    sessions: "storageCategorySessions",
    "session-logs": "storageCategorySessions",
    trash: "storageCategoryTrash",
    staging: "storageCategoryStaging",
    receipts: "storageCategoryReceipts",
    operations: "storageCategoryOperations",
    attachments: "storageCategoryAttachments",
    cache: "storageCategoryCache",
    "attachment-cache": "storageCategoryAttachmentCache",
    spill: "storageCategorySpill",
    settings: "storageCategorySettings",
    workspace: "storageCategoryWorkspace",
    profiles: "storageCategoryProfiles",
    search: "storageCategorySearch",
    other: "storageCategoryOther"
  };
  const key = names[category.kind];
  return category.kind === "workspace" && category.label ? category.label : t(key ?? "storageCategoryOther");
}
function storageIssue(code, t) {
  const keys = {
    "time-budget": "storageIssueTime",
    "entry-budget": "storageIssueEntries",
    "depth-limit": "storageIssueDepth",
    cancelled: "storageIssueCancelled",
    "link-skipped": "storageIssueLink",
    "cross-device-skipped": "storageIssueDevice",
    "special-file-skipped": "storageIssueSpecial",
    "entry-changed": "storageIssueChanged",
    "entry-disappeared": "storageIssueChanged",
    "directory-changed": "storageIssueChanged",
    "path-redirected": "storageIssueChanged",
    "root-changed": "storageIssueChanged",
    "entry-unreadable": "storageIssueUnreadable",
    "directory-unreadable": "storageIssueUnreadable",
    "root-unresolved": "storageIssueRoot",
    "unsafe-root": "storageIssueRoot",
    ENOENT: "storageIssueRoot",
    "size-unrepresentable": "storageIssueSize",
    "aggregate-size-limit": "storageIssueSize",
    "in-memory": "storageIssueMemory"
  };
  return keys[code] ? t(keys[code]) : t("storageOtherIssue", { code });
}
var counterLabels = {
  symlinks: "storageCounterSymlinks",
  unreadable: "storageCounterUnreadable",
  changed: "storageCounterChanged",
  unsupported: "storageCounterUnsupported",
  crossDevice: "storageCounterCrossDevice",
  depthLimit: "storageCounterDepth",
  duplicateHardlinks: "storageCounterHardlinks",
  duplicatePaths: "storageCounterPaths",
  excluded: "storageCounterExcluded"
};
function StorageResultContent({ result, t }) {
  const categories = result.categories.toSorted((a, b) => (b.fileBytes ?? -1) - (a.fileBytes ?? -1));
  const maxBytes = Math.max(1, ...categories.map((category) => category.fileBytes ?? 0));
  const measured = result.categories.some((category) => category.fileBytes !== null);
  const workspace = result.workspaces.find((item) => item.id === result.workspaceId);
  const statusKeys = { complete: "storageCategoryComplete", partial: "storageCategoryPartial", missing: "storageMissing", unavailable: "storageCategoryUnavailable" };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-storage-result", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "dad-storage-total", "aria-label": t("storageMeasured"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-storage-total-heading", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: result.scope === "host" ? t("storageHost") : workspace?.title || t("storageWorkspace") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dad-badge", children: t(result.complete ? "storageComplete" : "storagePartial") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dad-muted", children: t("storageMeasured") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { className: "dad-storage-size", children: measured ? formatBytes(result.fileBytes) : t("storageUnknown") }),
      measured && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: t("storageFiles", { unique: result.uniqueFileCount, paths: result.fileCount }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-hint", children: t("storageMetric") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("time", { dateTime: isoTime(result.finishedAt), className: "dad-hint", children: t("storageObserved", { time: formatTime(result.finishedAt), duration: Math.round(result.durationMs) }) }),
      !result.complete && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-storage-partial", role: "status", children: t("storagePartialHint") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { "aria-label": t("storageBreakdown"), className: "dad-storage-categories", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { children: t("storageBreakdown") }),
      categories.map((category) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("article", { className: "dad-storage-category", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-storage-category-heading", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: storageCategoryTitle(category, t) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dad-storage-category-size", children: category.fileBytes === null ? t("storageUnknown") : formatBytes(category.fileBytes) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dad-badge", children: t(statusKeys[category.status]) })
        ] }),
        category.fileBytes !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dad-storage-bar", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { width: `${Math.min(100, category.fileBytes / maxBytes * 100)}%` } }) }),
        category.fileBytes !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-hint", children: t("storageFiles", { unique: category.uniqueFileCount, paths: category.fileCount }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: "dad-storage-details", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { children: t("storageDetails") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h4", { children: t("storageLargest") }),
          category.largestFiles.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-hint", children: t("storageNoFiles") }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "dad-storage-paths", children: category.largestFiles.map((file, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: file.relativePath }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: formatBytes(file.sizeBytes) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("small", { children: t("storageSource") })
          ] }, `${file.relativePath}-${index}`)) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h4", { children: t("storageDirectories") }),
          category.directories.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-hint", children: t("storageNoDirectories") }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "dad-storage-paths", children: category.directories.map((directory, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: directory.relativePath === "." ? t("storageRootFiles") : directory.relativePath }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: formatBytes(directory.fileBytes) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("small", { children: t("storageDirectoryFiles", { n: directory.fileCount }) })
          ] }, `${directory.relativePath}-${index}`)) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-hint", children: t("storageDirectoryMetric") }),
          Object.entries(counterLabels).some(([key]) => category.counters[key] > 0) && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h4", { children: t("storageSkipped") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "dad-storage-notes", children: Object.entries(counterLabels).filter(([key]) => category.counters[key] > 0).map(([key, label]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { children: t(label, { n: category.counters[key] }) }, key)) })
          ] }),
          category.issues.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h4", { children: t("storageIssues") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "dad-storage-notes", children: category.issues.map((issue, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { children: [
              storageIssue(issue.code, t),
              issue.relativePath && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
                " \xB7 ",
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: issue.relativePath })
              ] })
            ] }, index)) })
          ] })
        ] })
      ] }, category.id))
    ] }),
    result.categories.some((category) => category.overlaps.length > 0) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-hint", children: t("storageOverlap") }),
    (result.duplicateHardlinks > 0 || result.duplicatePaths > 0) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-hint", children: t("storageDeduplicated", { links: result.duplicateHardlinks, paths: result.duplicatePaths }) }),
    result.identityUnknown > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-hint", children: t("storageIdentity", { n: result.identityUnknown }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-hint", children: t("storageProvenance") }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-hint", children: t("storageNotSnapshot") }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-hint", children: t("storageWindow", { time: formatTime(result.startedAt) }) })
  ] });
}
function StorageContent({ state, workspaces: workspaces2, controller, supported, t, Button }) {
  const workspaceId = (0, import_react2.useId)();
  const available = supported && controller.storageAvailable;
  const errorKeys = {
    "scan-busy": "storageReasonBusy",
    "scan-closed": "storageReasonClosed",
    "workspace-changed": "storageReasonWorkspaceChanged",
    "workspace-not-found": "storageReasonWorkspaceMissing",
    "unsafe-workspace": "storageReasonUnsafeWorkspace",
    "scan-cancelled": "storageCancelled",
    "unsupported-host": "storageUnavailable"
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-storage", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-storage-intro", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: t("storageIntro") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dad-badge", children: t("storageReadOnly") })
    ] }),
    !available && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-alert", role: "status", children: t("storageUnavailable") }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-storage-controls", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "outline", disabled: !available || state.scanning, onClick: () => {
        void controller.scanStorage("host");
      }, children: t("storageHostScan") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-storage-workspace", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { htmlFor: workspaceId, children: t("storageWorkspace") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { id: workspaceId, value: state.workspaceId, disabled: !available, onChange: (event) => controller.setStorageWorkspace(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: t("storageWorkspaceChoose") }),
          workspaces2.map((workspace) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: workspace.id, children: workspace.title }, workspace.id))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "outline", disabled: !available || state.scanning || !workspaces2.some((workspace) => workspace.id === state.workspaceId), onClick: () => {
          void controller.scanStorage("workspace");
        }, children: t("storageWorkspaceScan") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-hint", children: t("storageWorkspaceHint") }),
    state.scanning && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-storage-scanning", role: "status", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("storageScanning") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { size: "sm", variant: "ghost", onClick: controller.cancelStorage, children: t("storageCancel") })
    ] }),
    state.cancelled && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-hint", role: "status", children: t("storageCancelled") }),
    state.error && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "dad-alert dad-error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: t("storageFailed") }),
      errorKeys[state.error.code] && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: t(errorKeys[state.error.code]) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { children: t("errorDetails") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: state.error.code })
      ] })
    ] }),
    state.result ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(StorageResultContent, { result: state.result, t }) : !state.scanning && !state.error && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-empty dad-storage-empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: t("storageEmpty") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: t("storageEmptyHint") })
    ] })
  ] });
}
function PreviewContent({ preview, t }) {
  const members = preview.items.reduce((sum, item) => sum + item.memberIds.length, 0);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-preview", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-summary", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: t("previewCount", { n: preview.items.length }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("previewMembers", { n: members }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: formatBytes(preview.items.reduce((sum, item) => sum + item.sizeBytes, 0)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "dad-preview-list", children: preview.items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-row-title", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: item.title || item.sessionId }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: `dad-pill dad-pill-${item.disposition}`, children: t(item.disposition === "ready" ? "ready" : item.disposition === "pending" ? "pendingPreview" : "blocked") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("memberCount", { n: item.memberIds.length }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: formatBytes(item.sizeBytes) })
      ] }),
      (item.disposition === "pending" || item.message) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-item-reason", children: item.disposition === "pending" ? t("pendingHint") : localizeReason(item.code, item.message, t) })
    ] }, item.id)) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: `dad-boundary${preview.action === "purge" ? " dad-boundary-danger" : ""}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dad-boundary-icon", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ArchiveIcon, { trash: preview.action === "purge" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: t("scopeTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: t("scope") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-expiry", children: t("expires", { time: formatTime(preview.expiresAt) }) })
  ] });
}
function ResultContent({ result, t, retry, disabled, Button }) {
  const hasProblems = result.counts.failed > 0 || result.counts.skipped > 0;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: "dad-results", "aria-label": t("result"), open: hasProblems || void 0, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("summary", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dad-result-label", children: t("result") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: hasProblems ? "dad-result-summary dad-result-attention" : "dad-result-summary", role: "status", children: t("resultSummary", result.counts) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dad-result-disclosure", "aria-label": t("resultDetails"), children: "\u2304" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { children: result.items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: item.title || item.id }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: `dad-result-status dad-result-${item.status}`, children: t(`status.${item.status}`) }),
        item.message && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: localizeReason(item.code, item.message, t) })
      ] }),
      item.status === "failed" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { size: "sm", variant: "outline", disabled, onClick: () => retry(item.id), children: t("retry") })
    ] }, item.id)) })
  ] });
}
function ArchiveDialog({ controller, primitives, t, updates }) {
  const state = (0, import_react2.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ArchiveDialogView, { state, controller, primitives, t, ...updates ? { updates } : {} });
}
function ArchiveDialogView({ state, controller, primitives, t, updates }) {
  const { Button, Checkbox, Modal } = primitives;
  const tabsId = (0, import_react2.useId)();
  const tabs = ["archived", "trash", "storage"];
  const tabRefs = (0, import_react2.useRef)([]);
  const backAnchor = (0, import_react2.useRef)(null);
  const selected = visibleSelection(state);
  const selectedSet = new Set(selected);
  const eligibleIds = selectableIds(state);
  const pages = pageCount(state);
  const supported = state.overview?.support.supported === true;
  const uncertain = state.uncertainRequest;
  const locked = state.busy || state.loading || uncertain || state.maintenance;
  const preview = state.preview;
  const previewId = preview?.id;
  const archivedItems = sortedItems(state.overview?.archived ?? [], state.sort);
  const trashItems = sortedItems(state.overview?.trash ?? [], state.sort);
  const result = state.result ?? state.overview?.recentResults[0] ?? null;
  const actionTitle = { trash: "moveTitle", restore: "restoreTitle", purge: "purgeTitle" };
  const actionDescription = { trash: "moveDescription", restore: "restoreDescription", purge: "purgeDescription" };
  const actionConfirm = { trash: "confirmTrash", restore: "confirmRestore", purge: "confirmPurge" };
  (0, import_react2.useEffect)(() => {
    if (!state.open) return;
    if (previewId) backAnchor.current?.querySelector("button")?.focus();
    else tabRefs.current[["archived", "trash", "storage"].indexOf(state.tab)]?.focus();
  }, [state.open, previewId, state.tab]);
  const changeTab = (tab, focus = false) => {
    controller.setTab(tab);
    if (focus) tabRefs.current[tabs.indexOf(tab)]?.focus();
  };
  const footer = preview ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { ref: backAnchor, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "outline", disabled: state.busy || uncertain, onClick: controller.dismissPreview, "data-modal-autofocus": "", children: t("back") }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: preview.action === "purge" ? "outline" : "primary", className: preview.action === "purge" ? "dad-danger" : void 0, disabled: locked || !supported || !canExecutePreview(preview), onClick: () => {
      void controller.confirm();
    }, children: t(actionConfirm[preview.action]) })
  ] }) : state.tab === "storage" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "outline", onClick: controller.close, children: t("close") }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dad-selection", "aria-live": "polite", children: t("selected", { n: selected.length }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "outline", onClick: controller.close, children: t("close") }),
    state.tab === "archived" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "primary", disabled: locked || !supported || selected.length === 0, onClick: () => {
      void controller.preview("trash");
    }, children: t("moveSelected") }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "outline", disabled: locked || !supported || selected.length === 0, onClick: () => {
        void controller.preview("restore");
      }, children: t("restoreSelected") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { variant: "outline", className: "dad-danger", disabled: locked || !supported || selected.length === 0, onClick: () => {
        void controller.preview("purge");
      }, children: t("purgeSelected") })
    ] })
  ] });
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Modal, { open: state.open, onClose: controller.close, title: preview ? t(actionTitle[preview.action]) : t("title"), description: preview ? t(actionDescription[preview.action]) : state.tab === "storage" ? t("storageIntro") : t("intro"), closeLabel: t("close"), className: "dad-dialog", contentClassName: "dad-content", footer, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-shell", children: [
    updates && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(UpdateCard, { controller: updates, Button, t, archiveBusy: state.busy || state.loading || uncertain }),
    state.maintenance && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-muted", role: "status", children: t("updateWaiting") }),
    state.error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ErrorNotice, { error: uncertain ? { ...state.error, uncertain: true } : state.error, t, onRefresh: () => {
      void controller.refresh();
    }, onRetry: () => {
      void controller.retryUncertain();
    }, disabled: state.busy || state.loading, Button }),
    state.overview && !supported && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "dad-alert", role: "status", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: t("unsupported") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: supportReason(state.overview.support, t) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("small", { children: t("supportDetails", { version: state.overview.support.version, platform: state.overview.support.platform }) })
    ] }),
    state.busy && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-progress", role: "status", children: t("working") }),
    preview ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(PreviewContent, { preview, t }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-toolbar", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dad-tabs", role: "tablist", "aria-label": t("title"), onKeyDown: (event) => {
          if (locked) return;
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = tabs.indexOf(state.tab);
          changeTab(event.key === "Home" ? "archived" : event.key === "End" ? "storage" : tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length], true);
        }, children: tabs.map((tab, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { ref: (element) => {
          tabRefs.current[index] = element;
        }, type: "button", role: "tab", id: `${tabsId}-${tab}`, "aria-controls": `${tabsId}-panel`, "aria-selected": state.tab === tab, tabIndex: state.tab === tab ? 0 : -1, disabled: locked, "data-modal-autofocus": state.tab === tab ? "" : void 0, onClick: () => changeTab(tab), children: [
          t(tab),
          tab !== "storage" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dad-count", children: state.overview?.[tab].length ?? 0 })
        ] }, tab)) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { size: "sm", variant: "outline", disabled: state.loading || state.busy, onClick: () => {
          void controller.refresh();
        }, children: t(state.tab === "storage" ? "storageRefreshWorkspaces" : "refresh") })
      ] }),
      state.tab === "storage" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { role: "tabpanel", id: `${tabsId}-panel`, "aria-labelledby": `${tabsId}-storage`, "aria-busy": state.storage.scanning, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(StorageContent, { state: state.storage, workspaces: state.overview?.storageWorkspaces ?? [], controller, supported, t, Button }) }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-list-heading", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Checkbox, { checked: eligibleIds.length > 0 && selected.length === eligibleIds.length, disabled: locked || !supported || eligibleIds.length === 0, onChange: controller.selectAll, label: t("selectAll", { n: eligibleIds.length }) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "dad-sort", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("sort") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { value: state.sort, disabled: locked, onChange: (event) => controller.setSort(event.target.value), children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "default", children: t("sortDefault") }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "size-desc", children: t("sortSize") })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dad-retention", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { "aria-hidden": "true", children: "\u25F7" }),
            t("retention")
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { role: "tabpanel", id: `${tabsId}-panel`, "aria-labelledby": `${tabsId}-${state.tab}`, "aria-busy": state.loading, className: "dad-list", children: [
          state.loading && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "status", children: t("loading") }),
          !state.loading && state.overview && state.overview[state.tab].length === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(EmptyState, { tab: state.tab, t }),
          state.tab === "archived" ? pageItems(archivedItems, state.page).map((item) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-row", "data-selected": selectedSet.has(item.id), "data-pending": item.pending === true, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-row-main", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Checkbox, { checked: selectedSet.has(item.id), disabled: locked || !supported || item.pending === true, onChange: () => controller.toggle(item.id), label: item.title || item.id }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-meta", children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dad-workspace", children: item.workspace || t("ungrouped") }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: formatBytes(item.sizeBytes) }),
                item.descendantCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dad-badge", children: t("childCount", { n: item.descendantCount }) }),
                item.pending && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dad-badge dad-badge-pending", children: t("pending") })
              ] }),
              item.pending && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-pending", children: t("pendingHint") })
            ] }),
            item.pending && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-row-actions", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { size: "sm", variant: "outline", disabled: locked || !supported, onClick: () => {
                void controller.reviewPending(item.id);
              }, children: t("reviewPending") }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { size: "sm", variant: "ghost", disabled: locked || !supported, onClick: () => {
                void controller.cancelPending([item.id]);
              }, children: t("cancelPending") })
            ] })
          ] }, item.id)) : pageItems(trashItems, state.page).map((item) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dad-row", "data-selected": selectedSet.has(item.id), children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-row-main", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Checkbox, { checked: selectedSet.has(item.id), disabled: locked || !supported, onChange: () => controller.toggle(item.id), label: item.title || item.sessionId }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-meta", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("time", { dateTime: isoTime(item.trashedAt), children: formatTime(item.trashedAt) }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: formatBytes(item.sizeBytes) }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dad-badge", children: t("memberCount", { n: item.memberCount }) })
            ] })
          ] }) }, item.id))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dad-list-foot", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-hint", children: t(state.tab === "archived" ? "archivedHint" : "trashHint") }),
          pages > 1 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("nav", { className: "dad-pagination", "aria-label": t("pages"), children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { size: "sm", variant: "ghost", disabled: locked || state.page === 0, onClick: () => controller.setPage(state.page - 1), children: t("previousPage") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("pageNumber", { page: state.page + 1, pages }) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Button, { size: "sm", variant: "ghost", disabled: locked || state.page + 1 >= pages, onClick: () => controller.setPage(state.page + 1), children: t("nextPage") })
          ] })
        ] }),
        result && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ResultContent, { result, t, retry: (id) => {
          void controller.retryItem(id);
        }, disabled: locked || !supported, Button })
      ] })
    ] }),
    (state.busy || uncertain) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dad-muted", children: t("operationContinues") })
  ] }) });
}
var CLIENT_CSS = UPDATE_CSS + `
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
.dad-pending{margin:6px 0 0 25px!important;color:var(--dad-muted);font-size:11px;line-height:1.5}.dad-row-actions{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;margin-top:1px}.dad-row-actions>button{max-width:190px;white-space:normal;text-align:right}
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
.dad-sort{display:flex;align-items:center;gap:6px;margin-left:auto}.dad-shell select{max-width:100%;min-height:30px;padding:4px 26px 4px 8px;border:1px solid var(--dad-border);border-radius:7px;background:var(--dsw-alias-bg-base,Canvas);color:var(--dad-primary);font:inherit}.dad-shell select:focus-visible{outline:2px solid var(--dsw-alias-button-primary-bg,#2878e0);outline-offset:2px}.dad-shell select:disabled{opacity:.55}
.dad-storage,.dad-storage-result,.dad-storage-categories{display:flex;flex-direction:column;gap:12px}.dad-storage-intro{display:flex;align-items:flex-start;gap:12px;justify-content:space-between;font-size:12px;color:var(--dad-muted)}.dad-storage-intro>.dad-badge{flex-shrink:0}.dad-storage-controls{display:flex;flex-direction:column;align-items:flex-start;gap:12px;padding:12px;border:1px solid var(--dad-border);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#88805)}.dad-storage-workspace{display:flex;align-items:center;gap:8px;width:100%;min-width:0;flex-wrap:wrap}.dad-storage-workspace label{font-size:12px;color:var(--dad-muted)}.dad-storage-workspace select{flex:1;min-width:120px;max-width:330px}.dad-storage-workspace button{flex-shrink:0}.dad-storage-scanning{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--dad-muted)}.dad-storage-empty{min-height:100px}
.dad-storage-total{display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:15px 16px;border:1px solid var(--dad-border);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#88805);font-size:12px}.dad-storage-total-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;margin-bottom:7px;font-weight:500}.dad-storage-total-heading>span:first-child{min-width:0;overflow-wrap:anywhere}.dad-storage-size{font-size:28px;font-weight:600;letter-spacing:-.5px;font-variant-numeric:tabular-nums}.dad-storage-partial{border-left:2px solid var(--dsw-alias-status-warning,#b48228);padding-left:8px;font-size:11px;color:var(--dad-muted)}.dad-storage-categories h3{font-size:12px;font-weight:600}.dad-storage-category{padding:12px;border:1px solid var(--dad-border);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#88805)}.dad-storage-category-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px}.dad-storage-category-heading>strong{flex:1;font-size:12px;font-weight:500;overflow-wrap:anywhere}.dad-storage-category-size{font-size:12px;font-variant-numeric:tabular-nums}.dad-storage-bar{height:5px;overflow:hidden;border-radius:4px;background:color-mix(in srgb,var(--dad-primary) 7%,transparent);margin-bottom:7px}.dad-storage-bar>span{display:block;height:100%;min-width:0;border-radius:inherit;background:var(--dsw-alias-button-primary-bg,#2878e0);opacity:.6}
.dad-storage-details{margin-top:9px;font-size:11px}.dad-storage-details summary{color:var(--dad-muted);cursor:pointer}.dad-storage-details summary:focus-visible{outline:2px solid var(--dsw-alias-button-primary-bg,#2878e0);outline-offset:2px;border-radius:3px}.dad-storage-details h4{margin:12px 0 5px;font-size:11px;font-weight:600}.dad-storage-paths,.dad-storage-notes{list-style:none;margin:0;padding:0}.dad-storage-paths li{display:flex;align-items:baseline;gap:5px 10px;flex-wrap:wrap;border-bottom:1px solid var(--dad-border);padding:6px 0}.dad-storage-paths li:last-child{border-bottom:0}.dad-storage-paths code{flex:1;min-width:100px;overflow-wrap:anywhere;font-size:11px}.dad-storage-paths small{width:100%;color:var(--dad-muted);font-size:10px}.dad-storage-paths li>span{font-variant-numeric:tabular-nums}.dad-storage-notes{color:var(--dad-muted)}.dad-storage-notes li{padding:2px 0;overflow-wrap:anywhere}.dad-storage-notes code{font-size:10px}
@media(prefers-reduced-motion:reduce){.dad-row,.dad-result-disclosure{transition:none}}
@media(max-width:560px){.dad-dialog{width:calc(100vw - 20px);max-width:calc(100vw - 20px)}.dad-content{max-height:65vh}.dad-toolbar{gap:8px}.dad-tabs button{padding:6px 9px}.dad-row{padding:10px;gap:8px}.dad-row-title{flex-wrap:wrap;gap:6px}.dad-list-foot{flex-direction:column;gap:6px}.dad-retention{font-size:10px}.dad-results summary{flex-wrap:wrap;gap:4px 9px}.dad-result-summary{flex-basis:75%}.dad-result-disclosure{margin-left:auto}.dad-workspace{max-width:100%}}
@media(max-width:560px){.dad-row[data-pending=true]{flex-wrap:wrap}.dad-row-actions{width:100%;flex-direction:row;flex-wrap:wrap;justify-content:flex-end}.dad-row-actions>button{max-width:100%}}
@media(max-width:560px){.dad-toolbar{flex-wrap:wrap}.dad-tabs{max-width:100%;flex:1}.dad-tabs button{justify-content:center;gap:5px;padding:6px 8px;flex:1;font-size:12px}.dad-list-heading{flex-wrap:wrap}.dad-sort{font-size:11px}.dad-retention{width:100%;justify-content:flex-end}.dad-storage-workspace{align-items:stretch}.dad-storage-workspace label{width:100%}.dad-storage-workspace select{min-width:0;max-width:none;width:100%;flex-basis:100%}.dad-storage-workspace button{width:100%}.dad-storage-total-heading{align-items:flex-start}.dad-storage-category-heading>.dad-badge{font-size:9px}}
`;

// src/update-client.ts
var UpdateClientController = class {
  constructor(api, archive, createId = () => globalThis.crypto.randomUUID()) {
    this.api = api;
    this.archive = archive;
    this.createId = createId;
  }
  state = { data: null, checking: false, installing: false, reviewId: null, error: null, uncertain: false };
  listeners = /* @__PURE__ */ new Set();
  disposed = false;
  checkGeneration = 0;
  checking;
  confirmation;
  interval;
  statusTimer;
  statusAttempts = 0;
  get available() {
    return typeof this.api.updates === "function" && typeof this.api.installUpdate === "function";
  }
  getSnapshot = () => this.state;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  start() {
    if (!this.available || this.disposed || this.interval) return;
    void this.check();
    this.interval = setInterval(() => {
      void this.check();
    }, 15 * 6e4);
    this.interval.unref?.();
  }
  update(patch) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  accept(data) {
    const installation = data.installation;
    const settled = this.confirmation && installation?.requestId === this.confirmation.requestId && ["installed", "restart-required", "failed", "interrupted"].includes(installation.status);
    const protectedState = data.currentVersion !== data.installedVersion || installation?.status === "installing" || Boolean(this.confirmation && !settled && this.state.uncertain) || installation?.status === "restart-required" || installation?.status === "unknown";
    this.archive.setMaintenance(protectedState);
    this.update({
      data,
      reviewId: this.state.reviewId === data.candidate?.id && data.availability === "available" ? this.state.reviewId : null,
      ...settled ? { uncertain: false, installing: false, error: null } : {}
    });
    if (settled) this.confirmation = void 0;
  }
  scheduleStatus() {
    const waiting = this.state.uncertain || this.state.data?.installation?.status === "installing";
    if (!waiting) {
      if (this.statusTimer) clearTimeout(this.statusTimer);
      this.statusTimer = void 0;
      this.statusAttempts = 0;
      return;
    }
    if (this.disposed || this.statusTimer || this.statusAttempts >= 10) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = void 0;
      this.statusAttempts++;
      void this.check();
    }, 3e3);
    this.statusTimer.unref?.();
  }
  async check(force = false) {
    if (this.disposed || !this.api.updates || this.state.installing) return;
    if (this.checking) return this.checking;
    const generation = ++this.checkGeneration;
    this.update({ checking: true, error: null });
    const task = (async () => {
      try {
        const data = await this.api.updates(force);
        if (generation !== this.checkGeneration || this.disposed) return;
        this.accept(data);
      } catch (error) {
        if (generation !== this.checkGeneration || this.disposed) return;
        this.update({ error: error instanceof ArchiveError ? error.code : "update-service-unavailable" });
      } finally {
        if (generation === this.checkGeneration) {
          this.update({ checking: false });
          this.scheduleStatus();
        }
      }
    })();
    this.checking = task;
    void task.finally(() => {
      if (this.checking === task) this.checking = void 0;
    }).catch(() => {
    });
    return task;
  }
  review = () => {
    const data = this.state.data;
    const archive = this.archive.getSnapshot();
    if (!data?.candidate || data.availability !== "available" || !data.canInstall || this.state.error || this.state.checking || this.state.installing || this.state.uncertain || archive.busy || archive.loading || archive.uncertainRequest || archive.maintenance) return;
    this.update({ reviewId: data.candidate.id, error: null });
  };
  cancelReview = () => {
    if (!this.state.installing) this.update({ reviewId: null });
  };
  async confirm() {
    const data = this.state.data;
    const archive = this.archive.getSnapshot();
    if (!this.api.installUpdate || !data?.candidate || this.state.reviewId !== data.candidate.id || data.availability !== "available" || !data.canInstall || this.state.error || this.state.installing || this.state.checking || this.state.uncertain || archive.busy || archive.loading || archive.uncertainRequest || archive.maintenance) return;
    this.confirmation = { candidateId: data.candidate.id, requestId: this.createId() };
    await this.install();
  }
  async retry() {
    if (!this.state.installing && this.state.uncertain && this.confirmation) await this.install();
  }
  async install() {
    const confirmation = this.confirmation;
    if (!confirmation || !this.api.installUpdate || this.disposed) return;
    this.checkGeneration++;
    this.archive.setMaintenance(true);
    this.update({ installing: true, checking: false, error: null, reviewId: null });
    try {
      const data = await this.api.installUpdate(confirmation.candidateId, confirmation.requestId);
      if (this.disposed) return;
      if (!data.installation || data.installation.requestId !== confirmation.requestId) throw new ClientTransportError("The update outcome was not recorded.");
      this.accept(data);
      this.update({ installing: false, uncertain: data.installation.status === "installing" || data.installation.status === "unknown" });
    } catch (error) {
      if (this.disposed) return;
      const uncertain = !(error instanceof ArchiveError);
      if (!uncertain) {
        this.confirmation = void 0;
        this.archive.setMaintenance(/^update-(in-progress|restart-required)$/.test(error.code));
      }
      this.update({ installing: false, uncertain, error: uncertain ? "update-outcome-unknown" : error.code });
    } finally {
      this.scheduleStatus();
    }
  }
  dispose() {
    this.disposed = true;
    this.checkGeneration++;
    if (this.interval) clearInterval(this.interval);
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.listeners.clear();
  }
};

// src/client.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function count(value) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function workspaces(value) {
  return Array.isArray(value) && value.every((item) => object(item) && typeof item.id === "string" && typeof item.title === "string");
}
function relativePath(value) {
  return typeof value === "string" && value.length > 0 && !/^[/\\]|^[a-z]:/i.test(value) && !value.split(/[/\\]/).includes("..");
}
function isOverview(value) {
  return object(value) && object(value.support) && typeof value.support.supported === "boolean" && typeof value.support.version === "string" && typeof value.support.platform === "string" && Array.isArray(value.archived) && value.archived.every((item) => object(item) && typeof item.id === "string" && typeof item.title === "string" && typeof item.workspace === "string" && finite(item.sizeBytes) && finite(item.descendantCount)) && Array.isArray(value.trash) && value.trash.every((item) => object(item) && typeof item.id === "string" && typeof item.sessionId === "string" && typeof item.title === "string" && finite(item.trashedAt) && finite(item.sizeBytes) && finite(item.memberCount)) && Array.isArray(value.recentResults) && value.recentResults.every(isBatchResult) && (value.storageWorkspaces === void 0 || workspaces(value.storageWorkspaces));
}
function isStorageOverview(value) {
  if (!object(value) || value.metric !== "logical-file-bytes" || !["host", "workspace"].includes(String(value.scope)) || !workspaces(value.workspaces) || value.workspaceId !== void 0 && typeof value.workspaceId !== "string" || (value.scope === "workspace" ? !value.workspaceId : value.workspaceId !== void 0) || typeof value.complete !== "boolean" || !finite(value.durationMs) || value.durationMs < 0 || !["startedAt", "finishedAt", "fileBytes", "referencedBytes", "fileCount", "uniqueFileCount", "duplicateHardlinks", "duplicatePaths", "identityUnknown"].every((key) => count(value[key])) || !Array.isArray(value.categories)) return false;
  return value.categories.every((category) => object(category) && typeof category.id === "string" && typeof category.kind === "string" && (category.label === void 0 || typeof category.label === "string") && category.readOnly === true && ["complete", "partial", "missing", "unavailable"].includes(String(category.status)) && (category.fileBytes === null || count(category.fileBytes)) && (category.referencedBytes === null || count(category.referencedBytes)) && count(category.fileCount) && count(category.uniqueFileCount) && object(category.counters) && ["entries", "files", "directories", "symlinks", "unreadable", "changed", "unsupported", "crossDevice", "depthLimit", "duplicateHardlinks", "duplicatePaths", "identityUnknown", "excluded"].every((key) => count(category.counters[key])) && strings(category.overlaps) && Array.isArray(category.issues) && category.issues.every((issue) => object(issue) && typeof issue.code === "string" && (issue.relativePath === void 0 || relativePath(issue.relativePath))) && Array.isArray(category.largestFiles) && category.largestFiles.every((file) => object(file) && relativePath(file.relativePath) && count(file.sizeBytes) && file.source === "unknown") && Array.isArray(category.directories) && category.directories.every((directory) => object(directory) && relativePath(directory.relativePath) && count(directory.fileBytes) && count(directory.fileCount)));
}
function isPreview(value) {
  return object(value) && typeof value.id === "string" && ["trash", "restore", "purge"].includes(String(value.action)) && finite(value.expiresAt) && Array.isArray(value.items) && value.items.every((item) => object(item) && typeof item.id === "string" && typeof item.title === "string" && typeof item.sessionId === "string" && strings(item.memberIds) && finite(item.sizeBytes) && ["ready", "pending", "blocked"].includes(String(item.disposition)));
}
function isBatchResult(value) {
  return object(value) && typeof value.operationId === "string" && ["trash", "restore", "purge", "cancel"].includes(String(value.action)) && object(value.counts) && ["succeeded", "pending", "skipped", "failed"].every((key) => finite(value.counts[key])) && Array.isArray(value.items) && value.items.every((item) => object(item) && typeof item.id === "string" && typeof item.title === "string" && ["moved", "pending", "restored", "purged", "cancelled", "skipped", "failed"].includes(String(item.status)));
}
function isUpdateOverview(value) {
  const version = (v) => typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v);
  if (!object(value) || !version(value.currentVersion) || !version(value.installedVersion) || typeof value.hostVersion !== "string" || !["unknown", "current", "available", "incompatible", "error"].includes(String(value.availability)) || typeof value.canInstall !== "boolean" || value.checkedAt !== void 0 && !count(value.checkedAt) || value.nextCheckAt !== void 0 && !count(value.nextCheckAt) || value.code !== void 0 && typeof value.code !== "string") return false;
  if (value.candidate !== void 0) {
    const c = value.candidate;
    if (!object(c) || typeof c.id !== "string" || c.id.length > 512 || !version(c.version) || typeof c.requiredDshVersion !== "string" || typeof c.publishedAt !== "string" || typeof c.notes !== "string" || c.notes.length > 64e3 || !count(c.assetBytes) || c.releaseUrl !== `https://github.com/QwQBiG/dsh-archive-delete/releases/tag/v${c.version}`) return false;
  }
  if (value.availability === "available" && value.candidate === void 0) return false;
  if (value.installation !== void 0) {
    const i = value.installation;
    if (!object(i) || typeof i.requestId !== "string" || !version(i.version) || !["installing", "installed", "restart-required", "failed", "interrupted", "unknown"].includes(String(i.status)) || i.code !== void 0 && typeof i.code !== "string") return false;
  }
  return true;
}
function createArchiveApi(transport = globalThis.fetch.bind(globalThis), baseUri) {
  const base = baseUri ?? document.baseURI;
  const endpoint = new URL(API_PATH.replace(/^\//, ""), base).href;
  const request = async (body, accepts, signal) => {
    let response;
    try {
      response = await transport(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        ...signal ? { signal } : {}
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ClientTransportError("The connection to DSH was interrupted.");
    }
    let envelope;
    try {
      envelope = await response.json();
    } catch (error) {
      if (signal?.aborted) throw error;
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
    cancelPending: (ids, requestId) => request({ action: "cancelPending", ids, requestId }, isBatchResult),
    storage: (workspaceId, signal) => request({ action: "storage", ...workspaceId ? { workspaceId } : {} }, isStorageOverview, signal),
    updates: (force = false) => request({ action: "updates", force }, isUpdateOverview),
    installUpdate: (candidateId, requestId) => request({ action: "installUpdate", candidateId, requestId }, isUpdateOverview)
  };
}
function startClient(require2, apiFactory = () => createArchiveApi()) {
  const primitives = require2("@deepseek-ai/dsh-client-ui-primitives");
  return {
    name: "archive-delete-client",
    inject: ["slots", "locale", "workspaces"],
    apply(ctx) {
      const api = apiFactory();
      const controller = new ArchiveClientController(api);
      const updates = new UpdateClientController(api, controller);
      const disposers = [];
      ctx.effect(() => ctx.locale.register(CLIENT_NAMESPACE, { en, zh }), "archive-delete: locale");
      ctx.effect(() => {
        updates.start();
        return () => updates.dispose();
      }, "archive-delete: update checks");
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
        const subscribe = (0, import_react3.useCallback)((listener) => ctx.workspaces.list.subscribe(listener), []);
        const snapshot = (0, import_react3.useCallback)(() => ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId), [sessionId]);
        const archived = (0, import_react3.useSyncExternalStore)(subscribe, snapshot, snapshot);
        if (!archived) return null;
        return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(primitives.MenuItemButton, { separatorBefore: true, onSelect: () => {
          setMenuOpen(false);
          void controller.open(sessionId);
        }, children: t("menuTrash") });
      }
      function Overlay({ t }) {
        return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ArchiveDialog, { controller, primitives, t, updates });
      }
      function ConfigCard({ view, t }) {
        if (view === "summary") return null;
        return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dad-shell", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(primitives.Button, { variant: "outline", onClick: () => {
            void controller.open();
          }, children: t("manage") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(UpdateCard, { controller: updates, Button: primitives.Button, t })
        ] });
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

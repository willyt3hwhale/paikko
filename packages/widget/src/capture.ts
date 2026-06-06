/**
 * paikko client capture machinery.
 *
 * Everything the agent needs to reproduce a bug, captured at the moment the user
 * hits report. The guiding rule is "photograph, not live window": the buffers
 * (console, network) accumulate continuously while the app runs, but the storage
 * / client-state / DOM snapshots are taken on demand at report time, and the
 * whole thing is frozen into immutable {@link ArtifactPayload}s by
 * {@link snapshotArtifacts}.
 *
 * The frontend half of the trace spine lives here: every patched fetch/XHR mints
 * a {@link TraceId}, records it on its {@link NetworkEntry}, and propagates it as
 * the `x-paikko-trace` request header so the backend `withCapture()` wrapper can
 * stitch its {@link TraceRequest} back to this exact call.
 *
 * Shape note: every record produced here is built to the contract types and
 * validated through {@link ArtifactPayloadSchemas} before it leaves the client,
 * so the API only ever sees contract-valid payloads.
 */
import {
  type ConsoleArtifact,
  type ConsoleEntry,
  type NetworkArtifact,
  type NetworkEntry,
  type ClientStateArtifact,
  type StorageArtifact,
  type DomArtifact,
  type ScreenshotArtifact,
  type ReportTarget,
  type TraceId,
  ArtifactPayloadSchemas,
} from "@paikko/contract";

/* ------------------------------------------------------------------ */
/* Config                                                             */
/* ------------------------------------------------------------------ */

/** Header that carries the frontend trace id to the backend capture wrapper. */
export const TRACE_HEADER = "x-paikko-trace";

/** Header that carries the stable capture session id to the backend. */
export const SESSION_HEADER = "x-paikko-session";

/** sessionStorage key under which the stable session id is persisted. */
const SESSION_KEY = "paikko.sessionId";

/**
 * Mint (once) and return the stable capture session id for this browsing session.
 * Persisted in sessionStorage so every request and the final report bundle share
 * the same id - that is what lets the server drain exactly this session's buffered
 * backend requests into the `trace` artifact. Falls back to an in-memory id when
 * sessionStorage is unavailable (SSR, sandboxed contexts).
 */
let memorySessionId: string | null = null;
export function getSessionId(): string {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") {
    if (!memorySessionId) memorySessionId = genTraceId();
    return memorySessionId;
  }
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = genTraceId();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    if (!memorySessionId) memorySessionId = genTraceId();
    return memorySessionId;
  }
}

/** Provenance attribute injected at build time (see PROVENANCE.md). */
const SRC_ATTR = "data-src";
const COMPONENT_ATTR = "data-paikko-component";

export interface CaptureConfig {
  /** Console ring buffer capacity (lines kept, oldest evicted). */
  consoleBufferSize: number;
  /** Network ring buffer capacity (calls kept, oldest evicted). */
  networkBufferSize: number;
  /**
   * Reader for the mandated client-state store. The store is owned by another
   * seam, so capture depends on a getter rather than importing it directly.
   * Returns the snapshot object, or `{}` if no store is wired.
   */
  getClientState: () => Record<string, unknown>;
  /** Max serialized length of a captured request/response body, in chars. */
  maxBodyChars: number;
}

const DEFAULT_CONFIG: CaptureConfig = {
  consoleBufferSize: 200,
  networkBufferSize: 100,
  getClientState: () => ({}),
  maxBodyChars: 16_384,
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function now(): string {
  return new Date().toISOString();
}

/**
 * True when `url` resolves to the same origin as the page. Relative URLs are
 * same-origin by definition; absolute URLs are compared by origin. Used to gate
 * header injection: the paikko trace/session headers are custom request headers,
 * so adding them to a CROSS-origin request forces a CORS preflight that the
 * third party's `Access-Control-Allow-Headers` will reject - breaking the
 * consumer's cross-origin script/wasm/media loads. We therefore only inject on
 * same-origin calls (the consumer's own backend, which `withCapture()` wraps).
 * The cross-origin report POST sets the session header explicitly itself.
 */
function isSameOrigin(url: string): boolean {
  if (typeof window === "undefined" || !window.location) return true;
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    // Unparseable - treat as same-origin (relative-ish); never block the request.
    return true;
  }
}

function genTraceId(): TraceId {
  // crypto.randomUUID is available in all modern browsers; fall back just in case.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Best-effort serialize an arbitrary console arg / body to a JSON-able value. */
function safeSerialize(value: unknown, maxChars: number): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > maxChars ? value.slice(0, maxChars) + "…[truncated]" : value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      return v;
    });
    if (json === undefined) return String(value);
    const parsed = JSON.parse(json);
    // Bound size after the fact so we don't ship megabytes.
    if (json.length > maxChars) {
      return { __truncated: true, preview: json.slice(0, maxChars) };
    }
    return parsed;
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}

/** Format a console.* call's args into a single human-readable message line. */
function formatConsoleMessage(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* Capture core                                                       */
/* ------------------------------------------------------------------ */

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";
const CONSOLE_METHODS: ConsoleMethod[] = ["log", "info", "warn", "error", "debug"];

/**
 * The live capture controller. Construct once, call {@link install} on mount to
 * patch console/fetch/XHR, and call {@link snapshotArtifacts} at report time to
 * freeze the immutable payloads. {@link uninstall} restores the originals.
 */
export class Capture {
  private readonly config: CaptureConfig;

  private consoleBuffer: ConsoleEntry[] = [];
  private networkBuffer: NetworkEntry[] = [];

  private installed = false;
  private originalConsole: Partial<Record<ConsoleMethod, (...a: unknown[]) => void>> = {};
  private originalFetch: typeof fetch | null = null;
  private originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
  private originalXhrSend: typeof XMLHttpRequest.prototype.send | null = null;
  private originalXhrSetHeader: typeof XMLHttpRequest.prototype.setRequestHeader | null = null;

  constructor(config: Partial<CaptureConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /* ---- lifecycle ---- */

  install(): void {
    if (this.installed || typeof window === "undefined") return;
    this.installed = true;
    this.patchConsole();
    this.patchFetch();
    this.patchXhr();
  }

  uninstall(): void {
    if (!this.installed) return;
    this.installed = false;
    for (const m of CONSOLE_METHODS) {
      const orig = this.originalConsole[m];
      if (orig) (console as unknown as Record<string, unknown>)[m] = orig;
    }
    if (this.originalFetch) window.fetch = this.originalFetch;
    if (this.originalXhrOpen) XMLHttpRequest.prototype.open = this.originalXhrOpen;
    if (this.originalXhrSend) XMLHttpRequest.prototype.send = this.originalXhrSend;
    if (this.originalXhrSetHeader) {
      XMLHttpRequest.prototype.setRequestHeader = this.originalXhrSetHeader;
    }
    this.originalConsole = {};
    this.originalFetch = null;
    this.originalXhrOpen = null;
    this.originalXhrSend = null;
    this.originalXhrSetHeader = null;
  }

  /* ---- console ring buffer ---- */

  private patchConsole(): void {
    for (const method of CONSOLE_METHODS) {
      const original = console[method] as ((...a: unknown[]) => void) | undefined;
      if (!original) continue;
      this.originalConsole[method] = original.bind(console);
      (console as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        try {
          this.pushConsole(method, args);
        } catch {
          /* never let capture break the app's logging */
        }
        this.originalConsole[method]?.(...args);
      };
    }
  }

  private pushConsole(level: ConsoleMethod, args: unknown[]): void {
    const entry: ConsoleEntry = {
      level,
      message: formatConsoleMessage(args),
      args: args.map((a) => safeSerialize(a, this.config.maxBodyChars)),
      at: now(),
    };
    this.consoleBuffer.push(entry);
    if (this.consoleBuffer.length > this.config.consoleBufferSize) {
      this.consoleBuffer.splice(
        0,
        this.consoleBuffer.length - this.config.consoleBufferSize,
      );
    }
  }

  /* ---- network: fetch ---- */

  private patchFetch(): void {
    if (typeof window.fetch !== "function") return;
    this.originalFetch = window.fetch.bind(window);
    const original = this.originalFetch;
    const self = this;

    window.fetch = async function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const traceId = genTraceId();
      const method = (
        init?.method ??
        (input instanceof Request ? input.method : undefined) ??
        "GET"
      ).toUpperCase();
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      // Inject the trace/session headers ONLY on same-origin calls. Adding
      // custom headers to a cross-origin fetch forces a CORS preflight the third
      // party will reject, breaking the consumer's cross-origin loads; such a
      // request is still recorded below, just with its headers untouched.
      let callInit = init;
      if (isSameOrigin(url)) {
        const headers = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined),
        );
        headers.set(TRACE_HEADER, traceId);
        headers.set(SESSION_HEADER, getSessionId());
        callInit = { ...init, headers };
      }

      const reqBody = await self.readRequestBody(input, init);
      const startedAt = now();
      const startMs = performance.now();

      const entry: NetworkEntry = {
        traceId,
        method,
        url,
        status: null,
        reqBody,
        resBody: null,
        startedAt,
        durationMs: null,
      };
      self.pushNetwork(entry);

      try {
        const res = await original(input, callInit);
        entry.status = res.status;
        entry.durationMs = Math.round(performance.now() - startMs);
        // Clone so the app still consumes the body.
        entry.resBody = await self.readResponseBody(res.clone());
        return res;
      } catch (err) {
        entry.durationMs = Math.round(performance.now() - startMs);
        entry.resBody = safeSerialize(err, self.config.maxBodyChars);
        throw err;
      }
    };
  }

  private async readRequestBody(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<unknown> {
    try {
      const body =
        init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
      if (body == null) return null;
      if (typeof body === "string") {
        try {
          return safeSerialize(JSON.parse(body), this.config.maxBodyChars);
        } catch {
          return safeSerialize(body, this.config.maxBodyChars);
        }
      }
      // FormData / Blob / etc. - record a marker rather than the raw object.
      return `[${(body as object).constructor?.name ?? typeof body}]`;
    } catch {
      return null;
    }
  }

  private async readResponseBody(res: Response): Promise<unknown> {
    try {
      const ct = res.headers.get("content-type") ?? "";
      const text = await res.text();
      if (!text) return null;
      if (ct.includes("application/json")) {
        try {
          return safeSerialize(JSON.parse(text), this.config.maxBodyChars);
        } catch {
          return safeSerialize(text, this.config.maxBodyChars);
        }
      }
      return safeSerialize(text, this.config.maxBodyChars);
    } catch {
      return null;
    }
  }

  /* ---- network: XHR ---- */

  private patchXhr(): void {
    if (typeof XMLHttpRequest === "undefined") return;
    const self = this;
    const proto = XMLHttpRequest.prototype;

    this.originalXhrOpen = proto.open;
    this.originalXhrSend = proto.send;
    this.originalXhrSetHeader = proto.setRequestHeader;

    const META = Symbol.for("paikko.xhr.meta");
    type Meta = {
      traceId: TraceId;
      method: string;
      url: string;
      entry?: NetworkEntry;
      startMs?: number;
      headerInjected?: boolean;
    };

    const openOrig = this.originalXhrOpen;
    proto.open = function open(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      const meta: Meta = {
        traceId: genTraceId(),
        method: method.toUpperCase(),
        url: url.toString(),
      };
      (this as unknown as Record<symbol, Meta>)[META] = meta;
      // @ts-expect-error - forward through to the native signature
      return openOrig.call(this, method, url, ...rest);
    };

    const setHeaderOrig = this.originalXhrSetHeader;
    proto.setRequestHeader = function setRequestHeader(
      this: XMLHttpRequest,
      name: string,
      value: string,
    ) {
      return setHeaderOrig.call(this, name, value);
    };

    const sendOrig = this.originalXhrSend;
    proto.send = function send(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const meta = (this as unknown as Record<symbol, Meta>)[META];
      if (meta) {
        try {
          // Same-origin only - see isSameOrigin: custom headers on a cross-origin
          // XHR trip a CORS preflight the third party rejects.
          if (!meta.headerInjected && isSameOrigin(meta.url)) {
            setHeaderOrig.call(this, TRACE_HEADER, meta.traceId);
            setHeaderOrig.call(this, SESSION_HEADER, getSessionId());
            meta.headerInjected = true;
          }
        } catch {
          /* setRequestHeader can throw if state is wrong; ignore */
        }
        const entry: NetworkEntry = {
          traceId: meta.traceId,
          method: meta.method,
          url: meta.url,
          status: null,
          reqBody: self.serializeXhrBody(body),
          resBody: null,
          startedAt: now(),
          durationMs: null,
        };
        meta.entry = entry;
        meta.startMs = performance.now();
        self.pushNetwork(entry);

        this.addEventListener("loadend", () => {
          if (!meta.entry) return;
          meta.entry.status = this.status || null;
          meta.entry.durationMs =
            meta.startMs != null ? Math.round(performance.now() - meta.startMs) : null;
          meta.entry.resBody = self.readXhrResponse(this);
        });
      }
      return sendOrig.call(this, body ?? null);
    };
  }

  private serializeXhrBody(body?: Document | XMLHttpRequestBodyInit | null): unknown {
    if (body == null) return null;
    if (typeof body === "string") {
      try {
        return safeSerialize(JSON.parse(body), this.config.maxBodyChars);
      } catch {
        return safeSerialize(body, this.config.maxBodyChars);
      }
    }
    return `[${(body as object).constructor?.name ?? typeof body}]`;
  }

  private readXhrResponse(xhr: XMLHttpRequest): unknown {
    try {
      const type = xhr.responseType;
      if (type === "" || type === "text") {
        const text = xhr.responseText;
        if (!text) return null;
        try {
          return safeSerialize(JSON.parse(text), this.config.maxBodyChars);
        } catch {
          return safeSerialize(text, this.config.maxBodyChars);
        }
      }
      if (type === "json") return safeSerialize(xhr.response, this.config.maxBodyChars);
      return `[responseType:${type}]`;
    } catch {
      return null;
    }
  }

  private pushNetwork(entry: NetworkEntry): void {
    this.networkBuffer.push(entry);
    if (this.networkBuffer.length > this.config.networkBufferSize) {
      this.networkBuffer.splice(
        0,
        this.networkBuffer.length - this.config.networkBufferSize,
      );
    }
  }

  /* ---- on-demand snapshots ---- */

  /** Console ring buffer, oldest first. Deep-cloned so the snapshot is frozen. */
  snapshotConsole(): ConsoleArtifact {
    return this.consoleBuffer.map((e) => ({ ...e, args: e.args ? [...e.args] : undefined }));
  }

  /** Network log, oldest first. Deep-cloned so later mutation can't leak in. */
  snapshotNetwork(): NetworkArtifact {
    return this.networkBuffer.map((e) => ({ ...e }));
  }

  /** Read the mandated client-state store via the injected getter. */
  snapshotClientState(): ClientStateArtifact {
    try {
      const state = this.config.getClientState();
      return (safeSerialize(state, this.config.maxBodyChars) as ClientStateArtifact) ?? {};
    } catch {
      return {};
    }
  }

  /** Returns true if there is anything in the network buffer. */
  hasNetwork(): boolean {
    return this.networkBuffer.length > 0;
  }
}

/* ------------------------------------------------------------------ */
/* Stateless snapshots (no patching required)                         */
/* ------------------------------------------------------------------ */

/** Snapshot localStorage / sessionStorage / cookies as flat string maps. */
export function snapshotStorage(): StorageArtifact {
  const readWebStorage = (store: Storage | undefined): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!store) return out;
    try {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key == null) continue;
        out[key] = store.getItem(key) ?? "";
      }
    } catch {
      /* storage access can throw in some sandboxed contexts */
    }
    return out;
  };

  const readCookies = (): Record<string, string> => {
    const out: Record<string, string> = {};
    if (typeof document === "undefined" || !document.cookie) return out;
    for (const pair of document.cookie.split(";")) {
      const idx = pair.indexOf("=");
      if (idx === -1) continue;
      const key = pair.slice(0, idx).trim();
      if (!key) continue;
      out[key] = decodeURIComponent(pair.slice(idx + 1).trim());
    }
    return out;
  };

  return {
    local: readWebStorage(typeof window !== "undefined" ? window.localStorage : undefined),
    session: readWebStorage(typeof window !== "undefined" ? window.sessionStorage : undefined),
    cookies: readCookies(),
  };
}

/**
 * Snapshot the DOM. `targetSelector` points back at the clicked element within
 * the serialized `html`. Captures the full document outerHTML plus viewport.
 */
export function snapshotDom(targetSelector: string | null): DomArtifact {
  const html =
    typeof document !== "undefined" && document.documentElement
      ? document.documentElement.outerHTML
      : "";
  return {
    html,
    targetSelector,
    viewport: {
      width: typeof window !== "undefined" ? Math.round(window.innerWidth) : 0,
      height: typeof window !== "undefined" ? Math.round(window.innerHeight) : 0,
    },
  };
}

/**
 * Longest side (px) the captured screenshot is downscaled to. Keeps the
 * base64 payload small - a JPEG at this cap lands well under ~1MB.
 */
const SCREENSHOT_MAX_SIDE = 1280;

/** JPEG quality for the exported screenshot (0..1). Lower = smaller payload. */
const SCREENSHOT_JPEG_QUALITY = 0.7;

/**
 * Render the page to an image at report time, so the agent (which can see images)
 * and the human reviewer can directly judge visual / "looks wrong" reports that a
 * DOM/CSS snapshot can't convey.
 *
 * Best-effort and non-blocking: html2canvas is loaded ONLY here, via a lazy
 * dynamic import, so it never sits on the page-load critical path - it is fetched
 * the first time a report is actually filed. Any failure (import failed, canvas
 * tainted, unsupported context) returns `null` and the screenshot artifact is
 * simply omitted; it must never break report submission.
 *
 * The widget's own UI (FAB / report form / nav) carries `data-paikko-ui`; we pass
 * html2canvas's `ignoreElements` so none of it appears in the shot - the reviewer
 * sees the page as the user saw it, not the open form.
 *
 * Size control: the longest side is capped to {@link SCREENSHOT_MAX_SIDE} via the
 * `scale` option and the image is exported as JPEG at
 * {@link SCREENSHOT_JPEG_QUALITY}.
 */
export async function snapshotScreenshot(): Promise<ScreenshotArtifact | null> {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return null;
  }
  try {
    const target = document.body ?? document.documentElement;
    if (!target) return null;

    const mod = await import("html2canvas");
    const html2canvas = (mod.default ?? mod) as typeof import("html2canvas").default;

    // Downscale: cap the longest side. html2canvas renders at CSS px * scale, so
    // a scale < 1 shrinks the output. Never upscale (cap scale at the device-ish
    // baseline of 1) so small pages aren't blown up.
    const longestSide = Math.max(
      target.scrollWidth || window.innerWidth,
      target.scrollHeight || window.innerHeight,
      1,
    );
    const scale = Math.min(1, SCREENSHOT_MAX_SIDE / longestSide);

    const canvas = await html2canvas(target, {
      scale,
      logging: false,
      useCORS: true,
      // Exclude the paikko widget UI (FAB / form / nav) from the shot.
      ignoreElements: (el: Element) =>
        el instanceof Element && el.closest("[data-paikko-ui]") !== null,
    });

    const dataUrl = canvas.toDataURL("image/jpeg", SCREENSHOT_JPEG_QUALITY);
    if (!dataUrl || !dataUrl.startsWith("data:image/")) return null;

    return {
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      format: "jpeg",
    };
  } catch {
    // Best-effort: a failed screenshot must never block a report.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Element resolution (point mode)                                    */
/* ------------------------------------------------------------------ */

/**
 * Resolve a clicked element to a {@link ReportTarget}: a CSS selector that finds
 * it again, its build-time `data-src` provenance, and the nearest owning
 * component's name (`data-component`). Walks ancestors for provenance because
 * leaf nodes (a bare <span>) often don't carry the attribute themselves.
 */
export function resolveTarget(el: Element | null): ReportTarget {
  if (!el) return { selector: null, src: null, component: null };

  let src: string | null = null;
  let component: string | null = null;
  let cursor: Element | null = el;
  while (cursor && (src == null || component == null)) {
    if (src == null) {
      const s = cursor.getAttribute(SRC_ATTR);
      if (s) src = s;
    }
    if (component == null) {
      const c = cursor.getAttribute(COMPONENT_ATTR);
      if (c) component = c;
    }
    cursor = cursor.parentElement;
  }

  return { selector: buildSelector(el), src, component };
}

/**
 * Build a reasonably stable, reasonably unique CSS selector for an element.
 * Prefers id, else builds a path of tag + nth-of-type from the nearest id'd
 * ancestor (or document root).
 */
export function buildSelector(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`;

  const parts: string[] = [];
  let cursor: Element | null = el;
  while (cursor && cursor.nodeType === Node.ELEMENT_NODE) {
    if (cursor.id) {
      parts.unshift(`#${cssEscape(cursor.id)}`);
      break;
    }
    const tag = cursor.tagName.toLowerCase();
    if (tag === "html" || tag === "body") {
      parts.unshift(tag);
      break;
    }
    const parent: Element | null = cursor.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const sameTag = Array.from(parent.children).filter(
      (c) => c.tagName === cursor!.tagName,
    );
    if (sameTag.length > 1) {
      const idx = sameTag.indexOf(cursor) + 1;
      parts.unshift(`${tag}:nth-of-type(${idx})`);
    } else {
      parts.unshift(tag);
    }
    cursor = parent;
  }
  return parts.join(" > ");
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/([^\w-])/g, "\\$1");
}

/* ------------------------------------------------------------------ */
/* Bundle assembly                                                    */
/* ------------------------------------------------------------------ */

/** The set of artifacts captured at report time, ready to inline into a bundle. */
export interface CapturedArtifacts {
  console?: ConsoleArtifact;
  network?: NetworkArtifact;
  clientState?: ClientStateArtifact;
  storage?: StorageArtifact;
  dom?: DomArtifact;
  screenshot?: ScreenshotArtifact;
}

/**
 * Freeze every available artifact into immutable, contract-valid payloads. This
 * is the report-time photograph: the live buffers are read, the stateless
 * snapshots are taken, and each payload is parsed through its contract schema so
 * only valid data leaves the client. Note `trace` is intentionally absent - the
 * backend trace artifact is produced server-side from the propagated traceIds.
 *
 * Async because the `screenshot` artifact is rendered lazily (html2canvas is
 * dynamically imported only here, at report time) and is best-effort: if it fails
 * or html2canvas isn't available, the screenshot is simply omitted and the rest of
 * the snapshot is returned unchanged - a failed screenshot never breaks a report.
 */
export async function snapshotArtifacts(
  capture: Capture,
  targetSelector: string | null,
): Promise<CapturedArtifacts> {
  const out: CapturedArtifacts = {};

  const console_ = ArtifactPayloadSchemas.console.safeParse(capture.snapshotConsole());
  if (console_.success && console_.data.length) out.console = console_.data;

  const network = ArtifactPayloadSchemas.network.safeParse(capture.snapshotNetwork());
  if (network.success && network.data.length) out.network = network.data;

  const clientState = ArtifactPayloadSchemas.clientState.safeParse(
    capture.snapshotClientState(),
  );
  if (clientState.success && Object.keys(clientState.data).length) {
    out.clientState = clientState.data;
  }

  const storage = ArtifactPayloadSchemas.storage.safeParse(snapshotStorage());
  if (storage.success) out.storage = storage.data;

  const dom = ArtifactPayloadSchemas.dom.safeParse(snapshotDom(targetSelector));
  if (dom.success && dom.data.html) out.dom = dom.data;

  // Best-effort screenshot: lazily rendered, validated against the contract, and
  // omitted on any failure so it can never block report submission.
  try {
    const shot = await snapshotScreenshot();
    if (shot) {
      const screenshot = ArtifactPayloadSchemas.screenshot.safeParse(shot);
      if (screenshot.success) out.screenshot = screenshot.data;
    }
  } catch {
    /* never let the screenshot break the snapshot */
  }

  return out;
}

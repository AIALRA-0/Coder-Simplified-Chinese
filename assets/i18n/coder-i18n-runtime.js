(() => {
  const runtimeConfig =
    window.CoderScI18nConfig && typeof window.CoderScI18nConfig === "object"
      ? window.CoderScI18nConfig
      : {};
  const STORAGE_KEY =
    typeof runtimeConfig.storageKey === "string" && runtimeConfig.storageKey.trim()
      ? runtimeConfig.storageKey.trim()
      : "coder-sc.locale";
  const COOKIE_KEY =
    typeof runtimeConfig.cookieKey === "string" && runtimeConfig.cookieKey.trim()
      ? runtimeConfig.cookieKey.trim()
      : "coder_sc_locale";
  const COOKIE_DOMAIN =
    typeof runtimeConfig.cookieDomain === "string" ? runtimeConfig.cookieDomain.trim() : "";
  const DEFAULT_LOCALE = "en-US";
  const SUPPORTED_LOCALES = ["en-US", "zh-CN"];
  const ATTRIBUTE_NAMES = ["placeholder", "title", "aria-label", "alt"];
  const VALUE_INPUT_TYPES = new Set(["button", "submit", "reset"]);
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "PRE"]);
  const SKIP_PATH_PATTERNS = [/^\/external-auth(\/|$)/];
  const ENGLISH_MONTHS = new Map([
    ["january", 1],
    ["jan", 1],
    ["february", 2],
    ["feb", 2],
    ["march", 3],
    ["mar", 3],
    ["april", 4],
    ["apr", 4],
    ["may", 5],
    ["june", 6],
    ["jun", 6],
    ["july", 7],
    ["jul", 7],
    ["august", 8],
    ["aug", 8],
    ["september", 9],
    ["sep", 9],
    ["sept", 9],
    ["october", 10],
    ["oct", 10],
    ["november", 11],
    ["nov", 11],
    ["december", 12],
    ["dec", 12],
  ]);
  const ENGLISH_MONTH_PATTERN =
    "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
  const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
  const SWITCHER_ID = "coder-sc-locale-switcher";
  const SWITCHER_STYLE_ID = "coder-sc-locale-style";
  const SWITCHER_Z_INDEX = 900;
  const SWITCHER_MENU_Z_INDEX = 910;
  const SWITCHER_VIEWPORT_GAP = 8;
  const SWITCHER_ANCHOR_GAP = 12;
  const SWITCHER_RIGHT_SAFE_GUTTER = 72;
  const RUNTIME_FILENAME = "coder-i18n-runtime.js";
  const DEFAULT_ASSET_ROUTE =
    typeof runtimeConfig.assetRoute === "string" && runtimeConfig.assetRoute.trim()
      ? (() => {
          let route = runtimeConfig.assetRoute.trim();
          if (!route.startsWith("/")) {
            route = `/${route}`;
          }
          if (!route.endsWith("/")) {
            route = `${route}/`;
          }
          return route;
        })()
      : "/__coder-sc/";

  const catalogCache = new Map();
  const textState = new WeakMap();
  const specialCaseState = new WeakMap();
  const attributeState = new WeakMap();
  const titleState = { base: "", lastApplied: "" };
  const observedMutationRoots = new WeakSet();

  let currentLocale = DEFAULT_LOCALE;
  let currentCatalog = null;
  let scheduled = false;
  let observer = null;
  let switcherRoot = null;
  let switcherAnchor = null;
  let switcherOpen = false;
  let switcherEventsBound = false;
  let switcherPositionEventsBound = false;
  let switcherPositionScheduled = false;

  const OBSERVER_OPTIONS = {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRIBUTE_NAMES, "value", "title", "aria-label", "placeholder", "alt"],
  };

  function detectAssetRoute() {
    const currentScript =
      document.currentScript instanceof HTMLScriptElement
        ? document.currentScript
        : Array.from(document.scripts || []).find((script) => script.src && script.src.includes(RUNTIME_FILENAME));

    if (!currentScript?.src) {
      return DEFAULT_ASSET_ROUTE;
    }

    try {
      const runtimeUrl = new URL(currentScript.src, window.location.href);
      const pathname = runtimeUrl.pathname || "";
      const marker = `/${RUNTIME_FILENAME}`;
      const markerIndex = pathname.lastIndexOf(marker);
      if (markerIndex === -1) {
        return DEFAULT_ASSET_ROUTE;
      }

      const prefix = pathname.slice(0, markerIndex + 1);
      return prefix || DEFAULT_ASSET_ROUTE;
    } catch {
      return DEFAULT_ASSET_ROUTE;
    }
  }

  const ASSET_ROUTE = detectAssetRoute();

  function normalizeLocale(input) {
    if (!input) {
      return null;
    }
    const raw = String(input).trim();
    if (!raw) {
      return null;
    }
    const lowered = raw.toLowerCase();
    if (lowered === "zh" || lowered === "zh-cn" || lowered === "zh_hans" || lowered === "zh-hans") {
      return "zh-CN";
    }
    if (lowered === "en" || lowered === "en-us" || lowered === "en_us") {
      return "en-US";
    }
    return SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === lowered) ?? null;
  }

  function isEligiblePath(pathname) {
    return !SKIP_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
  }

  function isManagedElement(element) {
    return Boolean(element?.closest?.("[data-coder-sc-i18n-skip='true']"));
  }

  function getCookie(name) {
    const match = document.cookie
      .split("; ")
      .find((part) => part.startsWith(`${name}=`));
    if (!match) {
      return null;
    }
    return decodeURIComponent(match.slice(name.length + 1));
  }

  function setCookie(name, value) {
    const parts = [
      `${name}=${encodeURIComponent(value)}`,
      "Path=/",
      `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
      "SameSite=Lax",
      "Secure",
    ];
    if (COOKIE_DOMAIN) {
      parts.push(`Domain=${COOKIE_DOMAIN}`);
    }
    document.cookie = parts.join("; ");
  }

  function detectLocale() {
    const queryLocale = normalizeLocale(new URLSearchParams(window.location.search).get("lang"));
    if (queryLocale) {
      return queryLocale;
    }

    try {
      const savedLocale = normalizeLocale(window.localStorage.getItem(STORAGE_KEY));
      if (savedLocale) {
        return savedLocale;
      }
    } catch {}

    const cookieLocale = normalizeLocale(getCookie(COOKIE_KEY));
    if (cookieLocale) {
      return cookieLocale;
    }

    const browserLocales = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language];

    for (const locale of browserLocales) {
      const normalized = normalizeLocale(locale);
      if (normalized) {
        return normalized;
      }
      if (String(locale).toLowerCase().startsWith("zh")) {
        return "zh-CN";
      }
      if (String(locale).toLowerCase().startsWith("en")) {
        return "en-US";
      }
    }

    return DEFAULT_LOCALE;
  }

  async function loadCatalog(locale) {
    const normalized = normalizeLocale(locale) ?? DEFAULT_LOCALE;
    if (catalogCache.has(normalized)) {
      return catalogCache.get(normalized);
    }

    const response = await fetch(`${ASSET_ROUTE}coder-locales/${normalized}.json`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(`LOCALE_LOAD_FAILED:${normalized}`);
    }
    const payload = await response.json();
    catalogCache.set(normalized, payload);
    return payload;
  }

  function rememberLocale(locale) {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {}
    setCookie(COOKIE_KEY, locale);
  }

  function updateUrlLocale(locale) {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", locale);
    window.history.replaceState({}, "", url.toString());
  }

  function getSwitcherCopy() {
    return currentLocale === "zh-CN"
      ? {
          trigger: "语言",
          english: "英语",
          chinese: "简体中文",
          aria: "切换界面语言",
        }
      : {
          trigger: "Language",
          english: "English",
          chinese: "简体中文",
          aria: "Switch interface language",
        };
  }

  function ensureSwitcherStyle() {
    if (document.getElementById(SWITCHER_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = SWITCHER_STYLE_ID;
    style.textContent = `
      #${SWITCHER_ID} {
        position: relative;
        z-index: ${SWITCHER_Z_INDEX};
        flex: 0 0 auto;
      }
      html,
      body,
      button,
      input,
      textarea,
      select,
      [role="button"],
      [role="menu"],
      [role="menuitem"],
      [role="menuitemradio"],
      [role="dialog"],
      [data-radix-popper-content-wrapper],
      body :where(div, span, a, p, li, td, th, label, h1, h2, h3, h4, h5, h6, small, strong, em) {
        font-family: Inter, "Segoe UI", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif !important;
      }
      body :where(code, pre, kbd, samp) {
        font-family: ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
      }
      #${SWITCHER_ID} [data-coder-sc-locale-trigger] {
        min-width: 104px;
        background: rgba(9, 9, 11, 0.94) !important;
        border-color: rgba(63, 63, 70, 0.78) !important;
        color: #f4f4f5 !important;
        box-shadow: none !important;
        outline: none !important;
      }
      #${SWITCHER_ID} [data-coder-sc-locale-label] {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      #${SWITCHER_ID} [data-coder-sc-locale-trigger]:hover,
      #${SWITCHER_ID} [data-coder-sc-locale-trigger]:focus,
      #${SWITCHER_ID} [data-coder-sc-locale-trigger]:focus-visible,
      #${SWITCHER_ID} [data-coder-sc-locale-trigger][data-state="open"] {
        background: rgba(18, 18, 20, 0.98) !important;
        border-color: rgba(82, 82, 91, 0.8) !important;
        color: #fafafa !important;
        box-shadow: inset 0 0 0 1px rgba(63, 63, 70, 0.58) !important;
        outline: none !important;
      }
      #${SWITCHER_ID} [data-coder-sc-locale-menu] {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        z-index: ${SWITCHER_MENU_Z_INDEX};
        min-width: 180px;
        border-radius: 12px;
        border: 1px solid rgba(63, 63, 70, 0.82);
        background: rgba(10, 10, 11, 0.995);
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.42);
        padding: 6px;
        display: none;
        backdrop-filter: blur(10px);
        outline: none !important;
        color-scheme: dark;
      }
      #${SWITCHER_ID}[data-open="true"] [data-coder-sc-locale-menu] {
        display: block;
      }
      #${SWITCHER_ID} [data-coder-sc-locale-option] {
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        border: 1px solid transparent !important;
        background: #0b0b0c !important;
        background-image: none !important;
        color: #f4f4f5 !important;
        border-radius: 8px;
        padding: 10px 12px;
        font: inherit;
        text-align: left;
        cursor: pointer;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        box-shadow: none !important;
        outline: none !important;
      }
      #${SWITCHER_ID} [data-coder-sc-locale-option]:hover,
      #${SWITCHER_ID} [data-coder-sc-locale-option]:focus,
      #${SWITCHER_ID} [data-coder-sc-locale-option]:focus-visible {
        background: #161618 !important;
        color: #f8fafc !important;
        border-color: rgba(82, 82, 91, 0.62) !important;
        box-shadow: none !important;
        outline: none !important;
      }
      #${SWITCHER_ID} [data-coder-sc-locale-option][data-active="true"] {
        background: #1d1d20 !important;
        color: #f8fafc !important;
        border-color: rgba(113, 113, 122, 0.76) !important;
        box-shadow: none !important;
      }
      #${SWITCHER_ID} [data-coder-sc-locale-option] .marker {
        font-size: 12px;
        opacity: 0.82;
      }
      #${SWITCHER_ID} [data-coder-sc-locale-trigger] .coder-sc-chevron {
        transition: transform 160ms ease;
      }
      #${SWITCHER_ID}[data-open="true"] [data-coder-sc-locale-trigger] .coder-sc-chevron {
        transform: rotate(180deg);
      }
      @media (max-width: 767px) {
        #${SWITCHER_ID} {
          display: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function createSwitcherMarkup(triggerClassName) {
    const wrapper = document.createElement("div");
    wrapper.id = SWITCHER_ID;
    wrapper.className = "hidden md:block";
    wrapper.dataset.coderScI18nSkip = "true";
    wrapper.dataset.open = "false";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = triggerClassName;
    trigger.dataset.coderScLocaleTrigger = "true";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("data-state", "closed");

    const label = document.createElement("span");
    label.dataset.coderScLocaleLabel = "true";
    label.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9Z"></path>
        <path d="M2 12h20"></path>
        <path d="M12 2a10 10 0 1 0 0 20"></path>
      </svg>
      <span data-coder-sc-locale-trigger-text="true"></span>
    `;
    trigger.appendChild(label);

    const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chevron.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    chevron.setAttribute("width", "24");
    chevron.setAttribute("height", "24");
    chevron.setAttribute("viewBox", "0 0 24 24");
    chevron.setAttribute("fill", "none");
    chevron.setAttribute("stroke", "currentColor");
    chevron.setAttribute("stroke-width", "2");
    chevron.setAttribute("stroke-linecap", "round");
    chevron.setAttribute("stroke-linejoin", "round");
    chevron.setAttribute("aria-hidden", "true");
    chevron.setAttribute("class", "coder-sc-chevron lucide lucide-chevron-down text-content-primary");
    chevron.innerHTML = `<path d="m6 9 6 6 6-6"></path>`;
    trigger.appendChild(chevron);

    const menu = document.createElement("div");
    menu.dataset.coderScLocaleMenu = "true";
    menu.setAttribute("role", "menu");

    for (const locale of SUPPORTED_LOCALES) {
      const option = document.createElement("button");
      option.type = "button";
      option.dataset.coderScLocaleOption = "true";
      option.dataset.locale = locale;
      option.setAttribute("role", "menuitemradio");
      option.innerHTML = `
        <span data-coder-sc-locale-option-text="true"></span>
        <span class="marker" data-coder-sc-locale-option-marker="true">✓</span>
      `;
      option.addEventListener("click", () => {
        closeSwitcherMenu();
        void setCurrentLocale(locale);
      });
      menu.appendChild(option);
    }

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setSwitcherOpen(!switcherOpen);
    });

    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);
    return wrapper;
  }

  function findAdminSettingsButton() {
    const candidates = Array.from(document.querySelectorAll("button, a")).filter((element) => {
      const text = (element.textContent || "").trim();
      return text === "管理员设置" || text === "Admin settings" || text === "Admin Settings";
    });
    return candidates.find((element) => element.parentElement?.classList.contains("hidden")) ?? candidates[0] ?? null;
  }

  function getAnchorInsertionTarget(anchorButton) {
    const parent = anchorButton?.parentElement;
    if (parent && parent.childElementCount === 1) {
      return parent;
    }
    return anchorButton;
  }

  function scheduleSwitcherPosition() {
    if (switcherPositionScheduled) {
      return;
    }
    switcherPositionScheduled = true;
    requestAnimationFrame(() => {
      switcherPositionScheduled = false;
      updateSwitcherPosition();
    });
  }

  function updateSwitcherPosition() {
    if (!switcherRoot) {
      return;
    }

    if (!switcherAnchor || !switcherAnchor.isConnected) {
      switcherRoot.hidden = true;
      return;
    }

    const rect = switcherAnchor.getBoundingClientRect();
    if ((rect.width === 0 && rect.height === 0) || window.innerWidth <= 767) {
      switcherRoot.hidden = true;
      return;
    }

    switcherRoot.hidden = false;
    switcherRoot.style.left = "";
    switcherRoot.style.top = "";
  }

  function bindSwitcherPositionEvents() {
    if (switcherPositionEventsBound) {
      return;
    }
    switcherPositionEventsBound = true;
    window.addEventListener("resize", scheduleSwitcherPosition);
    window.addEventListener("scroll", scheduleSwitcherPosition, true);
  }

  function setSwitcherOpen(nextOpen) {
    switcherOpen = Boolean(nextOpen);
    if (!switcherRoot) {
      return;
    }
    switcherRoot.dataset.open = switcherOpen ? "true" : "false";
    const trigger = switcherRoot.querySelector("[data-coder-sc-locale-trigger]");
    if (trigger) {
      trigger.setAttribute("aria-expanded", switcherOpen ? "true" : "false");
      trigger.setAttribute("data-state", switcherOpen ? "open" : "closed");
    }
  }

  function closeSwitcherMenu() {
    setSwitcherOpen(false);
  }

  function bindSwitcherEvents() {
    if (switcherEventsBound) {
      return;
    }
    switcherEventsBound = true;
    document.addEventListener("click", (event) => {
      if (!switcherRoot || switcherRoot.contains(event.target)) {
        return;
      }
      closeSwitcherMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeSwitcherMenu();
      }
    });
  }

  function ensureSwitcher() {
    if (!isEligiblePath(window.location.pathname)) {
      if (switcherRoot) {
        switcherRoot.hidden = true;
      }
      return;
    }

    const adminButton = findAdminSettingsButton();
    if (!adminButton) {
      if (switcherRoot) {
        switcherRoot.hidden = true;
      }
      return;
    }

    ensureSwitcherStyle();
    bindSwitcherEvents();
    bindSwitcherPositionEvents();

    const insertionTarget = getAnchorInsertionTarget(adminButton);
    const insertionParent = insertionTarget?.parentElement || adminButton.parentElement || document.body;

    if (!switcherRoot || !switcherRoot.isConnected) {
      switcherRoot = createSwitcherMarkup(adminButton.className);
      switcherRoot.hidden = true;
    }

    if (insertionTarget && switcherRoot !== insertionTarget) {
      if (switcherRoot.parentElement !== insertionParent || switcherRoot.nextElementSibling !== insertionTarget) {
        insertionParent.insertBefore(switcherRoot, insertionTarget);
      }
    } else if (switcherRoot.parentElement !== insertionParent) {
      insertionParent.appendChild(switcherRoot);
    }

    switcherAnchor = adminButton;

    switcherRoot.className = "hidden md:block";
    const trigger = switcherRoot.querySelector("[data-coder-sc-locale-trigger]");
    if (trigger) {
      trigger.className = adminButton.className;
    }
    syncSwitcher();
    scheduleSwitcherPosition();
  }

  function syncSwitcher() {
    if (!switcherRoot) {
      return;
    }
    const copy = getSwitcherCopy();
    const triggerText = switcherRoot.querySelector("[data-coder-sc-locale-trigger-text]");
    if (triggerText) {
      triggerText.textContent = copy.trigger;
    }
    const trigger = switcherRoot.querySelector("[data-coder-sc-locale-trigger]");
    if (trigger) {
      trigger.setAttribute("aria-label", copy.aria);
      trigger.setAttribute("title", copy.aria);
    }
    switcherRoot.querySelectorAll("[data-coder-sc-locale-option]").forEach((button) => {
      const locale = button.getAttribute("data-locale") || DEFAULT_LOCALE;
      const active = locale === currentLocale;
      const label = locale === "zh-CN" ? copy.chinese : copy.english;
      const text = button.querySelector("[data-coder-sc-locale-option-text]");
      const marker = button.querySelector("[data-coder-sc-locale-option-marker]");
      if (text) {
        text.textContent = label;
      }
      if (marker) {
        marker.textContent = active ? "✓" : "";
      }
      button.setAttribute("aria-checked", active ? "true" : "false");
      button.setAttribute("data-active", active ? "true" : "false");
    });
    scheduleSwitcherPosition();
  }

  function getTextRecord(node) {
    let record = textState.get(node);
    if (!record) {
      record = {
        base: node.textContent ?? "",
        lastApplied: null,
      };
      textState.set(node, record);
    }
    return record;
  }

  function getAttributeRecord(element, name, currentValue) {
    let perElement = attributeState.get(element);
    if (!perElement) {
      perElement = new Map();
      attributeState.set(element, perElement);
    }

    let record = perElement.get(name);
    if (!record) {
      record = {
        base: currentValue,
        lastApplied: null,
      };
      perElement.set(name, record);
    }
    return record;
  }

  function normalizeTextContent(input) {
    return String(input ?? "").replace(/\s+/g, " ").trim();
  }

  function getSpecialCaseRecord(element) {
    const current = normalizeTextContent(element.textContent);
    let record = specialCaseState.get(element);
    if (!record) {
      record = {
        base: current,
        lastApplied: null,
      };
      specialCaseState.set(element, record);
      return record;
    }

    if (record.lastApplied !== null && current !== record.lastApplied) {
      record.base = current;
      record.lastApplied = null;
    } else if (!record.base) {
      record.base = current;
    }

    return record;
  }

  function markSpecialCaseApplied(element, record) {
    record.lastApplied = normalizeTextContent(element.textContent);
  }

  function updateTextNode(node, nextValue) {
    const next = String(nextValue ?? "");
    const record = getTextRecord(node);
    if ((node.textContent ?? "") !== next) {
      node.textContent = next;
    }
    record.lastApplied = next;
    return true;
  }

  function getDirectTextNodes(element) {
    return Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE);
  }

  function updateTextOnlyElement(element, nextText) {
    const textNodes = getDirectTextNodes(element);
    if (element.childElementCount !== 0 || textNodes.length === 0) {
      return false;
    }

    updateTextNode(textNodes[0], nextText);
    for (let index = 1; index < textNodes.length; index++) {
      updateTextNode(textNodes[index], "");
    }
    return true;
  }

  function updateLeadingTextNode(element, nextText) {
    const textNodes = getDirectTextNodes(element);
    if (textNodes.length === 0) {
      return false;
    }

    updateTextNode(textNodes[0], nextText);
    for (let index = 1; index < textNodes.length; index++) {
      updateTextNode(textNodes[index], "");
    }
    return true;
  }

  function updateInlineWrappedText(element, leadingText, trailingText) {
    const textNodes = getDirectTextNodes(element);
    if (textNodes.length === 0) {
      return false;
    }

    const leadingNode = textNodes[0];
    updateTextNode(leadingNode, leadingText);

    let trailingNode =
      element.lastChild instanceof Text && element.lastChild !== leadingNode
        ? element.lastChild
        : null;

    if (!trailingNode) {
      trailingNode = document.createTextNode("");
      element.appendChild(trailingNode);
    }

    updateTextNode(trailingNode, trailingText);

    for (const node of textNodes) {
      if (node !== leadingNode && node !== trailingNode) {
        updateTextNode(node, "");
      }
    }

    return true;
  }

  function updateDirectTextNodes(element, values) {
    const textNodes = getDirectTextNodes(element);
    if (textNodes.length < values.length) {
      return false;
    }

    values.forEach((value, index) => {
      updateTextNode(textNodes[index], value);
    });
    for (let index = values.length; index < textNodes.length; index++) {
      updateTextNode(textNodes[index], "");
    }
    return true;
  }

  function updateDirectChildrenText(element, selector, values) {
    const nodes = Array.from(element.children).filter((child) => child.matches(selector));
    if (nodes.length < values.length) {
      return false;
    }

    return values.every((value, index) => updateTextOnlyElement(nodes[index], value));
  }

  function applyShowingSummary(element, start, end, total, noun) {
    const textValues =
      currentLocale === "zh-CN"
        ? noun === "workspaces"
          ? ["显示第 ", " 到 ", " 个工作区，共 ", " 个"]
          : ["显示第 ", " 到 ", " 位，共 ", noun === "users" ? " 位用户" : " 位成员"]
        : ["Showing ", " to ", " of ", ` ${noun}`];

    const strongValues = [start, end, total];
    return updateDirectTextNodes(element, textValues) && updateDirectChildrenText(element, "strong", strongValues);
  }

  function applyInlineLinkCopy(element, linkLabels, textValues) {
    return updateDirectTextNodes(element, textValues) && updateDirectChildrenText(element, "a, button", linkLabels);
  }

  function matchesTextPattern(text, pattern) {
    return typeof pattern === "function" ? pattern(text) : pattern.test(text);
  }

  function findTextNode(root, pattern) {
    const scope = root instanceof Document ? root.body || root.documentElement : root;
    if (!scope) {
      return null;
    }

    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName) || isManagedElement(parent)) {
          return NodeFilter.FILTER_REJECT;
        }

        const text = normalizeTextContent(node.textContent);
        if (!text) {
          return NodeFilter.FILTER_REJECT;
        }

        return matchesTextPattern(text, pattern) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });

    return walker.nextNode();
  }

  function findInteractiveElement(root, pattern) {
    const scope =
      root instanceof Document
        ? Array.from(root.querySelectorAll?.("a, button") || [])
        : root instanceof Element
          ? [
              ...(root.matches("a, button") ? [root] : []),
              ...root.querySelectorAll("a, button"),
            ]
          : [];

    return scope.find((node) => {
      const text = normalizeTextContent(node.textContent);
      return text && matchesTextPattern(text, pattern);
    }) ?? null;
  }

  function findSmallestMatchingElement(root, pattern) {
    const scope =
      root instanceof Document
        ? Array.from((root.body || root.documentElement)?.querySelectorAll("*") || [])
        : root instanceof Element
          ? [root, ...root.querySelectorAll("*")]
          : [];

    let bestMatch = null;
    let bestLength = Number.POSITIVE_INFINITY;

    for (const element of scope) {
      if (SKIP_TAGS.has(element.tagName) || element.id === SWITCHER_STYLE_ID || isManagedElement(element)) {
        continue;
      }

      const text = normalizeTextContent(element.textContent);
      if (!text || !matchesTextPattern(text, pattern) || text.length >= bestLength) {
        continue;
      }

      bestMatch = element;
      bestLength = text.length;
    }

    return bestMatch;
  }

  function preservePadding(input, output) {
    if (!input || input.trim() === "") {
      return input;
    }
    const leading = input.match(/^\s*/)?.[0] ?? "";
    const trailing = input.match(/\s*$/)?.[0] ?? "";
    return `${leading}${output}${trailing}`;
  }

  function translateDateLikeString(input) {
    if (currentLocale !== "zh-CN" || !input) {
      return input;
    }

    const trimmed = String(input).trim();
    if (!trimmed) {
      return input;
    }

    const getMonthNumber = (label) => ENGLISH_MONTHS.get(String(label || "").toLowerCase()) ?? null;

    let match = trimmed.match(new RegExp(`^(${ENGLISH_MONTH_PATTERN})\\s+(\\d{1,2}),\\s*(\\d{4})$`, "i"));
    if (match) {
      const month = getMonthNumber(match[1]);
      if (month !== null) {
        return `${match[3]}年${month}月${Number(match[2])}日`;
      }
    }

    match = trimmed.match(new RegExp(`^(${ENGLISH_MONTH_PATTERN})\\s+(\\d{4})$`, "i"));
    if (match) {
      const month = getMonthNumber(match[1]);
      if (month !== null) {
        return `${match[2]}年${month}月`;
      }
    }

    const month = getMonthNumber(trimmed);
    if (month !== null) {
      return `${month}月`;
    }

    return input;
  }

  function translateString(input, attributeName = null) {
    if (!currentCatalog || !input) {
      return input;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      return input;
    }

    const attributeMap =
      attributeName && currentCatalog.attributes && typeof currentCatalog.attributes === "object"
        ? currentCatalog.attributes[attributeName]
        : null;

    let output =
      (attributeMap && typeof attributeMap === "object" && attributeMap[trimmed]) ||
      (currentCatalog.exact && currentCatalog.exact[trimmed]) ||
      trimmed;

    const patterns = Array.isArray(currentCatalog.patterns) ? currentCatalog.patterns : [];
    for (const item of patterns) {
      if (!item || !item.match || typeof item.replace !== "string") {
        continue;
      }
      try {
        output = output.replace(new RegExp(item.match, item.flags || "g"), item.replace);
      } catch {}
    }

    output = translateDateLikeString(output);

    return output === trimmed ? input : preservePadding(input, output);
  }

  function translateTitleString(input) {
    if (!input) {
      return input;
    }
    const direct = translateString(input);
    if (direct !== input) {
      return direct;
    }

    const parts = input.split(" - ");
    if (parts.length <= 1) {
      return input;
    }

    const translated = parts.map((part) => translateString(part).trim());
    const next = translated.join(" - ");
    return next === parts.join(" - ") ? input : next;
  }

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName) || isManagedElement(parent)) {
      return;
    }

    translateRawTextNode(node);
  }

  function translateRawTextNode(node) {
    if (node?.nodeType !== Node.TEXT_NODE) {
      return;
    }

    const current = node.textContent ?? "";
    const record = getTextRecord(node);
    if (record.lastApplied !== null && current !== record.lastApplied) {
      record.base = current;
      record.lastApplied = null;
    }

    const next = translateString(record.base);
    if (next !== current) {
      node.textContent = next;
    }
    record.lastApplied = next;
  }

  function translateAttributes(element) {
    if (isManagedElement(element)) {
      return;
    }
    for (const name of ATTRIBUTE_NAMES) {
      const currentValue = element.getAttribute(name);
      if (!currentValue) {
        continue;
      }

      const record = getAttributeRecord(element, name, currentValue);
      if (record.lastApplied !== null && currentValue !== record.lastApplied) {
        record.base = currentValue;
        record.lastApplied = null;
      }

      const next = translateString(record.base, name);
      if (next !== currentValue) {
        element.setAttribute(name, next);
      }
      record.lastApplied = next;
    }

    if (element instanceof HTMLInputElement && VALUE_INPUT_TYPES.has(element.type)) {
      const currentValue = element.value;
      if (currentValue) {
        const record = getAttributeRecord(element, "value", currentValue);
        if (record.lastApplied !== null && currentValue !== record.lastApplied) {
          record.base = currentValue;
          record.lastApplied = null;
        }

        const next = translateString(record.base, "value");
        if (next !== currentValue) {
          element.value = next;
        }
        record.lastApplied = next;
      }
    }
  }

  function walk(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }

    if (root instanceof ShadowRoot || root instanceof DocumentFragment) {
      for (const child of root.childNodes) {
        walk(child);
      }
      return;
    }

    if (!(root instanceof Element)) {
      return;
    }

    if (SKIP_TAGS.has(root.tagName)) {
      return;
    }

    translateAttributes(root);
    for (const child of root.childNodes) {
      walk(child);
    }
    if (root.shadowRoot) {
      walk(root.shadowRoot);
    }
  }

  function translateInteractiveOverlays(root = document) {
    if (!(root instanceof Document || root instanceof Element)) {
      return;
    }
    const containers = Array.from(
      root.querySelectorAll(
        [
          '[role="tooltip"]',
          '[role="alert"]',
          '[role="status"]',
          '[aria-live="assertive"]',
          '[aria-live="polite"]',
          '[data-radix-popper-content-wrapper]',
        ].join(","),
      ),
    );

    for (const container of containers) {
      walk(container);
    }
  }

  function applyBuildTimelineStageLabels(root = document) {
    if (!(root instanceof Document || root instanceof Element)) {
      return;
    }

    const buildTimeline = findSmallestMatchingElement(
      root,
      (text) =>
        (text.includes("构建时间线") || text.includes("Build timeline")) &&
        (text.includes("运行启动脚本") || text.includes("run startup scripts") || text.includes("run startup script")),
    );
    if (!buildTimeline) {
      return;
    }

    const stageLabels = new Map([
      ["初始化", "init"],
      ["应用", "apply"],
      ["生成图", "graph"],
      ["连接", "connect"],
      ["运行启动脚本", "run startup scripts"],
      ["运行 startup scripts", "run startup scripts"],
    ]);

    [buildTimeline, ...buildTimeline.querySelectorAll("*")].forEach((element) => {
      if (!(element instanceof Element) || SKIP_TAGS.has(element.tagName) || isManagedElement(element)) {
        return;
      }

      const currentText = normalizeTextContent(element.textContent);
      const nextText = stageLabels.get(currentText);
      if (!nextText) {
        return;
      }

      if (updateLeadingTextNode(element, nextText)) {
        markSpecialCaseApplied(element, getSpecialCaseRecord(element));
      }
    });
  }

  function translateProvisionerLogText(root = document) {
    if (!currentCatalog || !(root instanceof Document || root instanceof Element)) {
      return;
    }

    root.querySelectorAll?.(".logs-line span, .logs-header, .logs-header *").forEach((element) => {
      if (!(element instanceof Element) || isManagedElement(element)) {
        return;
      }

      getDirectTextNodes(element).forEach((node) => {
        translateRawTextNode(node);
      });
    });
  }

  function translateStandaloneDurationBadges(root = document) {
    if (!currentCatalog || !(root instanceof Document || root instanceof Element)) {
      return;
    }

    root.querySelectorAll?.("*").forEach((element) => {
      if (
        !(element instanceof Element) ||
        SKIP_TAGS.has(element.tagName) ||
        element.id === SWITCHER_STYLE_ID ||
        isManagedElement(element)
      ) {
        return;
      }

      const text = normalizeTextContent(element.textContent);
      if (!/^\d+\s+(seconds?|minutes?|hours?|days?)$/i.test(text)) {
        return;
      }

      const translated = translateString(text);
      if (translated !== text && updateTextOnlyElement(element, translated)) {
        markSpecialCaseApplied(element, getSpecialCaseRecord(element));
      }
    });
  }

  function translateWorkspaceStartingCard(root = document) {
    if (currentLocale !== "zh-CN" || !(root instanceof Document || root instanceof Element)) {
      return;
    }

    const exactTextMap = new Map([
      ["Starting…", "正在启动…"],
      ["Starting...", "正在启动..."],
      ["Start with build parameters", "使用构建参数启动"],
      ["Build logs", "构建日志"],
      ["Starting workspace", "正在启动工作区"],
      ["Starting workspace...", "正在启动工作区..."],
      ["Starting workspace…", "正在启动工作区..."],
      ["正在启动 workspace...", "正在启动工作区..."],
      ["正在启动 workspace…", "正在启动工作区..."],
    ]);

    root.querySelectorAll?.("*").forEach((element) => {
      if (SKIP_TAGS.has(element.tagName) || element.id === SWITCHER_STYLE_ID || isManagedElement(element)) {
        return;
      }

      const text = normalizeTextContent(element.textContent);
      const replacement = exactTextMap.get(text);
      if (replacement && updateTextOnlyElement(element, replacement)) {
        markSpecialCaseApplied(element, getSpecialCaseRecord(element));
      }
    });

    const strayWorkspaceText = findTextNode(root, /^(workspace(?:\.{3}|…))$/i);
    if (strayWorkspaceText) {
      const parentText = normalizeTextContent(strayWorkspaceText.parentElement?.textContent);
      if (parentText.includes("正在启动") || parentText.includes("Starting")) {
        updateTextNode(strayWorkspaceText, "工作区...");
      }
    }
  }

  function translateSpecialCases(root = document) {
    if (!currentCatalog || !(root instanceof Document || root instanceof Element)) {
      return;
    }
    const stubbornNodeTexts = new Set([
      "Start",
      "BUILDS",
      "CPU Usage",
      "RAM Usage",
      "Home Disk",
      "Build",
      "Workspace Settings",
      "Update Policy",
      "Automatic Updates",
      "Never",
      "Schedule",
      "Sharing",
      "Refresh session",
      "Setting up",
      "Planning Infrastructure",
      "Building Workspaces",
      "Starting workspace",
      "The workspace startup script has exited with an error",
      "because your workspace may be incomplete.",
      ", we recommend reloading this session and debugging the startup script",
      "Configure your workspace to automatically update when started.",
      "The workspace startup script has exited with an error, we recommend reloading this session and debugging the startup script because your workspace may be incomplete.",
      "Workspace Schedule",
      "Autostart",
      "Enable Autostart",
      "Start time",
      "Timezone",
      "Days of Week",
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
      "Autostop",
      "Enable Autostop",
      "Time until shutdown (hours)",
      "Your workspace will not automatically shut down.",
      "Workspace sharing",
      "Search for user or group",
      "Use",
      "Admin",
      "Add member",
      "Member Role",
      "No shared members or groups yet",
      "Add a member or group using the controls above.",
      "Something went wrong",
      "Please try reloading the page. If reloading does not work, you can ask for help in the Coder Discord community",
      "(link opens in a new tab)",
      "或 open an issue on GitHub",
      "Reload page",
      "Show error",
    ]);
    root.querySelectorAll("*").forEach((element) => {
      if (SKIP_TAGS.has(element.tagName) || element.id === SWITCHER_STYLE_ID || isManagedElement(element)) {
        return;
      }
      const record = getSpecialCaseRecord(element);
      const baseText = record.base;
      if (!baseText) {
        return;
      }
      const forcedTranslation = translateString(baseText);
      if (
        forcedTranslation !== baseText &&
        element.childElementCount === 0 &&
        getDirectTextNodes(element).length > 0
      ) {
        if (updateTextOnlyElement(element, forcedTranslation)) {
          markSpecialCaseApplied(element, record);
          return;
        }
      }
      if (
        forcedTranslation !== baseText &&
        (stubbornNodeTexts.has(baseText) || /^Build #\d+$/.test(baseText))
      ) {
        if (updateTextOnlyElement(element, forcedTranslation)) {
          markSpecialCaseApplied(element, record);
          return;
        }
      }
      const latencyMatch = baseText.match(/^Latency for\s+(.+)$/);
      if (latencyMatch) {
        const scopeLabel = translateString(latencyMatch[1]).trim();
        if (updateTextOnlyElement(element, currentLocale === "zh-CN" ? `${scopeLabel}延迟` : `Latency for ${latencyMatch[1]}`)) {
          markSpecialCaseApplied(element, record);
          return;
        }
      }
      if (baseText === "Organization") {
        if (updateTextOnlyElement(element, currentLocale === "zh-CN" ? "组织" : "Organization")) {
          markSpecialCaseApplied(element, record);
          return;
        }
      }
      const showingMatch = baseText.match(/^Showing\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)\s+(users|members|workspaces)$/);
      if (showingMatch) {
        const [, start, end, total, noun] = showingMatch;
        if (applyShowingSummary(element, start, end, total, noun)) {
          markSpecialCaseApplied(element, record);
          return;
        }
      }

      if (baseText.includes("These are the settings used by your template.")) {
        const docsLink = Array.from(element.querySelectorAll("a, button")).find((node) =>
          /View docs|查看文档/.test((node.textContent || "").trim()),
        );
        const firstTextNode = Array.from(element.childNodes).find((node) =>
          node.nodeType === Node.TEXT_NODE && /These are the settings used by your template\./.test(node.textContent || ""),
        );
        if (docsLink) {
          updateTextOnlyElement(docsLink, currentLocale === "zh-CN" ? "查看文档" : "View docs");
        }
        if (firstTextNode) {
          updateTextNode(
            firstTextNode,
            currentLocale === "zh-CN"
              ? "以下是模板使用的设置；工作区创建后，不可变参数将无法修改"
              : "These are the settings used by your template. Immutable parameters cannot be modified once the workspace is created.",
          );
          markSpecialCaseApplied(element, record);
        }
      }
    });

    const tokenExpiryDescription = findSmallestMatchingElement(
      root,
      (text) =>
        text.startsWith("The token will expire on ") || text.startsWith("令牌将于 "),
    );
    if (
      tokenExpiryDescription &&
      updateInlineWrappedText(
        tokenExpiryDescription,
        currentLocale === "zh-CN" ? "令牌将于" : "The token will expire on ",
        currentLocale === "zh-CN" ? " 过期" : "",
      )
    ) {
      markSpecialCaseApplied(tokenExpiryDescription, getSpecialCaseRecord(tokenExpiryDescription));
    }

    const tokenLifetimeLabel = findSmallestMatchingElement(root, /^(Lifetime \*|有效期 \*)$/);
    if (
      tokenLifetimeLabel &&
      updateLeadingTextNode(tokenLifetimeLabel, currentLocale === "zh-CN" ? "有效期" : "Lifetime")
    ) {
      markSpecialCaseApplied(tokenLifetimeLabel, getSpecialCaseRecord(tokenLifetimeLabel));
    }

    const workspaceUpdateDescription = findSmallestMatchingElement(
      root,
      (text) =>
        text.includes("Updating your workspace will start the workspace on the latest template version. This can") ||
        text.includes("更新工作区会基于最新模板版本重新启动工作区；这可能会"),
    );
    if (workspaceUpdateDescription) {
      const destructiveLabel = Array.from(workspaceUpdateDescription.children).find((node) =>
        /^(delete non-persistent data|删除非持久化数据)$/i.test(normalizeTextContent(node.textContent)),
      );
      if (
        destructiveLabel &&
        updateInlineWrappedText(
          workspaceUpdateDescription,
          currentLocale === "zh-CN"
            ? "更新工作区会基于最新模板版本重新启动工作区；这可能会"
            : "Updating your workspace will start the workspace on the latest template version. This can ",
          currentLocale === "zh-CN" ? "。" : ".",
        ) &&
        updateTextOnlyElement(
          destructiveLabel,
          currentLocale === "zh-CN" ? "删除非持久化数据" : "delete non-persistent data",
        )
      ) {
        markSpecialCaseApplied(workspaceUpdateDescription, getSpecialCaseRecord(workspaceUpdateDescription));
      }
    }

    const deleteWorkspacePrompt = findSmallestMatchingElement(
      root,
      (text) =>
        (text.includes("Type") && text.includes("below to confirm:")) ||
        (text.includes("请在下方输入") && text.includes("以确认：")),
    );
    if (
      deleteWorkspacePrompt &&
      updateInlineWrappedText(
        deleteWorkspacePrompt,
        currentLocale === "zh-CN" ? "请在下方输入“" : "Type \"",
        currentLocale === "zh-CN" ? "”以确认：" : "\" below to confirm:",
      )
    ) {
      markSpecialCaseApplied(deleteWorkspacePrompt, getSpecialCaseRecord(deleteWorkspacePrompt));
    }

    if (currentLocale === "zh-CN") {
      translateProvisionerLogText(root);
      translateStandaloneDurationBadges(root);
      translateWorkspaceStartingCard(root);
      applyBuildTimelineStageLabels(root);

      const terminalAlertBody = root.querySelector?.('[role="alert"] .flex-1');
      if (
        terminalAlertBody &&
        /The workspace startup script has exited with an error/.test(terminalAlertBody.textContent || "")
      ) {
        if (
          applyInlineLinkCopy(
            terminalAlertBody,
            ["启动脚本已异常退出", "调试启动脚本", "工作区可能尚未完整就绪"],
            ["工作区", "；建议重新加载此会话并", "；因为", ""],
          )
        ) {
          markSpecialCaseApplied(terminalAlertBody, getSpecialCaseRecord(terminalAlertBody));
        }
      }

      const buildErrorParagraph = Array.from(root.querySelectorAll?.("p") || []).find((node) =>
        /Please try reloading the page\. If reloading does not work, you can ask for help in the Coder Discord community/.test(
          node.textContent || "",
        ),
      );
      if (buildErrorParagraph) {
        if (
          applyInlineLinkCopy(
            buildErrorParagraph,
            ["Discord 社区", "GitHub 问题"],
            ["请尝试重新加载页面；如果仍然无效，你可以在 ", " 寻求帮助；或在 ", " 上提交问题"],
          )
        ) {
          markSpecialCaseApplied(buildErrorParagraph, getSpecialCaseRecord(buildErrorParagraph));
        }
      }

      const appearanceDescription = findSmallestMatchingElement(
        root,
        (text) =>
          text.includes("Specify a custom URL for your logo") &&
          text.includes("top left corner of the dashboard"),
      );
      if (appearanceDescription && updateTextOnlyElement(appearanceDescription, "指定用于显示标志的自定义地址；它会出现在登录页以及控制台左上角")) {
        markSpecialCaseApplied(appearanceDescription, getSpecialCaseRecord(appearanceDescription));
      }

      const terraformPlanTooltipTitle = findSmallestMatchingElement(root, /^(Terraform plan|Terraform 计划)$/);
      if (terraformPlanTooltipTitle && updateTextOnlyElement(terraformPlanTooltipTitle, "Terraform 计划")) {
        markSpecialCaseApplied(terraformPlanTooltipTitle, getSpecialCaseRecord(terraformPlanTooltipTitle));
      }

      const terraformPlanTooltipDescription = findSmallestMatchingElement(
        root,
        (text) =>
          text.includes("Compare state of desired vs actual resources") &&
          text.includes("compute changes to be made"),
      );
      if (
        terraformPlanTooltipDescription &&
        updateTextOnlyElement(terraformPlanTooltipDescription, "比较期望资源与实际资源的状态，并计算需要执行的变更")
      ) {
        markSpecialCaseApplied(terraformPlanTooltipDescription, getSpecialCaseRecord(terraformPlanTooltipDescription));
      }

      const terraformGraphTooltipTitle = findSmallestMatchingElement(root, /^(Terraform graph|Terraform 资源图)$/);
      if (terraformGraphTooltipTitle && updateTextOnlyElement(terraformGraphTooltipTitle, "Terraform 资源图")) {
        markSpecialCaseApplied(terraformGraphTooltipTitle, getSpecialCaseRecord(terraformGraphTooltipTitle));
      }

      const terraformGraphTooltipDescription = findSmallestMatchingElement(
        root,
        (text) =>
          text.includes("List all resources in plan") &&
          text.includes("update coderd database"),
      );
      if (
        terraformGraphTooltipDescription &&
        updateTextOnlyElement(terraformGraphTooltipDescription, "列出计划中的所有资源，用于更新 coderd 数据库")
      ) {
        markSpecialCaseApplied(terraformGraphTooltipDescription, getSpecialCaseRecord(terraformGraphTooltipDescription));
      }

      const connectTooltipTitle = findSmallestMatchingElement(root, /^(Connect|连接)$/);
      if (connectTooltipTitle && updateTextOnlyElement(connectTooltipTitle, "连接")) {
        markSpecialCaseApplied(connectTooltipTitle, getSpecialCaseRecord(connectTooltipTitle));
      }

      const connectTooltipDescription = findSmallestMatchingElement(
        root,
        (text) =>
          text.includes("Establish an RPC connection with the control plane"),
      );
      if (connectTooltipDescription && updateTextOnlyElement(connectTooltipDescription, "与控制平面建立 RPC 连接")) {
        markSpecialCaseApplied(connectTooltipDescription, getSpecialCaseRecord(connectTooltipDescription));
      }

      const runStartupScriptsTooltipDescription = findSmallestMatchingElement(
        root,
        (text) =>
          text.includes("Execute each agent startup script"),
      );
      if (
        runStartupScriptsTooltipDescription &&
        updateTextOnlyElement(runStartupScriptsTooltipDescription, "执行每个代理的启动脚本")
      ) {
        markSpecialCaseApplied(runStartupScriptsTooltipDescription, getSpecialCaseRecord(runStartupScriptsTooltipDescription));
      }

      const sshKeyDescription = findSmallestMatchingElement(
        root,
        (text) =>
          text.includes("The following public key is used to authenticate Git in workspaces.") &&
          text.includes("$GIT_SSH_COMMAND"),
      );
      if (
        sshKeyDescription &&
        updateDirectTextNodes(
          sshKeyDescription,
          [
            "以下公钥用于在工作区中验证 Git 身份；你可以将它添加到需要从工作区访问的 Git 服务（如 GitHub）中；Coder 通过 ",
            " 配置身份验证",
          ],
        ) &&
        updateDirectChildrenText(sshKeyDescription, "code", ["$GIT_SSH_COMMAND"])
      ) {
        markSpecialCaseApplied(sshKeyDescription, getSpecialCaseRecord(sshKeyDescription));
      }

      const tokenDescription = findSmallestMatchingElement(
        root,
        (text) =>
          text.includes("Tokens are used to authenticate with the Coder API.") &&
          text.includes("coder tokens create"),
      );
      if (
        tokenDescription &&
        updateDirectTextNodes(
          tokenDescription,
          ["令牌用于通过 Coder API 进行身份验证；你可以使用 Coder CLI 的 ", " 命令创建令牌"],
        ) &&
        updateDirectChildrenText(tokenDescription, "code", ["coder tokens create"])
      ) {
        markSpecialCaseApplied(tokenDescription, getSpecialCaseRecord(tokenDescription));
      }

      const engagedUsersDescription = findSmallestMatchingElement(
        root,
        (text) =>
          text.includes('A user is considered "engaged" if they initiate a connection to their workspace via apps, web terminal, or SSH.') &&
          text.includes("Activity Audit") &&
          text.includes("License Consumption"),
      );
      if (engagedUsersDescription) {
        const activityAuditLink = findInteractiveElement(engagedUsersDescription, /^(Activity Audit|活动审计)$/i);
        const licenseConsumptionLink = findInteractiveElement(engagedUsersDescription, /^(License Consumption|许可证用量)$/i);
        const activityAuditText = activityAuditLink ? findTextNode(activityAuditLink, /^(Activity Audit|活动审计)$/i) : null;
        const licenseConsumptionText = licenseConsumptionLink
          ? findTextNode(licenseConsumptionLink, /^(License Consumption|许可证用量)$/i)
          : null;
        const engagedPrefixText = findTextNode(
          engagedUsersDescription,
          (text) =>
            text.includes('A user is considered "engaged" if they initiate a connection to their workspace via apps, web terminal, or SSH.') ||
            text.includes("如果用户通过应用、Web 终端或 SSH 发起到其工作区的连接，则视为"),
        );
        const engagedSeparatorText = findTextNode(engagedUsersDescription, /^(and|和)$/i);
        const engagedSuffixText = findTextNode(
          engagedUsersDescription,
          (text) => text.includes("tools.") || text.includes("工具查看"),
        );

        if (
          activityAuditText &&
          licenseConsumptionText &&
          engagedPrefixText &&
          engagedSeparatorText &&
          engagedSuffixText
        ) {
          updateTextNode(
            engagedPrefixText,
            "如果用户通过应用、Web 终端或 SSH 发起到其工作区的连接，则视为“活跃”；该图表展示每天至少活跃一次的独立用户数；更多洞察可通过",
          );
          updateTextNode(activityAuditText, "活动审计");
          updateTextNode(engagedSeparatorText, "和");
          updateTextNode(licenseConsumptionText, "许可证用量");
          updateTextNode(engagedSuffixText, "工具查看");
          markSpecialCaseApplied(engagedUsersDescription, getSpecialCaseRecord(engagedUsersDescription));
        }
      }

      const serviceBannerNotice = Array.from(root.querySelectorAll?.("*") || []).find((node) =>
        /Your license does not include Service Banners\./.test(node.textContent || ""),
      );
      if (serviceBannerNotice) {
        const salesLink = Array.from(serviceBannerNotice.querySelectorAll("a, button")).find((node) =>
          /Contact sales|联系销售/.test((node.textContent || "").trim()),
        );
        const salesLinkText = salesLink ? findTextNode(salesLink, /^(Contact sales|联系销售)$/) : null;
        const noticePrefixText = findTextNode(
          serviceBannerNotice,
          (text) => text.includes("Your license does not include Service Banners"),
        );
        const noticeSuffixText = findTextNode(serviceBannerNotice, (text) => text.includes("to learn more"));

        if (salesLinkText && noticePrefixText && noticeSuffixText) {
          updateTextNode(salesLinkText, "联系销售");
          updateTextNode(noticePrefixText, "你的许可证不包含服务横幅；请");
          updateTextNode(noticeSuffixText, "了解更多");
          markSpecialCaseApplied(serviceBannerNotice, getSpecialCaseRecord(serviceBannerNotice));
        } else if (updateTextOnlyElement(serviceBannerNotice, "你的许可证不包含服务横幅；请联系销售了解更多")) {
          markSpecialCaseApplied(serviceBannerNotice, getSpecialCaseRecord(serviceBannerNotice));
        }
      }

      const licenseUpsell = findSmallestMatchingElement(
        root,
        (text) => text.includes("You're missing out on high availability, RBAC, quotas, and much more."),
      );
      if (licenseUpsell) {
        const salesLink = findInteractiveElement(
          licenseUpsell,
          /^(sales|Contact sales|联系销售)$/i,
        );
        const trialLink = findInteractiveElement(
          licenseUpsell,
          /^(request a trial license|申请试用许可证)$/i,
        );
        const salesLinkText = salesLink ? findTextNode(salesLink, /^(sales|Contact sales|联系销售)$/i) : null;
        const trialLinkText = trialLink ? findTextNode(trialLink, /^(request a trial license|申请试用许可证)$/i) : null;
        const upsellPrefixText = findTextNode(
          licenseUpsell,
          (text) =>
            text.includes("You're missing out on high availability, RBAC, quotas, and much more.") ||
            text.includes("你将无法使用高可用、RBAC、配额等更多高级能力"),
        );
        const upsellSeparatorText = findTextNode(licenseUpsell, /^(or|或)$/i);
        const upsellSuffixText = findTextNode(
          licenseUpsell,
          (text) => text.includes("to get started") || text.includes("以开始使用") || text.includes("后即可开始使用"),
        );

        if (salesLinkText && trialLinkText && upsellPrefixText && upsellSeparatorText && upsellSuffixText) {
          updateTextNode(upsellPrefixText, "你将无法使用高可用、RBAC、配额等更多高级能力；请");
          updateTextNode(salesLinkText, "联系销售");
          updateTextNode(upsellSeparatorText, "；或");
          updateTextNode(trialLinkText, "申请试用许可证");
          updateTextNode(upsellSuffixText, "以开始使用");
          markSpecialCaseApplied(licenseUpsell, getSpecialCaseRecord(licenseUpsell));
        } else if (
          updateTextOnlyElement(
            licenseUpsell,
            "你将无法使用高可用、RBAC、配额等更多高级能力；请联系销售，或申请试用许可证以开始使用",
          )
        ) {
          markSpecialCaseApplied(licenseUpsell, getSpecialCaseRecord(licenseUpsell));
        }
      }

      root.querySelectorAll?.("a, button").forEach((node) => {
        const text = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (/^Visit AI Bridge Docs$/i.test(text)) {
          updateTextOnlyElement(node, "查看 AI Bridge 文档");
        }
      });

      const proxyStatusLine = Array.from(root.querySelectorAll?.("*") || []).find((node) => {
        const text = (node.textContent || "").replace(/\s+/g, " ").trim();
        return text === "Proxy Status Latency";
      });
      if (proxyStatusLine) {
        if (updateTextOnlyElement(proxyStatusLine, "代理 状态 延迟")) {
          markSpecialCaseApplied(proxyStatusLine, getSpecialCaseRecord(proxyStatusLine));
        }
      }
    }
  }

  function applyTranslations(root = document.documentElement) {
    if (!isEligiblePath(window.location.pathname)) {
      return;
    }

    if (!currentCatalog) {
      return;
    }

    document.documentElement.lang = currentLocale;
    observeShadowRoots(root.ownerDocument || document);

    const currentTitle = document.title;
    if (titleState.lastApplied !== null && currentTitle !== titleState.lastApplied) {
      titleState.base = currentTitle;
      titleState.lastApplied = null;
    } else if (!titleState.base) {
      titleState.base = currentTitle;
    }

    const translatedTitle = translateTitleString(titleState.base);
    if (translatedTitle !== currentTitle) {
      document.title = translatedTitle;
    }
    titleState.lastApplied = translatedTitle;

    walk(root);
    translateInteractiveOverlays(root.ownerDocument || document);
    translateSpecialCases(root.ownerDocument || document);
    ensureSwitcher();
    syncSwitcher();
  }

  function scheduleApply() {
    if (!isEligiblePath(window.location.pathname)) {
      return;
    }
    if (scheduled) {
      return;
    }
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyTranslations();
    });
  }

  function observeMutationRoot(root) {
    if (!observer || !root || observedMutationRoots.has(root)) {
      return;
    }

    observer.observe(root, OBSERVER_OPTIONS);
    observedMutationRoots.add(root);
  }

  function observeShadowRoots(root = document) {
    if (!observer || !root) {
      return;
    }

    const scope = root instanceof Document ? root.documentElement : root;
    if (!(scope instanceof Element || scope instanceof ShadowRoot || scope instanceof DocumentFragment)) {
      return;
    }

    if (scope instanceof Element && scope.shadowRoot) {
      observeMutationRoot(scope.shadowRoot);
    }

    if (typeof scope.querySelectorAll !== "function") {
      return;
    }

    scope.querySelectorAll("*").forEach((element) => {
      if (element.shadowRoot) {
        observeMutationRoot(element.shadowRoot);
      }
    });
  }

  async function setCurrentLocale(locale) {
    const normalized = normalizeLocale(locale) ?? DEFAULT_LOCALE;
    currentLocale = normalized;
    currentCatalog = await loadCatalog(normalized);
    rememberLocale(normalized);
    updateUrlLocale(normalized);
    scheduleApply();
    return normalized;
  }

  function getCurrentLocale() {
    return currentLocale;
  }

  const api = {
    getCurrentLocale,
    setCurrentLocale,
    loadCatalog,
    applyTranslations,
  };

  window.CoderScI18n = api;

  if (!isEligiblePath(window.location.pathname)) {
    return;
  }

  const boot = async () => {
    currentLocale = detectLocale();
    currentCatalog = await loadCatalog(currentLocale);
    rememberLocale(currentLocale);
    ensureSwitcher();
    scheduleApply();

    observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.target instanceof Element && mutation.target.shadowRoot) {
          observeMutationRoot(mutation.target.shadowRoot);
        }

        mutation.addedNodes.forEach((node) => {
          if (
            node instanceof Element ||
            node instanceof ShadowRoot ||
            node instanceof DocumentFragment
          ) {
            observeShadowRoots(node);
          }
        });
      });

      const hasAppMutation = mutations.some((mutation) => {
        if (!switcherRoot) {
          return true;
        }
        const target = mutation.target;
        return !(target instanceof Node) || !switcherRoot.contains(target);
      });
      if (hasAppMutation) {
        scheduleApply();
      } else {
        scheduleSwitcherPosition();
      }
    });
    observeMutationRoot(document.documentElement);
    observeShadowRoots(document);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void boot();
    }, { once: true });
  } else {
    void boot();
  }
})();

(() => {
    "use strict";

    const VERSION = "1.1.0";
    const STORAGE_KEY = "SmartPhoneBatteryTweaks.settings.v1";
    const PREFIX = "[SmartPhone Battery Tweaks]";
    const phoneMod = window.smartphone;
    const required = ["PhoneConsumption", "PhonePowerPass", "togglePhone", "toggleApp", "getUsingPhone"];
    if (!phoneMod || required.some(name => typeof phoneMod[name] !== "function")) {
        console.error(`${PREFIX} 未找到兼容的 SmartPhone Alpha 0.3.91.1，未应用补丁。`);
        return;
    }
    if (window.SmartPhoneBatteryTweaks) return;
    if (phoneMod.__batteryTweaksApplied) {
        console.error(`${PREFIX} 检测到旧版电量补丁，请移除旧版后重新加载游戏。`);
        return;
    }

    const originalValues = Object.freeze({
        naturalDrainPerMinute: phoneMod.自然电量损失每分钟,
        photoCost: phoneMod.拍照电量消耗,
        chargePerHour: phoneMod.充电速度每小时,
        overchargeDamage: phoneMod.充电损害每度电比
    });
    if (Object.values(originalValues).some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
        console.error(`${PREFIX} 手机电量参数不兼容，未应用补丁。`);
        return;
    }

    const defaults = Object.freeze({
        enabled: true,
        naturalDrainEnabled: false,
        naturalDrainPerMinute: originalValues.naturalDrainPerMinute,
        freePhoneOperations: true,
        freeAppSwitch: true,
        photoCost: 5,
        chargePerHour: 2000,
        protectOvercharge: true
    });
    const vanilla = Object.freeze({
        enabled: true,
        naturalDrainEnabled: true,
        naturalDrainPerMinute: originalValues.naturalDrainPerMinute,
        freePhoneOperations: false,
        freeAppSwitch: false,
        photoCost: originalValues.photoCost,
        chargePerHour: originalValues.chargePerHour,
        protectOvercharge: false
    });
    const numericRules = {
        naturalDrainPerMinute: [0, 100],
        photoCost: [0, 10000],
        chargePerHour: [0, 100000]
    };
    const booleanKeys = Object.keys(defaults).filter(key => !Object.hasOwn(numericRules, key));
    let config = { ...defaults };
    let storageWarning = "";

    function validate(patch, base = config) {
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("配置格式无效。");
        const result = { ...base };
        for (const [key, value] of Object.entries(patch)) {
            if (!Object.hasOwn(defaults, key)) throw new Error(`未知设置：${key}`);
            if (booleanKeys.includes(key)) {
                if (typeof value !== "boolean") throw new Error(`${key} 必须是开关值。`);
            } else {
                const [min, max] = numericRules[key];
                if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
                    throw new Error(`${key} 必须是 ${min} 到 ${max} 之间的数字。`);
                }
            }
            result[key] = value;
        }
        return result;
    }

    try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved !== null) {
            const envelope = JSON.parse(saved);
            if (envelope?.schemaVersion !== 1) throw new Error("配置版本不兼容");
            config = validate(envelope.settings, defaults);
        }
    } catch (error) {
        storageWarning = "本地配置不可读，已使用默认值；不会自动覆盖原记录。";
        console.warn(`${PREFIX} ${storageWarning}`, error);
    }

    function applyValues() {
        phoneMod.自然电量损失每分钟 = config.enabled
            ? (config.naturalDrainEnabled ? config.naturalDrainPerMinute : 0)
            : originalValues.naturalDrainPerMinute;
        phoneMod.拍照电量消耗 = config.enabled ? config.photoCost : originalValues.photoCost;
        phoneMod.充电速度每小时 = config.enabled ? config.chargePerHour : originalValues.chargePerHour;
        phoneMod.充电损害每度电比 = config.enabled && config.protectOvercharge ? 0 : originalValues.overchargeDamage;
    }

    // Only the first matching deduction made by a known operation belongs to that
    // operation. Later photo deductions (including 1 or 0.2) remain chargeable.
    const contexts = [];
    const originalConsumption = phoneMod.PhoneConsumption;
    phoneMod.PhoneConsumption = function (value, ...args) {
        const context = contexts[contexts.length - 1];
        let cost = value;
        if (context && !context.consumed && value === context.expected) {
            context.consumed = true;
            if (config.enabled && context.free()) cost = 0;
        }
        // Use the original zero-cost path too: keep low-battery / shutdown checks.
        try {
            return originalConsumption.call(this, cost, ...args);
        } finally {
            scheduleStatus();
        }
    };

    function wrapOperation(name, expected, free) {
        const original = phoneMod[name];
        phoneMod[name] = function (...args) {
            contexts.push({ expected, free, consumed: false });
            try {
                return original.apply(this, args);
            } finally {
                contexts.pop();
            }
        };
    }
    wrapOperation("togglePhone", 1, () => config.freePhoneOperations);
    wrapOperation("toggleApp", 0.2, () => config.freeAppSwitch);
    // Natural drain can also equal 1 or 0.2. Give it a non-free inner context
    // even if time passes synchronously inside a phone operation.
    const originalPowerPass = phoneMod.PhonePowerPass;
    phoneMod.PhonePowerPass = function (...args) {
        contexts.push({ expected: undefined, free: () => false, consumed: true });
        try {
            return originalPowerPass.apply(this, args);
        } finally {
            contexts.pop();
            scheduleStatus();
        }
    };

    function save(patch) {
        const next = validate(patch);
        config = next;
        applyValues();
        let persisted = true;
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, settings: config }));
            storageWarning = "";
        } catch (error) {
            persisted = false;
            storageWarning = "设置已在本次游戏中生效，但浏览器拒绝保存；刷新后可能丢失。";
            console.warn(`${PREFIX} ${storageWarning}`, error);
        }
        rerenderPanels(persisted ? "设置已保存并立即生效。" : storageWarning);
        return { settings: { ...config }, persisted };
    }

    function getStatus() {
        const state = window.State?.variables ?? window.V;
        const phones = state?.Phone?.Owned;
        if (!Array.isArray(phones)) return { phone: null };
        const phone = phones.find(item => item.id === state.Phone.Using)
            ?? phones.find(item => item.usable);
        if (!phone) return { phone: null };
        const current = Number.isFinite(phone.newness) ? Math.max(0, phone.newness) : 0;
        const maximum = Number.isFinite(phone.newnessmax) ? Math.max(0, phone.newnessmax) : 0;
        return {
            phone: { model: String(phone.model ?? "未知型号"), current, maximum },
            percent: maximum > 0 ? Math.min(100, Math.max(0, current / maximum * 100)) : 0,
            active: state.Phone.Using === phone.id
        };
    }

    window.SmartPhoneBatteryTweaks = Object.freeze({
        version: VERSION,
        storageKey: STORAGE_KEY,
        getSettings: () => ({ ...config }),
        getDefaults: () => ({ ...defaults }),
        getOriginalValues: () => ({ ...originalValues }),
        getStatus,
        update: save,
        resetDefaults: () => save(defaults),
        resetVanilla: () => save(vanilla)
    });
    phoneMod.__batteryTweaksApplied = true;
    applyValues();

    // No passage replacement or extra mod dependency: augment existing settings
    // DOM after SugarCube / SmartPhone renders it, including detached overlays.
    let panelId = 0;
    let statusPending = false;
    let mountPending = false;
    function defer(callback) {
        if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(callback);
        else window.setTimeout(callback, 0);
    }
    function scheduleStatus() {
        if (statusPending || typeof document === "undefined") return;
        statusPending = true;
        defer(() => {
            statusPending = false;
            document.querySelectorAll(".spbt-panel").forEach(updateStatus);
        });
    }
    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function updateStatus(panel) {
        const status = getStatus();
        const text = panel.querySelector(".spbt-battery-text");
        const meter = panel.querySelector("meter");
        if (!text || !meter) return;
        const summary = status.phone
            ? `${status.phone.model} · ${status.percent.toFixed(1)}%（${Number(status.phone.current.toFixed(2))} / ${Number(status.phone.maximum.toFixed(2))} 点）${status.active ? "" : " · 未开机"}`
            : "当前没有可显示的手机；仍可调整电量设置。";
        if (text.textContent !== summary) text.textContent = summary;
        meter.value = status.percent ?? 0;
        meter.hidden = !status.phone;
    }
    function renderPanel(panel, message = "") {
        panel.replaceChildren();
        const id = `spbt-${++panelId}`;
        const heading = element("h3", "spbt-heading", "电量优化设置");
        heading.id = `${id}-heading`;
        panel.setAttribute("aria-labelledby", heading.id);
        panel.append(heading, element("p", "spbt-intro", `SmartPhone Battery Tweaks ${VERSION} · 数值单位为电量点，不是百分比。`));
        const battery = element("div", "spbt-battery");
        battery.append(element("span", "spbt-battery-text"));
        const meter = element("meter");
        meter.min = 0;
        meter.max = 100;
        meter.setAttribute("aria-label", "手机剩余电量百分比");
        battery.append(meter);
        panel.append(battery);
        const form = element("form", "spbt-form");
        const controls = {};
        const fields = element("fieldset", "spbt-fields");
        fields.append(element("legend", "", "独立电量控制"));

        function toggle(key, label, parent) {
            const row = element("label", "spbt-toggle");
            const input = element("input");
            input.type = "checkbox";
            input.checked = config[key];
            input.name = key;
            controls[key] = input;
            row.append(input, element("span", "", label));
            parent.append(row);
            return input;
        }
        function number(key, label, hint, step) {
            const row = element("div", "spbt-number-row");
            const labelNode = element("label", "", label);
            const input = element("input");
            input.type = "number";
            input.id = `${id}-${key}`;
            input.name = key;
            input.min = numericRules[key][0];
            input.max = numericRules[key][1];
            input.step = step;
            input.required = true;
            input.value = config[key];
            labelNode.htmlFor = input.id;
            const help = element("small", "spbt-hint", hint);
            help.id = `${input.id}-hint`;
            input.setAttribute("aria-describedby", help.id);
            row.append(labelNode, input, help);
            fields.append(row);
            controls[key] = input;
        }
        const enabled = toggle("enabled", "启用电量优化（关闭后使用加载时的原始参数）", form);
        toggle("naturalDrainEnabled", "启用自然耗电", fields);
        number("naturalDrainPerMinute", "自然耗电 / 游戏分钟", "范围 0–100；关闭自然耗电时，此数值仅保留备用。", "any");
        toggle("freePhoneOperations", "打开／关闭手机免费", fields);
        toggle("freeAppSwitch", "切换应用免费", fields);
        number("photoCost", "每次拍照耗电", "范围 0–10000；0 为免费，1 或 0.2 也会正确扣电。", "any");
        number("chargePerHour", "场所充电 / 游戏小时", "范围 0–100000；0 为暂停场所充电，不影响充电宝向手机供电。", "any");
        toggle("protectOvercharge", "过充保护：不因过度充电损耗最大容量", fields);
        form.append(fields);
        function syncDisabled() {
            fields.disabled = !enabled.checked;
            controls.naturalDrainPerMinute.disabled = !controls.naturalDrainEnabled.checked;
        }
        enabled.addEventListener("change", syncDisabled);
        controls.naturalDrainEnabled.addEventListener("change", syncDisabled);
        syncDisabled();
        const actions = element("div", "spbt-actions");
        const apply = element("button", "spbt-primary", "保存并应用");
        apply.type = "submit";
        actions.append(apply);
        for (const [label, preset] of [["恢复 mod 默认", defaults], ["恢复原版参数", vanilla]]) {
            const button = element("button", "", label);
            button.type = "button";
            button.addEventListener("click", () => save(preset));
            actions.append(button);
        }
        form.append(actions);
        const feedback = element("p", "spbt-feedback", message || storageWarning || "修改后点击“保存并应用”。配置仅保存在当前浏览器、当前站点，不随存档导出。");
        feedback.setAttribute("role", "status");
        form.addEventListener("submit", event => {
            event.preventDefault();
            event.stopPropagation();
            const patch = {};
            for (const [key, input] of Object.entries(controls)) {
                patch[key] = input.type === "checkbox" ? input.checked : input.valueAsNumber;
            }
            try {
                save(patch);
            } catch (error) {
                feedback.textContent = `未应用：${error.message}`;
            }
        });
        panel.append(form, feedback, element("p", "spbt-warning", "保留原版规则：没电不能使用；电量耗尽关机会损失 50 点最大容量。不会自动充电、修复手机或回滚已发生的变化。场所给充电宝补电也受充电速度影响；充电宝向手机供电仍为原版速度。充电速度会影响尚未结算的整个充电时段，建议先取回设备再调整。"));
        updateStatus(panel);
    }
    function rerenderPanels(message) {
        if (typeof document === "undefined") return;
        document.querySelectorAll(".spbt-panel").forEach(panel => renderPanel(panel, message));
    }
    function mountPanel(host, kind) {
        if (host.querySelector(`.spbt-panel[data-spbt-host="${kind}"]`)) return;
        const panel = element("section", "spbt-panel");
        panel.dataset.spbtHost = kind;
        // Do not let SmartPhone's space shortcut or game shortcuts consume form input.
        for (const event of ["keydown", "keyup"]) panel.addEventListener(event, ev => ev.stopPropagation());
        renderPanel(panel);
        host.append(panel);
    }
    function mountPanels() {
        document.querySelectorAll(".settingsHeader").forEach(header => {
            if (/智能手机|SmartPhone/i.test(header.textContent)) {
                const grid = header.closest(".settingsGrid");
                if (grid) mountPanel(grid, "game");
            }
        });
        document.querySelectorAll("#phone-content").forEach(host => {
            const heading = host.querySelector("h2");
            if (heading && /系统设置|System Settings/i.test(heading.textContent)) mountPanel(host, "phone");
        });
        scheduleStatus();
    }
    function scheduleMount() {
        if (mountPending) return;
        mountPending = true;
        defer(() => {
            mountPending = false;
            mountPanels();
        });
    }
    function initUI() {
        if (typeof window.MutationObserver === "function") {
            const observer = new window.MutationObserver(records => {
                if (records.some(record => !record.target.closest?.(".spbt-panel"))) scheduleMount();
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
        if (typeof window.jQuery === "function") window.jQuery(document).on(":passageend.spbt", scheduleMount);
        mountPanels();
    }
    if (typeof document !== "undefined") {
        if (document.body) initUI();
        else document.addEventListener("DOMContentLoaded", initUI, { once: true });
    }
    console.info(`${PREFIX} ${VERSION} 已启用，可在游戏设置或手机系统设置中调整。`);
})();

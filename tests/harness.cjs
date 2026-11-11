const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/scripts/battery-tweaks.js'), 'utf8');
const key = 'SmartPhoneBatteryTweaks.settings.v1';

// Independently authored minimal behavioral fixture, not redistributed game code.
function createHarness(options = {}) {
    const phone = { id: 'test-phone', model: 'Test phone', usable: true, newness: 1000, newnessmax: 1000 };
    const state = { Phone: { Owned: [phone], Using: phone.id } };
    const storage = options.storage ?? new Map();
    const calls = [];
    const logs = [];
    let checks = 0;
    const smartphone = {
        自然电量损失每分钟: 0.3,
        拍照电量消耗: 30,
        充电速度每小时: 500,
        充电损害每度电比: 0.01,
        getUsingPhone(allowShutdown = false) {
            return state.Phone.Owned.find(item => item.id === state.Phone.Using)
                ?? (allowShutdown ? state.Phone.Owned.find(item => item.usable) : null);
        },
        PhoneConsumption(cost) {
            calls.push({ cost, receiver: this });
            const current = this.getUsingPhone();
            if (!current || current.newness <= 0) return false;
            current.newness -= cost;
            checks++;
            if (current.newness <= 0) {
                current.newness = 0;
                current.newnessmax -= 50;
                state.Phone.Using = 'null';
                return false;
            }
            if (current.newness / current.newnessmax < 0.2) state.Phone.lowbatteryAlerted = true;
            return true;
        },
        togglePhone(...args) {
            const result = this.PhoneConsumption(1);
            if (result && options.afterPhone) options.afterPhone(this, args);
            return result;
        },
        toggleApp(...args) {
            const result = this.PhoneConsumption(0.2);
            if (result && options.afterApp) options.afterApp(this, args);
            return result;
        },
        PhonePowerPass(minutes) {
            if (minutes > 0) return this.PhoneConsumption(minutes * this.自然电量损失每分钟);
            return undefined;
        }
    };
    const window = {
        smartphone,
        State: { variables: state },
        localStorage: {
            getItem(name) {
                if (options.readFailure) throw new Error('Storage unavailable');
                return storage.get(name) ?? null;
            },
            setItem(name, value) {
                if (options.writeFailure) throw new Error('Quota exceeded');
                storage.set(name, value);
            }
        }
    };
    const context = vm.createContext({
        window,
        console: Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (...args) => logs.push({ level, args })]))
    });
    function run() { vm.runInContext(source, context); }
    if (options.beforeLoad) options.beforeLoad(smartphone, window);
    if (!options.deferLoad) run();
    return { window, smartphone, state, phone, calls, logs, storage, context, run,
        get api() { return window.SmartPhoneBatteryTweaks; },
        get checks() { return checks; }
    };
}

module.exports = { createHarness, source, key };

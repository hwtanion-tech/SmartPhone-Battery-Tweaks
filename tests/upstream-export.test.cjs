const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const { createHarness } = require('./harness.cjs');

// Optional local verification: read original functions directly from a user-owned
// export ZIP, in memory only. Game code is not copied into the project or Git.
const exportPath = process.env.SPBT_EXPORT_PATH;
test('integration with original SmartPhone 0.3.91.1 functions', { skip: !exportPath }, async t => {
    const python = String.raw`
import json, re, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    src = z.read('js/scripts/smartphone-main.js').decode('utf-8-sig').replace('\r\n', '\n')
    names = ['PhoneConsumption', 'PhonePowerPass', 'PhoneCharge', 'PhoneWaer', 'PhoneCheckNewness', 'togglePhone', 'toggleApp']
    out = {}
    for name in names:
        start = src.index('smartphone.' + name + ' = function')
        end = src.index('\n}', start) + 2
        out[name] = src[start:end]
    print(json.dumps(out, ensure_ascii=True))
`;
    const functions = JSON.parse(execFileSync('python', ['-c', python, exportPath], { encoding: 'utf8' }));
    function harness() {
        const h = createHarness({ deferLoad: true });
        h.context.smartphone = h.smartphone;
        h.context.V = h.state;
        h.context.T = {};
        h.context.asi = { log() {}, addStoryCaptionContent() {} };
        h.context.Time = { date: { timeStamp: 100 } };
        h.context.document = { getElementById: () => null, querySelectorAll: () => [] };
        h.smartphone.PhoneUIInit = () => {};
        h.smartphone.PhoneSafeClose = () => {};
        h.smartphone.msgSend = () => {};
        h.smartphone.changeUsingPhone = () => { h.state.Phone.Using = 'null'; return false; };
        for (const code of Object.values(functions)) vm.runInContext(code, h.context);
        // Loading the mod without a DOM exercises only the actual game logic.
        delete h.context.document;
        h.run();
        h.window.setTimeout = callback => callback();
        h.context.document = { getElementById: () => null, querySelectorAll: () => [] };
        return h;
    }
    await t.test('original togglePhone free vs paid and direct 1-point photo', () => {
        const h = harness();
        h.smartphone.togglePhone();
        assert.equal(h.phone.newness, 1000);
        h.api.update({ freePhoneOperations: false, photoCost: 1 });
        h.smartphone.togglePhone();
        assert.equal(h.phone.newness, 999);
        h.smartphone.PhoneConsumption(h.smartphone.拍照电量消耗);
        assert.equal(h.phone.newness, 998);
    });
    await t.test('original toggleApp free vs paid', () => {
        const h = harness();
        h.smartphone.appInit = () => {};
        h.smartphone.toggleApp('settings');
        assert.equal(h.phone.newness, 1000);
        h.api.update({ freeAppSwitch: false });
        h.smartphone.toggleApp('settings');
        assert.equal(h.phone.newness, 999.8);
    });
    await t.test('original natural drain and powerbank transfer remain independent', () => {
        const h = harness();
        h.smartphone.充电宝充电每分钟 = 5;
        h.smartphone.充电损害阈值 = 10;
        h.phone.newness = 500;
        h.state.Phone.Charging = true;
        h.state.Phone.PowerBank = { newness: 100 };
        h.smartphone.PhonePowerPass(10);
        assert.equal(h.phone.newness, 550);
        assert.equal(h.state.Phone.PowerBank.newness, 50);
        h.api.update({ naturalDrainEnabled: true, naturalDrainPerMinute: 1 });
        h.state.Phone.Charging = false;
        h.smartphone.PhonePowerPass(1);
        assert.equal(h.phone.newness, 549);
    });
    await t.test('original overcharge loss is protected only while enabled', () => {
        const h = harness();
        h.smartphone.充电损害阈值 = 10;
        h.smartphone.PhoneCharge(100, h.phone);
        assert.equal(h.phone.newnessmax, 1000);
        h.api.update({ protectOvercharge: false });
        h.smartphone.PhoneCharge(100, h.phone);
        assert.equal(h.phone.newnessmax, 999);
    });
    await t.test('original shutdown still loses 50 capacity and returns false', () => {
        const h = harness();
        h.phone.newness = 1;
        assert.equal(h.smartphone.PhoneConsumption(5), false);
        assert.equal(h.phone.newness, 0);
        assert.equal(h.phone.newnessmax, 950);
        assert.equal(h.state.Phone.Using, 'null');
    });
});

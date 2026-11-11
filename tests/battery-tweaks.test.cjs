const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, key } = require('./harness.cjs');

test('default parameter changes do not mutate phone/save data', () => {
    const h = createHarness();
    assert.equal(h.api.version, '1.1.0');
    assert.equal(h.smartphone.自然电量损失每分钟, 0);
    assert.equal(h.smartphone.拍照电量消耗, 5);
    assert.equal(h.smartphone.充电速度每小时, 2000);
    assert.equal(h.smartphone.充电损害每度电比, 0);
    assert.equal(h.phone.newness, 1000);
    assert.equal(h.phone.newnessmax, 1000);
    assert.deepEqual(Object.keys(h.state.Phone), ['Owned', 'Using']);
    assert.equal(h.storage.size, 0);
});

test('free operations retain original checks and receiver', () => {
    const h = createHarness();
    h.phone.newness = 150;
    assert.equal(h.smartphone.togglePhone(), true);
    assert.equal(h.smartphone.toggleApp('settings'), true);
    assert.equal(h.phone.newness, 150);
    assert.equal(h.checks, 2);
    assert.equal(h.state.Phone.lowbatteryAlerted, true);
    assert.deepEqual(h.calls.map(call => call.cost), [0, 0]);
    assert.ok(h.calls.every(call => call.receiver === h.smartphone));
});

test('no phone and dead phone still reject free operations', () => {
    const h = createHarness();
    h.phone.newness = 0;
    assert.equal(h.smartphone.togglePhone(), false);
    h.state.Phone.Owned = [];
    assert.equal(h.smartphone.toggleApp('settings'), false);
});

for (const cost of [0, 0.2, 1, 5, 30]) {
    test(`direct photo deductions of ${cost} are never mistaken for operation fees`, () => {
        const h = createHarness();
        h.api.update({ photoCost: cost });
        h.smartphone.PhoneConsumption(h.smartphone.拍照电量消耗);
        assert.equal(h.phone.newness, 1000 - cost);
    });
    test(`photo ${cost} inside a phone action remains independent`, () => {
        const h = createHarness({ afterPhone: s => s.PhoneConsumption(s.拍照电量消耗) });
        h.api.update({ photoCost: cost });
        h.smartphone.togglePhone();
        assert.equal(h.phone.newness, 1000 - cost);
        assert.deepEqual(h.calls.map(call => call.cost), [0, cost]);
    });
}

test('operation toggles are independent', () => {
    const h = createHarness();
    h.api.update({ freePhoneOperations: false });
    h.smartphone.togglePhone();
    h.smartphone.toggleApp('settings');
    assert.equal(h.phone.newness, 999);
    h.api.update({ freePhoneOperations: true, freeAppSwitch: false });
    h.smartphone.togglePhone();
    h.smartphone.toggleApp('settings');
    assert.equal(h.phone.newness, 998.8);
});

test('nested application calls have separate contexts', () => {
    const h = createHarness({ afterPhone: s => s.toggleApp('settings') });
    h.api.update({ freeAppSwitch: false });
    h.smartphone.togglePhone();
    assert.deepEqual(h.calls.map(call => call.cost), [0, 0.2]);
});

test('natural drain equal to operation costs still charges, including nested time passage', () => {
    const h = createHarness({ afterPhone: s => s.PhonePowerPass(5) });
    h.api.update({ naturalDrainEnabled: true, naturalDrainPerMinute: 0.2 });
    h.smartphone.PhonePowerPass(1);
    h.smartphone.togglePhone();
    assert.equal(h.phone.newness, 998.8);
    assert.deepEqual(h.calls.map(call => call.cost), [0.2, 0, 1]);
});

test('exceptions clean up the operation context', () => {
    const h = createHarness({ afterPhone: () => { throw new Error('upstream exception'); } });
    assert.throws(() => h.smartphone.togglePhone(), /upstream exception/);
    h.smartphone.PhoneConsumption(1);
    assert.equal(h.phone.newness, 999);
});

test('depletion still shuts down and loses 50 maximum capacity', () => {
    const h = createHarness();
    h.phone.newness = 3;
    assert.equal(h.smartphone.PhoneConsumption(5), false);
    assert.equal(h.phone.newness, 0);
    assert.equal(h.phone.newnessmax, 950);
    assert.equal(h.state.Phone.Using, 'null');
});

test('master switch restores original scalars and deductions without discarding custom values', () => {
    const h = createHarness();
    h.api.update({ enabled: false, photoCost: 7 });
    assert.equal(h.smartphone.拍照电量消耗, 30);
    assert.equal(h.smartphone.自然电量损失每分钟, 0.3);
    assert.equal(h.smartphone.充电速度每小时, 500);
    assert.equal(h.smartphone.充电损害每度电比, 0.01);
    h.smartphone.togglePhone();
    assert.equal(h.phone.newness, 999);
    h.api.update({ enabled: true });
    assert.equal(h.smartphone.拍照电量消耗, 7);
});

test('both reset presets apply immediately; originals are captured instead of guessed', () => {
    const h = createHarness({ beforeLoad: s => { s.充电速度每小时 = 650; } });
    h.api.resetVanilla();
    assert.equal(h.smartphone.充电速度每小时, 650);
    assert.equal(h.smartphone.自然电量损失每分钟, 0.3);
    assert.equal(h.smartphone.拍照电量消耗, 30);
    assert.equal(h.smartphone.充电损害每度电比, 0.01);
    assert.equal(h.api.getSettings().freeAppSwitch, false);
    h.api.resetDefaults();
    assert.equal(h.smartphone.充电速度每小时, 2000);
    assert.equal(h.api.getSettings().freeAppSwitch, true);
});

test('settings persist across reloads but do not modify save state', () => {
    const first = createHarness();
    const result = first.api.update({ photoCost: 0.2, naturalDrainEnabled: true });
    assert.equal(result.persisted, true);
    const second = createHarness({ storage: first.storage });
    assert.equal(second.smartphone.拍照电量消耗, 0.2);
    assert.equal(second.smartphone.自然电量损失每分钟, 0.3);
    assert.equal(second.phone.newness, 1000);
    assert.deepEqual(Object.keys(second.state.Phone), ['Owned', 'Using']);
});

test('invalid updates are atomic and do not overwrite storage', () => {
    const h = createHarness();
    const invalid = [
        { photoCost: -1 }, { photoCost: Infinity }, { photoCost: NaN }, { photoCost: '5' },
        { photoCost: 10001 }, { naturalDrainPerMinute: 101 }, { chargePerHour: 100001 },
        { enabled: 1 }, { badKey: true }, null, [], { photoCost: 10, chargePerHour: -1 }
    ];
    for (const patch of invalid) assert.throws(() => h.api.update(patch));
    assert.equal(h.smartphone.拍照电量消耗, 5);
    assert.equal(h.storage.size, 0);
});

test('numeric boundaries and fractional values work', () => {
    const h = createHarness();
    h.api.update({ naturalDrainEnabled: true, naturalDrainPerMinute: 100, photoCost: 10000, chargePerHour: 100000 });
    assert.equal(h.smartphone.充电速度每小时, 100000);
    h.api.update({ naturalDrainPerMinute: 0, photoCost: 0, chargePerHour: 0 });
    assert.equal(h.smartphone.充电速度每小时, 0);
    h.api.update({ photoCost: 0.125 });
    assert.equal(h.smartphone.拍照电量消耗, 0.125);
});

for (const saved of ['not-json', '{"schemaVersion":2,"settings":{}}', '{"schemaVersion":1,"settings":{"photoCost":-1}}']) {
    test(`bad stored config falls back without destroying the original: ${saved}`, () => {
        const storage = new Map([[key, saved]]);
        const h = createHarness({ storage });
        assert.equal(h.smartphone.拍照电量消耗, 5);
        assert.equal(storage.get(key), saved);
        assert.ok(h.logs.some(log => log.level === 'warn'));
    });
}

test('unavailable storage does not prevent runtime configuration', () => {
    const h = createHarness({ readFailure: true, writeFailure: true });
    const result = h.api.update({ photoCost: 10 });
    assert.equal(result.persisted, false);
    assert.equal(h.smartphone.拍照电量消耗, 10);
});

test('settings getters do not leak writable references', () => {
    const h = createHarness();
    h.api.getSettings().photoCost = 999;
    h.api.getDefaults().photoCost = 999;
    assert.equal(h.api.getSettings().photoCost, 5);
    assert.equal(h.api.getDefaults().photoCost, 5);
});

test('status supports dead phones, missing phones and uninitialized state without mutation', () => {
    const h = createHarness();
    assert.equal(h.api.getStatus().percent, 100);
    h.phone.newness = 0;
    h.state.Phone.Using = 'null';
    assert.equal(h.api.getStatus().percent, 0);
    assert.equal(h.api.getStatus().active, false);
    h.phone.newnessmax = 0;
    assert.equal(h.api.getStatus().percent, 0);
    h.state.Phone.Owned = [];
    assert.equal(h.api.getStatus().phone, null);
    delete h.window.State;
    assert.equal(h.api.getStatus().phone, null);
});

test('repeated execution does not double-wrap', () => {
    const h = createHarness();
    const originalWrapper = h.smartphone.PhoneConsumption;
    h.run();
    assert.equal(h.smartphone.PhoneConsumption, originalWrapper);
    h.smartphone.togglePhone();
    assert.equal(h.checks, 1);
});

for (const change of [s => { delete s.toggleApp; }, s => { s.充电速度每小时 = NaN; }, s => { s.__batteryTweaksApplied = true; }]) {
    test('incompatible or legacy runtime refuses installation safely', () => {
        const h = createHarness({ beforeLoad: change });
        assert.equal(h.api, undefined);
        assert.equal(h.smartphone.拍照电量消耗, 30);
        assert.ok(h.logs.some(log => log.level === 'error'));
    });
}

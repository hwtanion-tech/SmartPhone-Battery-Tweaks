/* Run only in the standalone demo: await runBatterySmokeTests(). */
window.runBatterySmokeTests = async function () {
    "use strict";
    const checks = [];
    function check(name, condition) {
        if (!condition) throw new Error(`Browser smoke test failed: ${name}`);
        checks.push(name);
    }
    const frame = () => new Promise(window.requestAnimationFrame);
    const api = window.SmartPhoneBatteryTweaks;
    const beforeSettings = api.getSettings();
    const phone = V.Phone.Owned[0];
    const beforePhone = { ...phone };
    const beforeUsing = V.Phone.Using;
    let dynamic;
    try {
        phone.newness = 750;
        phone.newnessmax = 1000;
        V.Phone.Using = phone.id;
        api.resetDefaults();
        check('dual entry panels', document.querySelectorAll('.spbt-panel').length === 2);
        const panel = document.querySelector('.spbt-panel');
        panel.querySelector('[name="photoCost"]').value = '1';
        panel.querySelector('form').requestSubmit();
        check('form saves 1-point photo', api.getSettings().photoCost === 1);
        check('both forms synchronize', [...document.querySelectorAll('[name="photoCost"]')].every(input => input.value === '1'));
        smartphone.togglePhone();
        check('free operation keeps battery', phone.newness === 750);
        smartphone.PhoneConsumption(smartphone.拍照电量消耗);
        check('1-point photo still charges', phone.newness === 749);
        await frame();
        check('battery text updates', panel.querySelector('.spbt-battery-text').textContent.includes('749 / 1000'));
        panel.querySelector('[name="enabled"]').click();
        check('master switch disables fields', panel.querySelector('fieldset').disabled);
        panel.querySelector('form').requestSubmit();
        check('disabled master restores photo parameter', smartphone.拍照电量消耗 === 30);
        api.resetVanilla();
        check('vanilla preset restores charging', smartphone.充电速度每小时 === 500);
        api.resetDefaults();
        const invalid = panel.querySelector('[name="photoCost"]');
        invalid.value = '-1';
        check('negative input fails validation', !invalid.checkValidity());
        api.resetDefaults();
        panel.querySelector('[name="naturalDrainEnabled"]').click();
        check('natural drain input enables', !panel.querySelector('[name="naturalDrainPerMinute"]').disabled);
        panel.querySelector('[name="naturalDrainPerMinute"]').value = '0.2';
        panel.querySelector('form').requestSubmit();
        check('natural drain saves fraction', smartphone.自然电量损失每分钟 === 0.2);
        const phoneHost = document.getElementById('phone-content');
        check('phone layout does not overflow', phoneHost.scrollWidth <= phoneHost.clientWidth + 1);
        dynamic = document.createElement('div');
        dynamic.className = 'settingsGrid';
        dynamic.innerHTML = '<div class="settingsHeader">万能的智能手机模组设置</div>';
        document.body.append(dynamic);
        await frame();
        await frame();
        check('async settings receive panel', dynamic.querySelectorAll('.spbt-panel').length === 1);
        dynamic.append(document.createElement('span'));
        await frame();
        await frame();
        check('repeated mutation does not duplicate', dynamic.querySelectorAll('.spbt-panel').length === 1);
        dynamic.remove();
        phone.newness = 0;
        V.Phone.Using = 'null';
        smartphone.PhoneConsumption(0);
        await frame();
        check('dead phone status renders', panel.querySelector('.spbt-battery-text').textContent.includes('0.0%'));
        check('dead phone cannot operate', smartphone.togglePhone() === false);
        api.update({ photoCost: 0.2 });
        check('storage envelope is written', JSON.parse(localStorage.getItem(api.storageKey)).settings.photoCost === 0.2);
        check('no fields added to game state', Object.keys(V.Phone).join(',') === 'Using,Owned');
        return { passed: checks.length, checks };
    } finally {
        dynamic?.remove();
        Object.assign(phone, beforePhone);
        V.Phone.Using = beforeUsing;
        api.update(beforeSettings);
    }
};

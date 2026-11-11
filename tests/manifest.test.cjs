const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('manifest lists only project-owned files and versions agree', () => {
    const root = path.join(__dirname, '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/boot.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.version, pkg.version);
    assert.equal(manifest.name, 'SmartPhone Battery Tweaks');
    assert.equal(manifest.dependenceInfo.find(dep => dep.modName === 'SmartPhone Alpha').version, '0.3.91.1');
    for (const key of ['scriptFileList', 'styleFileList', 'tweeFileList', 'imgFileList', 'additionFile']) {
        for (const file of manifest[key]) {
            assert.ok(!file.includes('..'));
            assert.ok(fs.statSync(path.join(root, 'src', file)).isFile());
        }
    }
});

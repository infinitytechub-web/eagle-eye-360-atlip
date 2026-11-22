'use strict';
const test = require('node:test'); const assert = require('node:assert');
const s = require('../security');
const CC = 'A'.repeat(43), CODE = 'b'.repeat(43);
test('only the ATLIP origin is an app URL', () => {
  assert.ok(s.isAppUrl('https://atlip.infinitytechub.com/#/dashboard'));
  for (const u of ['http://atlip.infinitytechub.com/', 'https://atlip.infinitytechub.com.evil.com/', 'https://evil.com/?https://atlip.infinitytechub.com', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url'])
    assert.equal(s.isAppUrl(u), false, u);
});
test('external links: web and mail only', () => {
  assert.ok(s.isSafeExternal('https://openstreetmap.org')); assert.ok(s.isSafeExternal('mailto:a@b.c'));
  for (const u of ['file:///C:/Windows/system32/calc.exe', 'smb://host/share', 'javascript:alert(1)', 'ms-msdt:/id', 'gh.infinitytechub.atlip://auth?code=x'])
    assert.equal(s.isSafeExternal(u), false, u);
});
test('bridge opens only the passkey hand-off page', () => {
  assert.ok(s.isHandoffUrl(`https://atlip.infinitytechub.com/#/native-login?cc=${CC}`));
  for (const u of [`https://evil.com/#/native-login?cc=${CC}`, `https://atlip.infinitytechub.com/#/native-login?cc=short`, `https://atlip.infinitytechub.com/#/dashboard`,
    `https://atlip.infinitytechub.com/x#/native-login?cc=${CC}`, `https://atlip.infinitytechub.com/#/native-login?cc=${CC}&next=https://evil.com`])
    assert.equal(s.isHandoffUrl(u), false, u);
});
test('auth callback parsing', () => {
  const ok = `gh.infinitytechub.atlip://auth?code=${CODE}`;
  assert.equal(s.authCallbackFrom(['/usr/bin/atlip', '--flag', ok]), ok);
  assert.equal(s.authCallbackFrom([`gh.infinitytechub.atlip://evil?code=${CODE}`]), null);
  assert.equal(s.authCallbackFrom(['gh.infinitytechub.atlip://auth?code=<script>']), null);
  assert.equal(s.authCallbackFrom(['gh.infinitytechub.atlip://auth']), null);
  assert.equal(s.authCallbackFrom([]), null);
});
test('permissions: only listed ones, only for the ATLIP origin', () => {
  assert.ok(s.allowPermission('geolocation', 'https://atlip.infinitytechub.com/#/voice'));
  assert.ok(s.allowPermission('media', 'https://atlip.infinitytechub.com/'));
  assert.equal(s.allowPermission('geolocation', 'https://evil.com/'), false);
  for (const p of ['hid', 'serial', 'usb', 'openExternal', 'midiSysex', 'pointerLock', 'display-capture']) assert.equal(s.allowPermission(p, 'https://atlip.infinitytechub.com/'), false, p);
});

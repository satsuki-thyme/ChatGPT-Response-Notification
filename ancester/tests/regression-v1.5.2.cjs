const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/../chatgpt-response-favicon.user.js', 'utf8');
const results = [];
function test(name, fn) {
  try { fn(); results.push({name,result:'PASS'}); console.log('PASS', name); }
  catch (e) { results.push({name,result:'FAIL',error:e.message}); console.error('FAIL', name, e.message); process.exitCode = 1; }
}
test('Version is 1.5.2', () => assert.match(source, /@version\s+1\.5\.2[\s\S]*const VERSION = '1\.5\.2';/));
test('Ordinary progress notifications are suppressed', () => assert.match(source, /errorActive \|\| !recovered\)[\s\S]{0,250}return;/));
test('Recovered work can still emit resumed notification', () => assert.match(source, /pending\.desktopProgressKind = 'resumed';[\s\S]{0,250}desktopNotify\('resumed'\)/));
test('New waits start with stall acknowledgement disabled', () => assert.match(source, /stallWarned: false, stallAcknowledged: false/));
test('Opening or focusing the tab acknowledges the current wait', () => assert.match(source, /visibilitychange[\s\S]{0,120}acknowledge\(true\)[\s\S]{0,180}focus[\s\S]{0,120}acknowledge\(true\)/));
test('Acknowledged waits do not emit the same stall', () => assert.match(source, /!pending\.stallWarned && !pending\.stallAcknowledged && !completing/));
test('Fresh visible progress re-enables stall monitoring', () => assert.match(source, /progressChanged[\s\S]{0,650}pending\.stallAcknowledged = false;/));
test('Notification still does not request highlight', () => assert.match(source, /highlight:\s*false/));
test('Notification still does not call window.focus', () => assert.doesNotMatch(source, /window\.focus\s*\(/));
fs.writeFileSync(__dirname + '/results-v1.5.2.json', JSON.stringify(results, null, 2) + '\n');
if (results.some(r => r.result !== 'PASS')) process.exit(1);

const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/../chatgpt-response-favicon.user.js', 'utf8');
const results = [];
function test(name, fn) {
  try { fn(); results.push({name,result:'PASS'}); console.log('PASS', name); }
  catch (e) { results.push({name,result:'FAIL',error:e.message}); console.error('FAIL', name, e.message); process.exitCode = 1; }
}
test('Notification does not request highlight', () => assert.match(source, /highlight:\s*false/));
test('Notification no longer calls window.focus', () => assert.doesNotMatch(source, /window\.focus\s*\(/));
test('window.focus grant removed', () => assert.doesNotMatch(source, /@grant\s+window\.focus/));
test('Completion grace increased to 3 seconds', () => assert.match(source, /const GRACE_MS = 3000;/));
test('Visible progress resets completion candidate', () => assert.match(source, /progressChanged[\s\S]{0,500}pending\.stoppedAt = null;[\s\S]{0,200}pending\.quietAt = performance\.now\(\);/));
test('Action-control changes reset completion candidate', () => assert.match(source, /state\.signature !== pending\.signature \|\| state\.actions !== pending\.actions[\s\S]{0,300}pending\.stoppedAt = null;/));
fs.writeFileSync(__dirname + '/results-v1.5.1.json', JSON.stringify(results, null, 2) + '\n');
if (results.some(r => r.result !== 'PASS')) process.exit(1);

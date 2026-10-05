const assert = require('node:assert/strict');

module.exports = async ({test, fixture, send, output, streaming, hidden, assertOriginal, workAnswer, workUser, ORIGINAL}) => {
    const MINUTE = 60000;
    const info = p => p.evaluate(() => window.__chatgptResponseFaviconV2.inspect());
    const kind = async p => (await info(p)).notification;
    const uiError = (p, text = 'Something went wrong. Please try again.') => p.evaluate(text => {
        let node = document.getElementById('failure');
        if (!node) { node = document.createElement('div'); node.id='failure'; node.setAttribute('role','alert'); document.body.append(node); }
        node.textContent = text;
    }, text);
    const clearError = p => p.evaluate(() => document.getElementById('failure')?.remove());
    const workSend = p => p.evaluate(() => document.getElementById('work-editor').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true})));
    const workAppend = (p, html) => p.evaluate(html => document.getElementById('conversation').insertAdjacentHTML('beforeend',html),html);

    await test('No request: long idle time, error message and offline status do not notify', async () => {
        const p=await fixture();await uiError(p);
        await p.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,value:false}));
        await p.clock.jump(60*MINUTE);assert.equal(await kind(p),'none');assert.equal((await info(p)).waiting,false);await p.close();
    });
    await test('Waiting without Stop lasts past 10 minutes and warns at the 30-minute boundary', async () => {
        const p=await fixture();await send(p);await p.clock.jump(30*MINUTE-100);
        assert.equal(await kind(p),'none');assert.equal((await info(p)).waiting,true);
        await p.clock.runFor(600);assert.equal(await kind(p),'stalled');assert.equal((await info(p)).lastNotification,'stalled');await p.close();
    });
    await test('A stuck Stop control warns after 30 minutes', async () => {
        const p=await fixture();await send(p);await streaming(p,true);await p.clock.jump(30*MINUTE);
        assert.equal(await kind(p),'stalled');assert.equal((await info(p)).generating,true);await p.close();
    });
    await test('Real Work progress without action buttons resets the timeout', async () => {
        const p=await fixture({work:true});await workSend(p);await streaming(p,true);
        await workAppend(p,workAnswer('progress','Step one',false));await p.clock.runFor(100);
        await p.clock.jump(29*MINUTE);
        await p.evaluate(()=>document.querySelector('#work-progress .whitespace-pre-wrap').textContent='Step two');await p.clock.runFor(100);
        await p.clock.jump(2*MINUTE);assert.equal(await kind(p),'none');
        await p.clock.jump(28*MINUTE);assert.equal(await kind(p),'stalled');await p.close();
    });
    await test('Timer text, spinner markup and same-content DOM replacement do not count as progress', async () => {
        const p=await fixture({work:true});await workSend(p);await streaming(p,true);
        await workAppend(p,workAnswer('timer','<span>Working</span><span role="timer">00:01</span><span>Thinking for 1 second</span>',false));await p.clock.runFor(100);
        await p.clock.jump(29*MINUTE);
        await p.evaluate(()=>{document.querySelector('#work-timer .whitespace-pre-wrap').innerHTML='<span>Working</span><span role="timer">29:01</span><span>Thinking for 29 minutes</span><svg class="spinner"></svg>';});
        await p.clock.runFor(100);await p.clock.jump(MINUTE);
        assert.equal(await kind(p),'stalled');await p.close();
    });
    await test('Acknowledged stall is not repeated until there is fresh progress', async () => {
        const p=await fixture();await send(p);await streaming(p,true);await p.clock.jump(30*MINUTE);
        assert.equal(await kind(p),'stalled');await hidden(p,false);await assertOriginal(p);await hidden(p,true);
        await p.clock.jump(30*MINUTE);assert.equal(await kind(p),'none');
        await output(p,'resume','Continuing',false);await p.clock.jump(30*MINUTE);assert.equal(await kind(p),'stalled');await p.close();
    });
    await test('Progress clears amber; a later completed answer becomes green', async () => {
        const p=await fixture();await send(p);await streaming(p,true);await p.clock.jump(30*MINUTE);
        await output(p,'recover','Finished');assert.equal(await kind(p),'none');
        await streaming(p,false);await p.clock.runFor(3000);assert.equal(await kind(p),'done');await hidden(p,false);await assertOriginal(p);await p.close();
    });
    await test('Persistent visible generation error becomes red and never green while present', async () => {
        const p=await fixture();await send(p);await streaming(p,true);await output(p,'partial','Partial answer');
        await uiError(p,'エラーが発生しました。もう一度お試しください。');await streaming(p,false);
        await p.clock.runFor(1000);assert.equal(await kind(p),'none');await p.clock.runFor(2500);
        assert.equal(await kind(p),'error');await p.clock.runFor(3000);assert.equal(await kind(p),'error');await p.close();
    });
    await test('A brief error that disappears before grace time does not alert', async () => {
        const p=await fixture();await send(p);await uiError(p);await p.clock.runFor(500);await clearError(p);await p.clock.runFor(3000);
        assert.equal(await kind(p),'none');await output(p,'brief','Recovered answer');await p.clock.runFor(3000);assert.equal(await kind(p),'done');await p.close();
    });
    await test('Answer prose, code examples, hidden alerts and user messages mentioning errors are ignored', async () => {
        const p=await fixture();await send(p);await streaming(p,true);
        await output(p,'explain','An error occurred is an example. <pre><code><span role="alert">Network error</span></code></pre><div role="alert" hidden>Something went wrong</div>');
        await p.evaluate(()=>document.getElementById('conversation').insertAdjacentHTML('beforeend','<div data-turn="user"><div role="alert">エラーが発生</div></div>'));
        await p.clock.runFor(3000);assert.equal(await kind(p),'none');await streaming(p,false);await p.clock.runFor(3000);assert.equal(await kind(p),'done');await p.close();
    });
    await test('An existing error is ignored until it disappears and reappears', async () => {
        const p=await fixture();await uiError(p);await send(p);await p.clock.runFor(3000);assert.equal(await kind(p),'none');
        await clearError(p);await p.clock.runFor(100);await uiError(p);await p.clock.runFor(3000);assert.equal(await kind(p),'error');await p.close();
    });
    await test('Disappearing error cannot turn an unchanged partial answer into green', async () => {
        const p=await fixture();await send(p);await streaming(p,true);await output(p,'failed','Partial answer');
        await uiError(p);await streaming(p,false);await p.clock.runFor(3000);assert.equal(await kind(p),'error');
        await clearError(p);await p.clock.runFor(4000);assert.equal(await kind(p),'error');
        await output(p,'recovered','Final answer');await p.clock.runFor(3000);assert.equal(await kind(p),'done');await p.close();
    });
    await test('Retry does not ignore the still-visible current error', async () => {
        const p=await fixture();await send(p);await streaming(p,true);await output(p,'retry-failed','Partial');
        await uiError(p);await streaming(p,false);await p.clock.runFor(3000);
        await p.evaluate(()=>{const b=document.createElement('button');b.textContent='Retry';document.body.append(b);b.click();});
        await streaming(p,true);await streaming(p,false);await p.clock.runFor(3500);
        assert.equal(await kind(p),'error');await clearError(p);await output(p,'retry-done','Final');await p.clock.runFor(3000);assert.equal(await kind(p),'done');await p.close();
    });
    await test('Acknowledged error does not repeat while unchanged, but reappearing error does', async () => {
        const p=await fixture();await send(p);await uiError(p);await p.clock.runFor(3000);assert.equal(await kind(p),'error');
        await hidden(p,false);await hidden(p,true);await p.clock.runFor(5000);assert.equal(await kind(p),'none');
        await clearError(p);await p.clock.runFor(100);await uiError(p);await p.clock.runFor(3000);assert.equal(await kind(p),'error');await p.close();
    });
    await test('Offline while waiting alerts; network recovery plus a final answer restores success', async () => {
        const p=await fixture();await send(p);
        await p.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event('offline'));});
        await p.clock.runFor(3000);assert.equal(await kind(p),'error');
        await p.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:true});window.dispatchEvent(new Event('online'));});
        await output(p,'online','Connected and finished');await p.clock.runFor(3000);assert.equal(await kind(p),'done');await p.close();
    });
    await test('Stop cancellation and conversation navigation cancel pending stall alerts', async () => {
        for(const cancel of ['stop','navigate']) {
            const p=await fixture();await send(p);await streaming(p,true);
            if(cancel==='stop') await p.evaluate(()=>{document.querySelector('[data-testid="stop-button"]').click();document.getElementById('stop-host').replaceChildren();});
            else await p.evaluate(()=>{history.pushState({},'', '/c/different');document.getElementById('stop-host').replaceChildren();});
            await p.clock.runFor(1000);await p.clock.jump(31*MINUTE);assert.equal(await kind(p),'none');assert.equal((await info(p)).waiting,false);await p.close();
        }
    });
    await test('Amber to red to green preserves original favicon and attributes', async () => {
        const p=await fixture();await send(p);await streaming(p,true);await p.clock.jump(30*MINUTE);
        assert.match(decodeURIComponent(await p.locator('#original').getAttribute('href')),/#fbbf24/);
        await uiError(p);await p.clock.runFor(3000);assert.equal(await kind(p),'error');
        assert.match(decodeURIComponent(await p.locator('#original').getAttribute('href')),/#ef4444/);
        await p.clock.jump(31*MINUTE);assert.equal(await kind(p),'error');
        await clearError(p);await output(p,'three','Finished');await streaming(p,false);await p.clock.runFor(3000);
        assert.match(decodeURIComponent(await p.locator('#original').getAttribute('href')),/#16a34a/);await hidden(p,false);await assertOriginal(p);await p.close();
    });
    await test('Warning shortcuts show the chosen icon after five seconds and restore on returning', async () => {
        for(const [code,expected] of [['KeyW','stalled'],['KeyE','error']]) {
            const p=await fixture();await hidden(p,false);
            await p.evaluate(code=>document.dispatchEvent(new KeyboardEvent('keydown',{code,altKey:true,shiftKey:true,bubbles:true})),code);
            await hidden(p,true);await p.clock.runFor(4999);assert.equal(await kind(p),'none');
            await p.clock.runFor(10);assert.equal(await kind(p),expected);assert.equal((await info(p)).waiting,false);
            await hidden(p,false);await assertOriginal(p);await p.close();
        }
    });
    await test('A fresh completion observed at a delayed 30-minute poll is green, not a stale warning', async () => {
        const p=await fixture();await send(p);await streaming(p,true);await output(p,'boundary','Final text',false);
        await p.clock.jump(29*MINUTE);
        await p.evaluate(()=>{const b=document.createElement('button');b.dataset.testid='copy-turn-action-button';b.textContent='Copy';document.querySelector('[data-testid="conversation-turn-boundary"]').append(b);document.getElementById('stop-host').replaceChildren();});
        await p.clock.jump(2*MINUTE);await p.clock.runFor(3000);assert.equal(await kind(p),'done');await p.close();
    });
    await test('Hidden UI progress is not visible progress', async () => {
        const p=await fixture({work:true});await workSend(p);await streaming(p,true);
        await workAppend(p,workAnswer('hidden-progress','Working<div style="display:none"><span id="invisible">1</span></div>',false));await p.clock.runFor(100);
        await p.clock.jump(29*MINUTE);await p.evaluate(()=>document.getElementById('invisible').textContent='2');await p.clock.runFor(100);
        await p.clock.jump(MINUTE);assert.equal(await kind(p),'stalled');await p.close();
    });
};

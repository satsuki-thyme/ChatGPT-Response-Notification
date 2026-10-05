const assert = require('node:assert/strict');

module.exports = async ({ test, fixture, send, output, streaming, hidden, assertOriginal, workAnswer }) => {
    const STORAGE = 'chatgpt-response-favicon:usage:v1';
    const notices = p => p.evaluate(() => window.testNotifications.map(({title,text,url,tag,highlight,onclick}) => ({title,text,url,tag,highlight,hasOnclick:typeof onclick === 'function'})));
    const usageInfo = p => p.evaluate(() => window.__chatgptResponseFaviconV2.inspectUsage());
    const card = (label, metric, id='five') => `<section id="${id}"><h2>${label}</h2><p class="metric">${metric}</p><p class="reset">Resets in 1 hour</p></section>`;
    const usage = (cards, extra='') => `<main><h1>使用状況</h1>${cards}${extra}</main>`;
    const usageFixture = (html, extra={}) => fixture({pathname:'/settings/usage?tab=overview',usageHTML:html,...extra});
    const metric = (p, text, id='five') => p.evaluate(({text,id}) => document.querySelector(`#${id} .metric`).textContent=text,{text,id});
    const settle = p => p.clock.runFor(3500);

    await test('Desktop: hidden completion emits one notification with a link, without answer text', async () => {
        const p=await fixture();await send(p);await output(p,'done','PRIVATE ANSWER BODY');await settle(p);
        const n=await notices(p);assert.equal(n.length,1);assert.match(n[0].title,/回答完了/);assert.doesNotMatch(n[0].text,/PRIVATE/);assert.equal(n[0].url,'https://chatgpt.com/c/current');
        await settle(p);assert.equal((await notices(p)).length,1);
        const first=(await notices(p))[0];assert.equal(first.highlight,false);assert.equal(first.hasOnclick,false);
        assert.equal(await p.evaluate(()=>window.testFocus),0);await p.close();
    });

    await test('Desktop: temporary non-streaming state does not finish while visible progress keeps changing', async () => {
        const p=await fixture({preferences:{'crf:progress':false}});await send(p);await streaming(p,true);await output(p,'working','Step one');
        await streaming(p,false);await p.clock.runFor(2000);assert.equal((await notices(p)).length,0);
        await p.evaluate(()=>document.querySelector('[data-message-id="working"]').textContent='Step two');await p.clock.runFor(2500);assert.equal((await notices(p)).length,0);
        await p.clock.runFor(1000);assert.equal((await notices(p)).length,1);assert.match((await notices(p))[0].title,/回答完了/);await p.close();
    });
    await test('Desktop: foreground completion and loading old history stay silent', async () => {
        const p=await fixture();await p.clock.runFor(10000);assert.equal((await notices(p)).length,0);await hidden(p,false);
        await send(p);await output(p,'visible','Answer');await settle(p);assert.equal((await notices(p)).length,0);await p.close();
    });
    await test('Desktop: ongoing progress is grouped, then completion is separately delivered', async () => {
        const p=await fixture();await send(p);await streaming(p,true);await output(p,'progress1','Step one',false);
        await p.clock.runFor(5500);assert.equal((await notices(p)).length,1);assert.match((await notices(p))[0].title,/更新/);
        await output(p,'progress2','Step two',false);await p.clock.runFor(30000);assert.equal((await notices(p)).length,1);
        await p.clock.runFor(31000);assert.equal((await notices(p)).length,2);
        await output(p,'progress3','Final');await streaming(p,false);await settle(p);assert.match((await notices(p)).at(-1).title,/回答完了/);await p.close();
    });
    await test('Desktop: updates seen in the foreground are not replayed when hiding the tab', async () => {
        const p=await fixture();await hidden(p,false);await send(p);await streaming(p,true);await output(p,'seen','Visible work',false);
        await hidden(p,true);await p.clock.runFor(10000);assert.equal((await notices(p)).length,0);await p.close();
    });
    await test('Desktop: stalled, resumed and error transitions are delivered; unchanged error is silent', async () => {
        const p=await fixture();await send(p);await streaming(p,true);await p.clock.jump(1800000);
        assert.match((await notices(p)).at(-1).title,/進捗が止まって/);
        await output(p,'resume','New progress',false);await p.clock.runFor(5500);assert.match((await notices(p)).at(-1).title,/再開/);
        await p.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<div role="alert">Usage limit reached</div>'));await settle(p);
        assert.match((await notices(p)).at(-1).title,/エラー/);const count=(await notices(p)).length;await p.clock.runFor(10000);assert.equal((await notices(p)).length,count);await p.close();
    });
    await test('Desktop: an approval dialog is notified without clicking its buttons', async () => {
        const p=await fixture();await send(p);await streaming(p,true);
        await p.evaluate(()=>{window.testApproved=false;document.body.insertAdjacentHTML('beforeend','<div role="dialog">承認が必要です<button id="approve">許可する</button></div>');document.getElementById('approve').onclick=()=>window.testApproved=true;});
        await settle(p);assert.match((await notices(p)).at(-1).title,/確認が必要/);assert.equal(await p.evaluate(()=>window.testApproved),false);
        const count=(await notices(p)).length;await settle(p);assert.equal((await notices(p)).length,count);await p.close();
    });
    await test('Desktop: disabling desktop or progress notifications retains favicon completion', async () => {
        const p=await fixture({preferences:{'crf:desktop':false}});await send(p);await output(p,'disabled','Done');await settle(p);
        assert.equal((await notices(p)).length,0);assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().notification),'done');await p.close();
        const q=await fixture({preferences:{'crf:progress':false}});await send(q);await streaming(q,true);await output(q,'quiet','Working',false);await q.clock.runFor(10000);
        assert.equal((await notices(q)).length,0);await streaming(q,false);await settle(q);assert.match((await notices(q)).at(-1).title,/回答完了/);await q.close();
    });
    await test('Desktop: unavailable or failing notification API cannot break the favicon', async () => {
        for(const options of [{desktopAvailable:false},{desktopThrows:true}]){
            const p=await fixture(options);await send(p);await output(p,'api','Done');await settle(p);
            const state=await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect());assert.equal(state.notification,'done');assert.equal(state.lastDesktopStatus,options.desktopThrows?'failed':'unavailable');await hidden(p,false);await assertOriginal(p);await p.close();
        }
    });
    await test('Desktop: test shortcut waits five seconds, and dispose cancels a pending test', async () => {
        const p=await fixture();await hidden(p,false);await p.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyN',altKey:true,shiftKey:true,bubbles:true})));
        await p.clock.runFor(4999);assert.equal((await notices(p)).length,0);await p.clock.runFor(2);assert.match((await notices(p))[0].title,/通知テスト/);
        await p.evaluate(()=>{window.__chatgptResponseFaviconV2.testDesktopInFiveSeconds();window.__chatgptResponseFaviconV2.dispose();});await p.clock.runFor(6000);assert.equal((await notices(p)).length,1);await p.close();
    });
    await test('Usage: first loading a positive allowance never claims a recovery', async () => {
        const p=await usageFixture(usage(card('5-hour limit','75% remaining')+card('Weekly limit','40% remaining','week')));
        await settle(p);assert.equal((await notices(p)).length,0);assert.equal((await usageInfo(p)).rows.length,2);assert.equal((await usageInfo(p)).status,'recognized');await p.close();
    });
    await test('Usage: remaining 0 to positive emits once, including while the page is visible', async () => {
        const p=await usageFixture(usage(card('5-hour limit','0% remaining')));await hidden(p,false);await settle(p);
        await metric(p,'80% remaining');await settle(p);const n=await notices(p);assert.equal(n.length,1);assert.match(n[0].title,/利用枠が回復/);assert.match(n[0].text,/80%/);
        await metric(p,'79% remaining');await settle(p);assert.equal((await notices(p)).length,1);await p.close();
    });
    await test('Usage: used percentages are correctly inverted', async () => {
        const p=await usageFixture(usage(card('5-hour limit','100% used')));await settle(p);assert.equal((await usageInfo(p)).rows[0].state,'blocked');
        await metric(p,'10% used');await settle(p);assert.equal((await notices(p)).length,1);assert.match((await notices(p))[0].text,/90%/);await p.close();
    });
    await test('Usage: Japanese and full-width percentage labels are recognized', async () => {
        const p=await usageFixture(usage(card('5時間の利用上限','残り ０％')+card('週間の上限','使用率 ５０％','week')));await settle(p);
        const initial=await usageInfo(p);assert.equal(initial.rows.length,2);assert.equal(initial.rows[0].remaining,0);assert.equal(initial.rows[1].remaining,50);
        await metric(p,'残り １００％');await settle(p);assert.equal((await notices(p)).length,1);await p.close();
    });
    await test('Usage: named accessibility progressbar values can supply the remaining percentage', async () => {
        const p=await usageFixture(usage(card('5-hour limit','<div role="progressbar" aria-label="Remaining" aria-valuenow="0" aria-valuemax="100"></div>')));await settle(p);
        assert.equal((await usageInfo(p)).rows[0].state,'blocked');await p.evaluate(()=>document.querySelector('[role="progressbar"]').setAttribute('aria-valuenow','65'));
        await settle(p);assert.equal((await notices(p)).length,1);await p.close();
    });
    await test('Usage: bare percentages are unknown and never guessed as remaining or used', async () => {
        const p=await usageFixture(usage(card('5-hour limit','0%')));await settle(p);assert.equal((await usageInfo(p)).status,'unknown');
        await metric(p,'100%');await settle(p);assert.equal((await notices(p)).length,0);assert.equal((await usageInfo(p)).status,'unknown');await p.close();
    });
    await test('Usage: reset countdowns and passing reset times alone do not announce recovery', async () => {
        const p=await usageFixture(usage(card('5-hour limit','0% remaining')),{preferences:{'crf:usageReload':false}});await settle(p);
        await p.evaluate(()=>document.querySelector('.reset').textContent='Resets in 0 seconds');await p.clock.jump(3600000);await settle(p);
        assert.equal((await notices(p)).length,0);assert.equal((await usageInfo(p)).rows[0].state,'blocked');await p.close();
    });
    await test('Usage: loading placeholders and missing cards retain blocked history without notifying', async () => {
        const p=await usageFixture(usage(card('5-hour limit','0% remaining')));await settle(p);
        await p.evaluate(()=>document.querySelector('main').innerHTML='<h1>Loading</h1>');await settle(p);assert.equal((await notices(p)).length,0);assert.deepEqual((await usageInfo(p)).blockedBefore,['hours-5']);
        await p.evaluate(html=>document.querySelector('main').innerHTML=html,card('5-hour limit','100% remaining'));await settle(p);assert.equal((await notices(p)).length,1);await p.close();
    });
    await test('Usage: a transient positive value shorter than confirmation time does not notify', async () => {
        const p=await usageFixture(usage(card('5-hour limit','0% remaining')));await settle(p);
        await metric(p,'100% remaining');await p.clock.runFor(500);await metric(p,'0% remaining');await settle(p);assert.equal((await notices(p)).length,0);await p.close();
    });
    await test('Usage: conflicting percentages or duplicate cards are unknown, not recoveries', async () => {
        const p=await usageFixture(usage(card('5-hour limit','0% remaining')));await settle(p);
        await metric(p,'70% remaining 90% used');await settle(p);assert.equal((await usageInfo(p)).status,'unknown');assert.equal((await notices(p)).length,0);
        await p.evaluate(html=>document.querySelector('main').innerHTML=html,card('5-hour limit','100% remaining')+card('5-hour limit','0% remaining','duplicate'));await settle(p);
        assert.equal((await usageInfo(p)).status,'unknown');assert.equal((await notices(p)).length,0);await p.close();
    });
    await test('Usage: recovery of one window mentions other still-blocked windows', async () => {
        const p=await usageFixture(usage(card('5-hour limit','0% remaining')+card('Weekly limit','0% remaining','week')));await settle(p);
        await metric(p,'100% remaining');await settle(p);const n=await notices(p);assert.equal(n.length,1);assert.match(n[0].text,/Weekly limit.*まだ上限/);
        await metric(p,'100% remaining','week');await settle(p);assert.equal((await notices(p)).length,2);await p.close();
    });
    await test('Usage: multiple windows recovering together create one combined notification', async () => {
        const p=await usageFixture(usage(card('5-hour limit','0% remaining')+card('Weekly limit','0% remaining','week')));await settle(p);
        await metric(p,'100% remaining');await metric(p,'100% remaining','week');await settle(p);
        assert.equal((await notices(p)).length,1);assert.match((await notices(p))[0].text,/5-hour limit.*Weekly limit/);await p.close();
    });
    await test('Usage: a later exhausted-and-recovered cycle can notify again', async () => {
        const p=await usageFixture(usage(card('5-hour limit','0% remaining')));await settle(p);
        for(let i=0;i<2;i++){await metric(p,'100% remaining');await settle(p);if(i===0){await metric(p,'0% remaining');await settle(p);}}
        assert.equal((await notices(p)).length,2);await p.close();
    });
    await test('Usage: saved blocked state survives a page reload; stale state is ignored', async () => {
        const now=1790856000000;
        const session={[STORAGE]:JSON.stringify({version:1,updatedAt:now-3000,entries:{'hours-5':{state:'blocked',at:now-6000}}})};
        const p=await usageFixture(usage(card('5-hour limit','100% remaining')),{session});await settle(p);assert.equal((await notices(p)).length,1);
        const saved=await p.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),STORAGE);assert.equal(saved.entries['hours-5'].state,'available');await p.close();
        const stale={[STORAGE]:JSON.stringify({version:1,updatedAt:now-9*86400000,entries:{'hours-5':{state:'blocked',at:now-9*86400000}}})};
        const q=await usageFixture(usage(card('5-hour limit','100% remaining')),{session:stale});await settle(q);assert.equal((await notices(q)).length,0);await q.close();
    });
    await test('Usage: only the hidden overview page automatically reloads at the interval', async () => {
        const p=await usageFixture(usage(card('5-hour limit','0% remaining')));await settle(p);await p.clock.jump(58000);assert.equal(await p.evaluate(()=>window.testReloads),1);await p.close();
        for(const mode of ['visible','offline','editing','disabled']){
            const q=await usageFixture(usage(card('5-hour limit','0% remaining')),{preferences:mode==='disabled'?{'crf:usageReload':false}:{}});
            if(mode==='visible')await hidden(q,false);
            if(mode==='offline')await q.evaluate(()=>Object.defineProperty(navigator,'onLine',{value:false}));
            if(mode==='editing')await q.evaluate(()=>{const input=document.createElement('input');document.body.append(input);input.focus();});
            await settle(q);await q.clock.jump(65000);assert.equal(await q.evaluate(()=>window.testReloads),0,mode);await q.close();
        }
    });
    await test('Usage: unavailable storage stops automatic reload but retains in-memory detection', async () => {
        const p=await usageFixture(usage(card('5-hour limit','0% remaining')));
        await p.evaluate(()=>{Object.defineProperty(window,'sessionStorage',{value:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}}});});await settle(p);
        await p.clock.jump(65000);assert.equal(await p.evaluate(()=>window.testReloads),0);assert.equal((await usageInfo(p)).savedState,false);
        await metric(p,'100% remaining');await settle(p);assert.equal((await notices(p)).length,1);await p.close();
    });
    await test('Usage: observed hash route works; other tabs and ordinary chats are excluded', async () => {
        const p=await fixture({pathname:'/?tab=overview&mweb_fallback=1#settings/Usage',usageHTML:usage(card('5-hour limit','0% remaining'))});await settle(p);
        assert.equal((await usageInfo(p)).page,'usage-overview');await metric(p,'100% remaining');await settle(p);assert.equal((await notices(p)).length,1);await p.close();
        for(const pathname of ['/settings/usage?tab=apps','/c/current']){
            const q=await fixture({pathname,usageHTML:usage(card('5-hour limit','0% remaining'))});await settle(q);await metric(q,'100% remaining');await settle(q);
            assert.equal((await usageInfo(q)).page,'other');assert.equal((await notices(q)).length,0);await q.clock.jump(65000);assert.equal(await q.evaluate(()=>window.testReloads),0);await q.close();
        }
    });
    await test('Usage: leaving the usage page prevents a queued recovery and reload', async () => {
        const p=await usageFixture(usage(card('5-hour limit','0% remaining')));await settle(p);await metric(p,'100% remaining');await p.clock.runFor(500);
        await p.evaluate(()=>history.pushState({},'', '/c/different'));await settle(p);await p.clock.jump(65000);assert.equal((await notices(p)).length,0);assert.equal(await p.evaluate(()=>window.testReloads),0);await p.close();
    });
    await test('Usage: diagnostics identify unsupported display and shortcut produces copyable JSON', async () => {
        const p=await usageFixture(usage(card('5-hour limit','25%')));await settle(p);
        await p.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyU',altKey:true,shiftKey:true,bubbles:true})));
        const data=JSON.parse(await p.evaluate(()=>window.testPrompt));assert.equal(data.status,'unknown');assert.deepEqual(data.unknownLabels,['5-hour limit']);assert.equal(data.desktopAPI,true);await p.close();
    });
    await test('Usage: explicit exhausted and restored messages can be matched within one window', async () => {
        const p=await usageFixture(usage(card('5-hour limit','Usage limit reached')));await settle(p);assert.equal((await usageInfo(p)).rows[0].state,'blocked');
        await metric(p,'Usage is available again');await settle(p);assert.equal((await notices(p)).length,1);await p.close();
    });
    await test('Usage: future reset text without a remaining percentage is never a recovery', async () => {
        const p=await usageFixture(usage(card('5-hour limit','0% remaining')));await settle(p);
        for(const text of ['5-hour limit Resets in 0 seconds','Limit reset time: 12:00','Limit will be reset in 1 minute']){
            await metric(p,text);await settle(p);assert.equal((await usageInfo(p)).status,'unknown');assert.equal((await notices(p)).length,0);
        }
        await metric(p,'Limit has been reset');await settle(p);assert.equal((await notices(p)).length,1);await p.close();
    });
    await test('Usage: failed notification is retained and retried after one minute without duplication', async () => {
        const p=await usageFixture(usage(card('5-hour limit','0% remaining')),{desktopThrows:true,preferences:{'crf:usageReload':false}});await settle(p);
        await metric(p,'100% remaining');await settle(p);assert.equal((await usageInfo(p)).lastDesktop.status,'failed');
        assert.deepEqual((await usageInfo(p)).blockedBefore,['hours-5']);
        const saved=await p.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),STORAGE);assert.equal(saved.entries['hours-5'].state,'blocked');
        await p.evaluate(()=>{window.GM_notification=details=>window.testNotifications.push(details);});
        await p.clock.runFor(10000);assert.equal((await notices(p)).length,0);
        await p.clock.runFor(51000);assert.equal((await notices(p)).length,1);assert.deepEqual((await usageInfo(p)).blockedBefore,[]);
        await p.clock.runFor(65000);assert.equal((await notices(p)).length,1);await p.close();
    });
    await test('Usage: malformed individual saved entries do not break monitoring', async () => {
        const now=1790856000000;
        const session={[STORAGE]:JSON.stringify({version:1,updatedAt:now,entries:{'hours-5':null,weekly:{state:'blocked',at:now+60000}}})};
        const p=await usageFixture(usage(card('5-hour limit','100% remaining')+card('Weekly limit','100% remaining','week')),{session});await settle(p);
        assert.equal((await notices(p)).length,0);assert.deepEqual((await usageInfo(p)).blockedBefore,[]);await p.close();
    });
};

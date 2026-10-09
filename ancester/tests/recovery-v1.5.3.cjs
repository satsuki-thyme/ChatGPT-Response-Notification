const assert = require('node:assert/strict');

module.exports = async ({test, fixture, send, output, streaming, hidden}) => {
    const info = p => p.evaluate(() => window.__chatgptResponseFaviconV2.inspect());
    const usageInfo = p => p.evaluate(() => window.__chatgptResponseFaviconV2.inspectUsage());
    const notices = p => p.evaluate(() => window.testNotifications);
    const recovered = async p => (await notices(p)).filter(n => n.title.includes('利用枠が回復'));
    const settle = p => p.clock.runFor(4000);
    const alert = (p, text) => p.evaluate(text => {
        let el=document.getElementById('quota-alert');
        if(!el){el=document.createElement('div');el.id='quota-alert';el.setAttribute('role','alert');document.body.append(el);}
        el.textContent=text;
    },text);
    const clear = p => p.evaluate(() => document.getElementById('quota-alert')?.remove());
    const card = (remaining, label='5-hour limit', id='five') => `<section id="${id}"><h2>${label}</h2><p class="metric">${remaining}% remaining</p></section>`;
    const usage = (remaining, args={}) => fixture({pathname:'/settings/usage?tab=overview',usageHTML:`<main>${card(remaining)}</main>`,...args});
    const metric = (p, n) => p.evaluate(n => document.querySelector('.metric').textContent=`${n}% remaining`, n);

    await test('1.5.3: quota recovery is separate from errors; no later stall; fresh work completes', async()=>{
        const p=await fixture();await send(p);await streaming(p,true);
        await alert(p,'Usage limit reached');await settle(p);
        assert.equal((await info(p)).notification,'limited');
        await alert(p,'Your usage limit has reset. Usage is available again.');await settle(p);
        assert.equal((await recovered(p)).length,1);assert.equal((await info(p)).notification,'recovered');
        assert.equal((await notices(p)).some(n=>n.title.includes('エラー')),false);
        const count=(await notices(p)).length;
        await p.clock.observed(31*60000);assert.equal((await notices(p)).length,count);
        await clear(p);await output(p,'fresh-after-quota','Fresh final response');await streaming(p,false);await settle(p);
        assert.equal((await info(p)).notification,'done');await p.close();
    });
    await test('1.5.3: completed Japanese reset notices recover; future and contradictory text do not',async()=>{
        const p=await fixture();await send(p);await alert(p,'利用上限に達しました');await settle(p);
        for(const text of ['利用上限はリセット予定です','利用制限が解除されると再び利用できます','You will be notified when your usage limit has reset','Usage limit has reset but usage limit reached still applies']){
            await alert(p,text);await settle(p);assert.equal((await recovered(p)).length,0,text);
        }
        await alert(p,'利用上限がリセットされました。');await settle(p);assert.equal((await recovered(p)).length,1);
        await p.close();
    });
    await test('1.5.3: real network errors still alert alongside a recovered quota',async()=>{
        const p=await fixture();await send(p);await alert(p,'Usage limit reached');await settle(p);
        await alert(p,'Usage limit has reset. Network error');await settle(p);
        assert.equal((await recovered(p)).length,1);assert.equal((await info(p)).notification,'error');await p.close();
    });
    await test('1.5.3: initial recovery history and quoted recovery examples never notify',async()=>{
        const p=await fixture({usageHTML:'<main><div role="alert">Usage limit has reset</div></main>'});
        await settle(p);assert.equal((await notices(p)).length,0);await p.close();
        const q=await fixture();await send(q);
        await output(q,'quote','<pre><code><span role="alert">Usage limit has reset</span></code></pre><span role="status">利用上限がリセットされました</span>');
        await settle(q);assert.equal((await recovered(q)).length,0);await q.close();
    });
    await test('1.5.3: a brief recovery notice and route changes do not announce recovery',async()=>{
        const p=await fixture();await send(p);await alert(p,'Usage limit reached');await settle(p);
        await alert(p,'Usage limit has reset');await p.clock.runFor(500);await clear(p);await settle(p);
        assert.equal((await recovered(p)).length,0);
        await alert(p,'Usage limit has reset');await p.clock.runFor(500);
        await p.evaluate(()=>history.pushState({},'', '/c/another'));await settle(p);
        assert.equal((await recovered(p)).length,0);await p.close();
    });
    await test('1.5.3: two chat tabs report one recovery even when the second is delayed',async()=>{
        const shared={values:new Map(),locked:false};const a=await fixture({shared});const b=await fixture({shared});
        for(const p of [a,b]){await send(p);await alert(p,'Usage limit reached');await settle(p);}
        await alert(a,'Usage limit has reset');await settle(a);
        await b.clock.observed(15*60000);await alert(b,'Usage limit has reset');await settle(b);
        assert.equal((await recovered(a)).length+(await recovered(b)).length,1);
        assert.equal((await info(b)).recoveryCoordination,'deduplicated');
        assert.equal((await info(b)).notification,'recovered');await a.close();await b.close();
    });
    await test('1.5.3: simultaneous usage tabs coordinate, then a new blocked cycle can notify again',async()=>{
        const shared={values:new Map(),locked:false};const a=await usage(0,{shared});const b=await usage(0,{shared});
        await Promise.all([settle(a),settle(b)]);await Promise.all([metric(a,80),metric(b,80)]);
        await Promise.all([settle(a),settle(b)]);
        assert.equal((await recovered(a)).length+(await recovered(b)).length,1);
        for(const p of [a,b]){await metric(p,0);await settle(p);}
        for(const p of [a,b]){await metric(p,75);await settle(p);}
        assert.equal((await recovered(a)).length+(await recovered(b)).length,2);await a.close();await b.close();
    });
    await test('1.5.3: chat and usage page share recovery episodes',async()=>{
        const shared={values:new Map(),locked:false};const a=await fixture({shared});const b=await usage(0,{shared});
        await send(a);await alert(a,'Usage limit reached');await settle(a);await settle(b);
        await alert(a,'Usage limit has reset');await settle(a);await metric(b,90);await settle(b);
        assert.equal((await recovered(a)).length+(await recovered(b)).length,1);await a.close();await b.close();
    });
    await test('1.5.3: known independent limits are not incorrectly merged',async()=>{
        const p=await fixture({pathname:'/settings/usage?tab=overview',usageHTML:`<main>${card(0)}${card(0,'Weekly limit','week')}</main>`});
        await settle(p);await p.evaluate(()=>document.querySelector('#five .metric').textContent='50% remaining');await settle(p);
        await p.evaluate(()=>document.querySelector('#week .metric').textContent='50% remaining');await settle(p);
        assert.equal((await recovered(p)).length,2);await p.close();
    });
    await test('1.5.3: coordination failures are diagnosed without duplicate fallback notifications',async()=>{
        for(const args of [{locksAvailable:false},{localStorageThrows:true}]){
            const p=await usage(0,args);await settle(p);await metric(p,50);await settle(p);
            assert.equal((await recovered(p)).length,0);assert.match((await usageInfo(p)).recoveryCoordination,/unavailable|failed/);
            await p.close();
        }
    });
    await test('1.5.3: API failure keeps recovery retryable across tabs',async()=>{
        const shared={values:new Map(),locked:false};const a=await usage(0,{shared,desktopThrows:true});const b=await usage(0,{shared});
        await settle(a);await settle(b);await metric(a,50);await settle(a);await metric(b,50);await settle(b);
        assert.equal((await recovered(a)).length,0);assert.equal((await recovered(b)).length,1);
        await a.evaluate(()=>window.GM_notification=details=>window.testNotifications.push(details));
        await a.clock.observed(65000);assert.equal((await recovered(a)).length,0);await a.close();await b.close();
    });
    await test('1.5.3: disabled recoveries are consumed rather than replayed',async()=>{
        const p=await usage(0,{preferences:{'crf:usage':false}});await settle(p);await metric(p,50);await settle(p);
        await p.evaluate(()=>window.testPreferences['crf:usage']=true);await settle(p);assert.equal((await recovered(p)).length,0);await p.close();
    });
    await test('1.5.3: timer gaps and freeze/resume do not become immediate 30-minute stall warnings',async()=>{
        const p=await fixture();await send(p);await streaming(p,true);
        await p.clock.jump(31*60000);assert.equal((await notices(p)).length,0);
        assert.ok((await info(p)).lifecycle.maximumGapMs>=30*60000);
        assert.ok((await info(p)).minutesWithoutProgress>=30);assert.equal((await info(p)).minutesContinuouslyObserved,0);
        await p.evaluate(()=>document.dispatchEvent(new Event('freeze')));
        await p.clock.jump(31*60000);await p.evaluate(()=>document.dispatchEvent(new Event('resume')));await settle(p);
        assert.equal((await notices(p)).length,0);
        await p.clock.observed(30*60000);assert.match((await notices(p)).at(-1).title,/進捗が止まって/);await p.close();
    });
    await test('1.5.3: a monitoring gap cannot satisfy recovery stability',async()=>{
        const p=await usage(0);await settle(p);await metric(p,50);await p.clock.runFor(1000);
        await p.clock.jump(3*60000);assert.equal((await recovered(p)).length,0);
        await settle(p);assert.equal((await recovered(p)).length,1);await p.close();
    });
    await test('1.5.3: background reload protects unfocused drafts and conversation routes',async()=>{
        const p=await usage(0);await p.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<textarea>Unsent work</textarea>'));
        await p.clock.observed(65000);assert.equal(await p.evaluate(()=>window.testReloads),0);
        assert.equal((await usageInfo(p)).reloadBlockedBy,'unsent-input');await p.close();
        const q=await fixture({pathname:'/c/draft#settings/Usage',usageHTML:`<main>${card(0)}</main>`});
        await q.clock.observed(65000);assert.equal(await q.evaluate(()=>window.testReloads),0);
        assert.equal((await usageInfo(q)).reloadBlockedBy,'conversation-route');await q.close();
    });
    await test('1.5.3: a persistent recovery banner does not block a later real completion',async()=>{
        const p=await fixture();await send(p);await streaming(p,true);
        await alert(p,'Usage limit reached');await settle(p);await alert(p,'Usage limit has reset');await settle(p);
        await output(p,'new-with-banner','Real new answer');await streaming(p,false);await settle(p);
        assert.equal((await info(p)).notification,'done');assert.equal((await recovered(p)).length,1);await p.close();
    });
    await test('1.5.3: a second real blocked-to-recovered chat cycle announces again',async()=>{
        const p=await fixture();await send(p);
        for(let i=0;i<2;i++){
            await alert(p,'Usage limit reached');await settle(p);await alert(p,'Usage limit has reset');await settle(p);
        }
        assert.equal((await recovered(p)).length,2);await p.close();
    });
    await test('1.5.3: idle hydration and already-seen recovery do not notify on a later send',async()=>{
        const p=await fixture();await alert(p,'Usage limit has reset');await settle(p);
        assert.equal((await recovered(p)).length,0);await send(p);await settle(p);
        assert.equal((await recovered(p)).length,0);await output(p,'after-old-banner','Real final answer');await settle(p);
        assert.equal((await info(p)).notification,'done');await p.close();
    });
    await test('1.5.3: unchanged quota limits are not announced again after freeze/resume',async()=>{
        const p=await fixture();await send(p);await alert(p,'Usage limit reached');await settle(p);
        const before=(await notices(p)).length;
        await p.evaluate(()=>document.dispatchEvent(new Event('freeze')));await p.clock.jump(5*60000);
        await p.evaluate(()=>document.dispatchEvent(new Event('resume')));await settle(p);
        assert.equal((await notices(p)).length,before);await p.close();
    });
};

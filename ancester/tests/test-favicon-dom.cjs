const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(__dirname + '/../chatgpt-response-favicon.user.js', 'utf8');
const ORIGINAL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
const NEXT = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E';
const article = (id, text, copy = true) => `<article data-testid="conversation-turn-${id}"><section data-turn="assistant"><div data-message-author-role="assistant" data-message-id="${id}">${text}</div></section>${copy ? '<button data-testid="copy-turn-action-button">Copy</button>' : ''}</article>`;
const workAnswer = (id, text, actions = true) => `<div class="contents"><div id="work-${id}" class="group flex flex-col"><div class="whitespace-pre-wrap">${text}</div>${actions ? '<div class="mt-1.5 flex turn-action-controls min-h-5 min-w-0"><div class="flex turn-action-controls items-center gap-0.5"><span class="contents" data-state="closed"><button type="button" aria-label="メッセージをコピーする"><svg></svg></button></span></div><div class="flex min-h-5 min-w-0"><button type="button" aria-label="回答を再生成" data-state="closed"><svg></svg></button></div></div>' : ''}</div></div>`;
const workUser = text => `<div class="flex flex-col"><div>${text}</div><div class="flex flex-row-reverse items-center gap-1"><div class="isolate me-1 ms-1 flex items-center gap-2 opacity-0 group-focus-within/user-message:opacity-100 group-hover/user-message:opacity-100"><div class="flex turn-action-controls items-center gap-0.5"><span class="contents" data-state="closed"><button type="button" aria-label="メッセージをコピーする"><svg></svg></button></span></div></div></div></div>`;
let browser;
const results = [];

async function fixture({ empty = false, pathname = '/c/current', noIcons = false, work = false, richLabel = 'Work モードで作成', usageHTML = null, session = {}, preferences = {}, desktopAvailable = true, desktopThrows = false } = {}) {
    const dom = new JSDOM(`<!doctype html><html><head>${noIcons ? '' : `<link id="original" rel="icon" href="${ORIGINAL}" type="image/png" sizes="32x32"><link id="touch" rel="apple-touch-icon" href="/touch.png">`}</head><body><main id="conversation">${empty ? '' : work ? workUser('Old question') + workAnswer('a0','Old response') : article('a0','Old response')}</main>${work ? `<section id="work-composer"><div id="work-editor" class="ProseMirror ProseMirror-focused" role="textbox" aria-label="${richLabel}" contenteditable="true">test prompt</div><button type="button" aria-label="送信"><svg></svg></button><div id="stop-host"></div></section>` : '<form data-chatgpt-composer><div id="prompt-textarea" contenteditable="true">test prompt</div><button type="button" data-testid="send-button">Send</button><div id="stop-host"></div></form>'}</body></html>`,{url:'https://chatgpt.com'+pathname,runScripts:'outside-only'});
    const w=dom.window,d=w.document;
    w.testHidden=true;
    Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>w.testHidden?'hidden':'visible'});
    Object.defineProperty(d,'hasFocus',{configurable:true,value:()=>false});
    w.Element.prototype.getClientRects=function(){
        for(let node=this;node;node=node.parentElement)if(node.hidden || node.style.display==='none')return [];
        return [{width:10,height:10}];
    };
    w.matchMedia=()=>({matches:true});
    w.testAlerts=[];w.alert=text=>w.testAlerts.push(text);w.prompt=(title,text)=>{w.testPrompt=text;return null;};w.testMenus={};
    w.testNotifications=[];w.testPreferences={...preferences};w.testFocus=0;
    w.focus=()=>w.testFocus++;
    w.GM_getValue=(key,fallback)=>Object.hasOwn(w.testPreferences,key)?w.testPreferences[key]:fallback;
    w.GM_setValue=(key,value)=>{w.testPreferences[key]=value;};
    if(desktopAvailable)w.GM_notification=details=>{if(desktopThrows)throw Error('Notification rejected');w.testNotifications.push(details);};
    for(const [key,value] of Object.entries(session))w.sessionStorage.setItem(key,value);
    if(usageHTML!==null){d.body.innerHTML=usageHTML;}
    w.testReloads=0;
    const locationImpl=require('jsdom/lib/generated/idl/utils').implForWrapper(w.location);
    locationImpl.reload=()=>{w.testReloads++;};
    w.GM_registerMenuCommand=(name,fn)=>{w.testMenus[name]=fn;return name;};
    w.GM_unregisterMenuCommand=name=>delete w.testMenus[name];
    d.querySelector('form')?.addEventListener('submit',event=>event.preventDefault());
    w.testIconMutations=0;
    new w.MutationObserver(records=>w.testIconMutations+=records.length).observe(d.head,{attributes:true,childList:true,subtree:true});
    let now=0,seq=0;const timers=new Map();
    Object.defineProperty(w.performance,'now',{value:()=>now});
    w.Date.now=()=>1790856000000+now;
    const add=(fn,ms,args,repeat)=>{const id=++seq;timers.set(id,{fn,args,due:now+Math.max(1,Number(ms)||0),repeat});return id;};
    w.setTimeout=(fn,ms,...args)=>add(fn,ms,args,0);w.clearTimeout=id=>timers.delete(id);
    w.setInterval=(fn,ms,...args)=>add(fn,ms,args,Math.max(1,Number(ms)||0));w.clearInterval=id=>timers.delete(id);
    const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
    async function runFor(ms){
        const end=now+ms;await flush();let iterations=0;
        while(true){
            const next=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;
            if(++iterations>10000)throw Error('Timer loop');const [id,t]=next;now=t.due;
            if(t.repeat)t.due+=t.repeat;else timers.delete(id);t.fn(...t.args);await flush();
        }
        now=end;await flush();
    }
    w.eval(source);await flush();
    return {
        evaluate(fn,arg){const value=w.Function('arg',`return (${fn.toString()})(arg);`)(arg);return Promise.resolve(value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value);},
        clock:{runFor, async jump(ms){
            await flush();now+=ms;
            for(const timer of timers.values())if(timer.due<now)timer.due=now;
            await runFor(1);
        }},
        locator(selector){return {count:async()=>d.querySelectorAll(selector).length,getAttribute:async name=>d.querySelector(selector).getAttribute(name),evaluate:async fn=>fn(d.querySelector(selector))};},
        async close(){w.__chatgptResponseFaviconV2?.dispose();w.close();}
    };
}

async function hidden(page, value) {
    await page.evaluate(value => {window.testHidden=value;document.dispatchEvent(new Event('visibilitychange'));},value);
}
async function streaming(page, value, label = 'Stop streaming') {
    await page.evaluate(({value,label}) => {
        document.getElementById('stop-host').innerHTML = value ? `<button type="button" data-testid="stop-button" aria-label="${label}">Stop</button>` : '';
    },{value,label});
    await page.clock.runFor(100);
}
async function output(page, id, text, copy = true) {
    await page.evaluate(html => document.getElementById('conversation').insertAdjacentHTML('beforeend',html),article(id,text,copy));
    await page.clock.runFor(100);
}
async function notified(page) {return page.evaluate(() => window.__chatgptResponseFaviconV2.inspect().notified);}
async function send(page) {await page.evaluate(() => document.querySelector('[data-testid="send-button"]').click());}
async function assertOriginal(page, expected = ORIGINAL) {
    const actual = await page.evaluate(() => {
        const link = document.getElementById('original');
        return {href:link.getAttribute('href'),type:link.getAttribute('type'),sizes:link.getAttribute('sizes'),touch:document.getElementById('touch').getAttribute('href'),custom:!!document.getElementById('chatgpt-response-favicon')};
    });
    assert.deepEqual(actual,{href:expected,type:'image/png',sizes:'32x32',touch:'/touch.png',custom:false});
}
async function test(name, fn) {
    try { await fn(); results.push({name,result:'PASS'}); console.log('PASS',name); }
    catch (error) {results.push({name,result:'FAIL',error:error.message});console.error('FAIL',name,error);}
}

(async () => {
    browser = {close:async()=>{}};
    await test('Loading completed history does not notify',async()=>{
        const p=await fixture(); await p.clock.runFor(10000); assert.equal(await notified(p),false); await p.close();
    });
    await test('Generation detected without a new user turn; two cycles restore even without window focus',async()=>{
        const p=await fixture();
        for(let i=1;i<=2;i++) {
            await hidden(p,true); await streaming(p,true); await output(p,`a${i}`,`Answer ${i}`); await streaming(p,false);
            await p.clock.runFor(2500); assert.equal(await notified(p),true);
            const attrs=await p.locator('#original').evaluate(e=>({href:e.getAttribute('href'),type:e.getAttribute('type'),sizes:e.getAttribute('sizes')}));
            assert.match(attrs.href,/^data:image\/svg\+xml/); assert.equal(attrs.type,'image/svg+xml'); assert.equal(attrs.sizes,'any');
            await hidden(p,false); assert.equal(await notified(p),false); await assertOriginal(p);
        }
        await p.close();
    });
    await test('Instant response after send click, copy button outside author-role element',async()=>{
        const p=await fixture(); await send(p); await output(p,'instant','Instant answer'); await p.clock.runFor(2500);
        assert.equal(await notified(p),true); await hidden(p,false); await assertOriginal(p); await p.close();
    });
    await test('Enter captures an instant response before the DOM changes',async()=>{
        const p=await fixture();
        await p.evaluate(()=>document.getElementById('prompt-textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true})));
        await output(p,'enter','Keyboard answer'); await p.clock.runFor(2500); assert.equal(await notified(p),true); await p.close();
    });
    await test('Form submit captures an instant response',async()=>{
        const p=await fixture();
        await p.evaluate(()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
        await output(p,'submit','Submitted answer'); await p.clock.runFor(2500); assert.equal(await notified(p),true); await p.close();
    });
    await test('Voice Stop dictation and a hidden generation control are ignored',async()=>{
        const p=await fixture();
        await p.evaluate(()=>document.getElementById('stop-host').innerHTML='<button aria-label="Stop dictation">Voice</button><button data-testid="stop-button" style="display:none">hidden</button>');
        await p.clock.runFor(3000); assert.equal(await notified(p),false);
        assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().generating),false); await p.close();
    });
    await test('Clicking Stop cancels the notification',async()=>{
        const p=await fixture(); await streaming(p,true); await output(p,'partial','Partial output',false);
        await p.evaluate(()=>document.querySelector('[data-testid="stop-button"]').click()); await streaming(p,false); await p.clock.runFor(4000);
        assert.equal(await notified(p),false); await p.close();
    });
    await test('Brief stop-control disappearance does not notify early',async()=>{
        const p=await fixture(); await streaming(p,true); await output(p,'stream','Partial output',false); await streaming(p,false);
        await p.clock.runFor(1000); assert.equal(await notified(p),false); await streaming(p,true);
        await p.clock.runFor(3000); assert.equal(await notified(p),false); await streaming(p,false); await p.clock.runFor(2500);
        assert.equal(await notified(p),true); await p.close();
    });
    await test('Native favicon href updates during notification are preserved on restore',async()=>{
        const p=await fixture(); await streaming(p,true); await output(p,'head','Answer'); await streaming(p,false); await p.clock.runFor(2500);
        await p.evaluate(next=>document.getElementById('original').setAttribute('href',next),NEXT); await p.clock.runFor(100);
        assert.equal(await notified(p),true); assert.match(await p.locator('#original').getAttribute('href'),/^data:image\/svg\+xml;charset/);
        await hidden(p,false); await assertOriginal(p,NEXT); await p.close();
    });
    await test('Replacement favicon elements restore; no recurring mutation loop',async()=>{
        const p=await fixture(); await streaming(p,true); await output(p,'replace','Answer'); await streaming(p,false); await p.clock.runFor(2500);
        await p.evaluate(next=>{
            const link=document.createElement('link');link.id='original';link.rel='icon';link.type='image/png';link.setAttribute('sizes','32x32');link.href=next;
            document.getElementById('original').replaceWith(link);
        },NEXT); await p.clock.runFor(500);
        const before=await p.evaluate(()=>window.testIconMutations); await p.clock.runFor(5000);
        assert.equal(await p.evaluate(()=>window.testIconMutations),before);
        await hidden(p,false); await assertOriginal(p,NEXT); await p.close();
    });
    await test('First send survives creation of a conversation URL',async()=>{
        const p=await fixture({empty:true,pathname:'/'}); await send(p);
        await p.evaluate(()=>history.replaceState({},'', '/c/new-conversation'));
        await output(p,'first','First response'); await p.clock.runFor(2500); assert.equal(await notified(p),true); await p.close();
    });
    await test('Navigation to another conversation clears the old pending response',async()=>{
        const p=await fixture();await send(p);
        await p.evaluate(()=>history.replaceState({},'', '/c/another-conversation'));
        await output(p,'history','Another conversation history'); await p.clock.runFor(2500);assert.equal(await notified(p),false);await p.close();
    });
    await test('Five-second test works twice and does not add conversation turns',async()=>{
        const p=await fixture();const count=await p.locator('article').count();
        for(let i=0;i<2;i++){
            await hidden(p,true);
            await p.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyT',altKey:true,shiftKey:true,bubbles:true,cancelable:true})));
            await p.clock.runFor(4900);assert.equal(await notified(p),false);
            await p.clock.runFor(200);assert.equal(await notified(p),true);
            await hidden(p,false);assert.equal(await notified(p),false);await assertOriginal(p);
        }
        assert.equal(await p.locator('article').count(),count);await p.close();
    });
    await test('Identical regenerated text still notifies',async()=>{
        const p=await fixture(); await streaming(p,true); await streaming(p,false);await p.clock.runFor(2500);
        assert.equal(await notified(p),true);await p.close();
    });
    await test('Completion while the tab is visible does not notify',async()=>{
        const p=await fixture();await hidden(p,false);await streaming(p,true);await output(p,'visible','Visible answer');await streaming(p,false);await p.clock.runFor(3000);
        assert.equal(await notified(p),false);await assertOriginal(p);await p.close();
    });
    await test('Missing native icons leave no green override after acknowledgement',async()=>{
        const p=await fixture({noIcons:true});await streaming(p,true);await output(p,'none','Answer');await streaming(p,false);await p.clock.runFor(2500);
        assert.equal(await notified(p),true);await hidden(p,false);assert.equal(await p.locator('#chatgpt-response-favicon').count(),0);await p.close();
    });

    await test('Current section wrapper structure detects copy actions outside message content',async()=>{
        const p=await fixture();await send(p);
        await p.evaluate(()=>document.getElementById('conversation').insertAdjacentHTML('beforeend','<section data-turn="assistant" data-testid="conversation-turn-current"><div data-message-author-role="assistant" data-message-id="current">Current structure</div><div><button data-testid="copy-turn-action-button">Copy</button></div></section>'));
        await p.clock.runFor(3000);assert.equal(await notified(p),true);await p.close();
    });
    await test('Multiple icons with absent type/sizes attributes restore exactly',async()=>{
        const p=await fixture();
        await p.evaluate(()=>{
            document.getElementById('original').removeAttribute('type');document.getElementById('original').removeAttribute('sizes');
            document.head.insertAdjacentHTML('beforeend','<link id="dark" rel="icon" href="/dark.svg" type="image/svg+xml" media="(prefers-color-scheme: dark)">');
        });
        await streaming(p,true);await output(p,'attrs','Answer');await streaming(p,false);await p.clock.runFor(2500);
        assert.equal(await notified(p),true);await hidden(p,false);
        assert.deepEqual(await p.evaluate(()=>({type:document.getElementById('original').getAttribute('type'),sizes:document.getElementById('original').getAttribute('sizes'),dark:document.getElementById('dark').getAttribute('href'),media:document.getElementById('dark').getAttribute('media')})),{type:null,sizes:null,dark:'/dark.svg',media:'(prefers-color-scheme: dark)'});
        await p.close();
    });
    await test('All native icons removed during notification: original fallback survives until native icon returns',async()=>{
        const p=await fixture();await streaming(p,true);await output(p,'fallback','Answer');await streaming(p,false);await p.clock.runFor(2500);
        await p.evaluate(()=>document.getElementById('original').remove());await p.clock.runFor(100);await hidden(p,false);
        assert.equal(await p.locator('#chatgpt-response-favicon-restore').getAttribute('href'),ORIGINAL);
        await p.evaluate(()=>document.head.insertAdjacentHTML('beforeend','<link rel="icon" href="/returned.svg">'));await p.clock.runFor(100);
        assert.equal(await p.locator('#chatgpt-response-favicon-restore').count(),0);await p.close();
    });
    await test('An observed generation can continue for more than one minute',async()=>{
        const p=await fixture();await send(p);await streaming(p,true);await p.clock.runFor(120000);assert.equal(await notified(p),false);
        assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().waiting),true);
        await output(p,'long','Long response');await streaming(p,false);await p.clock.runFor(2500);assert.equal(await notified(p),true);await p.close();
    });
    await test('Work diagnostics match the report: zero Chat selectors, one answer, user copy excluded',async()=>{
        const p=await fixture({work:true});
        const info=await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect());
        assert.equal(info.layout,'Work');assert.equal(info.assistantTurns,1);assert.equal(info.latestAnswerHasCopy,true);
        assert.equal(await p.locator('[data-message-author-role], [data-turn], [data-testid^="conversation-turn-"], .markdown, .prose').count(),0);
        await p.clock.runFor(10000);assert.equal(await notified(p),false);await p.close();
    });
    await test('Work ProseMirror Enter detects short answers without a stop control, two cycles restore',async()=>{
        const p=await fixture({work:true});
        for(let i=1;i<=2;i++){
            await hidden(p,true);
            await p.evaluate(()=>document.getElementById('work-editor').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true})));
            assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().waiting),true);
            await p.evaluate(html=>document.getElementById('conversation').insertAdjacentHTML('beforeend',html),workUser('Short prompt')+workAnswer(`short-${i}`,'テスト完了'));
            await p.clock.runFor(3000);assert.equal(await notified(p),true);
            await hidden(p,false);await assertOriginal(p);assert.equal(await notified(p),false);
        }
        await p.close();
    });
    await test('Work Send icon click captures the response before the DOM changes',async()=>{
        const p=await fixture({work:true});
        await p.evaluate(()=>document.querySelector('button[aria-label="送信"] svg').dispatchEvent(new MouseEvent('click',{bubbles:true})));
        await p.evaluate(html=>document.getElementById('conversation').insertAdjacentHTML('beforeend',html),workAnswer('send','テスト完了'));
        await p.clock.runFor(3000);assert.equal(await notified(p),true);await p.close();
    });
    await test('Work form submit uses its ProseMirror composer',async()=>{
        const p=await fixture({work:true});
        await p.evaluate(()=>{
            const section=document.getElementById('work-composer'), form=document.createElement('form');
            section.replaceWith(form);form.append(section);form.addEventListener('submit',e=>e.preventDefault());
            form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        });
        await p.evaluate(html=>document.getElementById('conversation').insertAdjacentHTML('beforeend',html),workAnswer('form','Answer'));
        await p.clock.runFor(3000);assert.equal(await notified(p),true);await p.close();
    });
    await test('Work generic Stop control detects a long task independently of a send event',async()=>{
        const p=await fixture({work:true});
        await p.evaluate(()=>document.getElementById('stop-host').innerHTML='<button type="button" aria-label="停止"><svg></svg></button>');
        await p.clock.runFor(120000);assert.equal(await notified(p),false);
        assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().generating),true);
        await p.evaluate(html=>{document.getElementById('conversation').insertAdjacentHTML('beforeend',html);document.getElementById('stop-host').replaceChildren();},workAnswer('long','Done'));
        await p.clock.runFor(3000);assert.equal(await notified(p),true);await p.close();
    });
    await test('Work Stop click cancels the pending completion notification',async()=>{
        const p=await fixture({work:true});
        await p.evaluate(()=>document.getElementById('stop-host').innerHTML='<button type="button" aria-label="停止する"><svg></svg></button>');
        await p.clock.runFor(100);
        await p.evaluate(()=>{document.querySelector('button[aria-label="停止する"]').click();document.getElementById('stop-host').replaceChildren();});
        await p.evaluate(html=>document.getElementById('conversation').insertAdjacentHTML('beforeend',html),workAnswer('cancel','Partial response'));
        await p.clock.runFor(3000);assert.equal(await notified(p),false);await p.close();
    });
    await test('Work user message copy action alone does not complete a submitted request',async()=>{
        const p=await fixture({work:true});
        await p.evaluate(()=>document.getElementById('work-editor').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
        await p.evaluate(html=>document.getElementById('conversation').insertAdjacentHTML('beforeend',html),workUser('New question'));
        await p.clock.runFor(4000);assert.equal(await notified(p),false);
        assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().assistantTurns),1);await p.close();
    });
    await test('Work regeneration of identical text detects re-created action controls without a stop control',async()=>{
        const p=await fixture({work:true});
        await p.evaluate(()=>document.querySelector('button[aria-label="回答を再生成"]').click());
        await p.evaluate(()=>document.querySelector('#work-a0 > .turn-action-controls').remove());
        await p.clock.runFor(100);
        await p.evaluate(html=>document.querySelector('#work-a0').parentElement.outerHTML=html,workAnswer('a0','Old response'));
        await p.clock.runFor(3000);assert.equal(await notified(p),true);await p.close();
    });
    await test('Work first submission survives creation of a Work conversation URL',async()=>{
        const p=await fixture({work:true,empty:true,pathname:'/work'});
        await p.evaluate(()=>document.querySelector('button[aria-label="送信"]').click());
        await p.evaluate(()=>history.replaceState({},'', '/work/new-conversation'));
        await p.evaluate(html=>document.getElementById('conversation').insertAdjacentHTML('beforeend',html),workAnswer('first','Done'));
        await p.clock.runFor(3000);assert.equal(await notified(p),true);await p.close();
    });
    await test('Work waits until the latest answer content has stopped changing',async()=>{
        const p=await fixture({work:true});
        await p.evaluate(()=>document.querySelector('button[aria-label="送信"]').click());
        await p.evaluate(html=>document.getElementById('conversation').insertAdjacentHTML('beforeend',html),workAnswer('quiet','First'));
        await p.clock.runFor(1400);
        await p.evaluate(()=>document.querySelector('#work-quiet > .whitespace-pre-wrap').textContent='Final');
        await p.clock.runFor(700);assert.equal(await notified(p),false);
        await p.clock.runFor(1000);assert.equal(await notified(p),true);await p.close();
    });
    await test('Work IME Enter does not arm a response',async()=>{
        const p=await fixture({work:true});
        await p.evaluate(()=>document.getElementById('work-editor').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));
        assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().waiting),false);await p.close();
    });
    await test('Work voice Stop dictation is ignored',async()=>{
        const p=await fixture({work:true});
        await p.evaluate(()=>document.getElementById('stop-host').innerHTML='<button aria-label="Stop dictation">Voice</button>');
        await p.clock.runFor(4000);assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().generating),false);
        assert.equal(await notified(p),false);await p.close();
    });
    await test('Work generation remains detected if its editor becomes read only',async()=>{
        const p=await fixture({work:true});
        await p.evaluate(()=>{document.getElementById('work-editor').setAttribute('contenteditable','false');document.getElementById('stop-host').innerHTML='<button aria-label="停止">Stop</button>';});
        await p.clock.runFor(1000);assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().generating),true);await p.close();
    });
    await test('Chat labeled ProseMirror Enter detects an instant response with no legacy Chat selectors',async()=>{
        const p=await fixture({work:true,richLabel:'Chat モードでチャット'});
        assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().layout),'Chat');
        await p.evaluate(()=>document.getElementById('work-editor').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
        assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().waiting),true);
        await p.evaluate(html=>document.getElementById('conversation').insertAdjacentHTML('beforeend',html),workAnswer('chat','テスト完了'));
        await p.clock.runFor(3000);assert.equal(await notified(p),true);
        await hidden(p,false);await assertOriginal(p);await p.close();
    });
    await test('English Message ChatGPT editor captures Send',async()=>{
        const p=await fixture({work:true,richLabel:'Message ChatGPT'});
        await p.evaluate(()=>{const button=document.querySelector('button[aria-label="送信"]');button.setAttribute('aria-label','Send message');button.click();});
        assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().waiting),true);
        await p.evaluate(html=>document.getElementById('conversation').insertAdjacentHTML('beforeend',html),workAnswer('message','Done'));
        await p.clock.runFor(3000);assert.equal(await notified(p),true);await p.close();
    });
    await test('Chat Stop control is recognized independently of the send event',async()=>{
        const p=await fixture({work:true,richLabel:'Chat mode'});
        await p.evaluate(()=>document.getElementById('stop-host').innerHTML='<button aria-label="停止">Stop</button>');
        await p.clock.runFor(1000);
        assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().generating),true);
        await p.evaluate(html=>{document.getElementById('stop-host').replaceChildren();document.getElementById('conversation').insertAdjacentHTML('beforeend',html);},workAnswer('stop','Done'));
        await p.clock.runFor(3000);assert.equal(await notified(p),true);await p.close();
    });
    await test('Switching Work to Chat without a reload preserves notification and restoration',async()=>{
        const p=await fixture({work:true});
        for(const mode of ['Work','Chat']){
            await hidden(p,true);
            await p.evaluate(mode=>{const editor=document.getElementById('work-editor');editor.setAttribute('aria-label',mode+' モードで作成');editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));},mode);
            await p.evaluate(html=>document.getElementById('conversation').insertAdjacentHTML('beforeend',html),workAnswer(mode,'テスト完了'));
            await p.clock.runFor(3000);assert.equal(await notified(p),true);
            assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().layout),mode);
            await hidden(p,false);await assertOriginal(p);
        }
        await p.close();
    });
    await test('Non-chat document editors do not arm a response',async()=>{
        const p=await fixture({work:true,richLabel:'ドキュメントを編集'});
        await p.evaluate(()=>document.getElementById('work-editor').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
        assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().waiting),false);await p.close();
    });
    await test('Japanese message composer recognizes Stop when temporarily read only',async()=>{
        const p=await fixture({work:true,richLabel:'メッセージを入力'});
        await p.evaluate(()=>{document.getElementById('work-editor').setAttribute('contenteditable','false');document.getElementById('stop-host').innerHTML='<button aria-label="停止する">Stop</button>';});
        await p.clock.runFor(1000);
        assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().generating),true);await p.close();
    });
    await test('Ask anything composer captures Enter without treating Shift Enter as send',async()=>{
        const p=await fixture({work:true,richLabel:'Ask anything'});
        await p.evaluate(()=>document.getElementById('work-editor').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true})));
        assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().waiting),false);
        await p.evaluate(()=>document.getElementById('work-editor').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
        assert.equal(await p.evaluate(()=>window.__chatgptResponseFaviconV2.inspect().waiting),true);await p.close();
    });
    await require('./desktop-tests.cjs')({test,fixture,send,output,streaming,hidden,assertOriginal,workAnswer,workUser,ORIGINAL});
    await require('./warning-tests.cjs')({test,fixture,send,output,streaming,hidden,assertOriginal,workAnswer,workUser,ORIGINAL});
    await browser.close();
    const resultPath=__dirname+'/favicon-test-results.json';
    if(fs.existsSync(resultPath)){
        const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date());let i=1;let backup;
        do{backup=__dirname+`/favicon-test-results.backup-${day}-${String(i++).padStart(2,'0')}.json`;}while(fs.existsSync(backup));
        fs.renameSync(resultPath,backup);assert.equal(fs.existsSync(resultPath),false);
    }
    fs.writeFileSync(resultPath,JSON.stringify(results,null,2)+'\n',{flag:'wx'});
    console.log(`${results.filter(r=>r.result==='PASS').length}/${results.length} passed`);
    process.exitCode = results.every(r=>r.result==='PASS') ? 0 : 1;
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});

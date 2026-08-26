import { chromium } from '@playwright/test';
const OUT='/tmp/claude-0/-home-mamed/3421f22d-3bd0-4eca-ae32-9600bdd9c715/scratchpad';
const BASE='http://127.0.0.1:4000', PID='a13628da-3294-4e33-a4e5-6ff3fe6d494b', TID='6e871e59-53fb-49da-97e4-55553ac1ccda', UID='ec3d4a0c-0ade-4a76-9363-e5ac3632f8bc';
const { signAccessToken } = await import('/home/mamed/prima-pm/server/dist/lib/jwt.js');
const tk = signAccessToken({ sub: UID, role:'PROJECT_MANAGER', email:'dadang@prismatix.id', tv:64, tid:TID });
const b=await chromium.launch({args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
await ctx.addCookies([{name:'prima_at',value:tk,url:BASE,sameSite:'Lax',secure:false}]);
const pg=await ctx.newPage();
await pg.goto(`${BASE}/projects/${PID}`,{waitUntil:'domcontentloaded'});
await pg.waitForTimeout(3000);
// Click level-1 "Cost" by visible text within the tab strip.
await pg.locator('button', { hasText: /^\s*💰?\s*Cost\s*$/ }).first().click({timeout:5000}).catch(async()=>{ await pg.getByText('Cost',{exact:true}).first().click().catch(()=>{}); });
await pg.waitForTimeout(1200);
// Dump all level-2 pill labels now visible.
const subTabs = await pg.evaluate(() => [...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>t && t.length<20));
const cashflowPresent = subTabs.some(t => /Cash-flow/.test(t));
await pg.screenshot({path:`${OUT}/cashflow-nav2.png`});
// Click it if present.
if (cashflowPresent) { await pg.getByRole('button',{name:'Cash-flow',exact:true}).first().click().catch(()=>{}); await pg.waitForTimeout(1500); await pg.screenshot({path:`${OUT}/cashflow-nav2-open.png`}); }
const heading = await pg.getByText('Arus kas',{exact:false}).count();
console.log(JSON.stringify({ cashflowInSubTabs: cashflowPresent, panelOpened: heading>0, sample: subTabs.filter(t=>/Cost|Cash|Procure/.test(t)) }));
await b.close();

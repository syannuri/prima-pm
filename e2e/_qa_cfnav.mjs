import { chromium } from '@playwright/test';
const OUT='/tmp/claude-0/-home-mamed/3421f22d-3bd0-4eca-ae32-9600bdd9c715/scratchpad';
const BASE='http://127.0.0.1:4000', PID='a13628da-3294-4e33-a4e5-6ff3fe6d494b', TID='6e871e59-53fb-49da-97e4-55553ac1ccda', UID='ec3d4a0c-0ade-4a76-9363-e5ac3632f8bc';
const { signAccessToken } = await import('/home/mamed/prima-pm/server/dist/lib/jwt.js');
const tk = signAccessToken({ sub: UID, role:'PROJECT_MANAGER', email:'dadang@prismatix.id', tv:64, tid:TID });
const b=await chromium.launch({args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
await ctx.addCookies([{name:'prima_at',value:tk,url:BASE,sameSite:'Lax',secure:false}]);
const pg=await ctx.newPage();
const errs=[]; pg.on('pageerror',e=>errs.push('PE:'+e.message.slice(0,120)));
// Land WITHOUT ?tab — default landing tab, then navigate via the nav like a real user.
await pg.goto(`${BASE}/projects/${PID}`,{waitUntil:'domcontentloaded'});
await pg.waitForTimeout(2500);
// Click the level-1 "Biaya" (Cost) group.
const cost = pg.getByRole('button',{name:/^Biaya$|^Cost$/}).first();
const costFound = await cost.count();
if (costFound) { await cost.click().catch(()=>{}); await pg.waitForTimeout(1000); }
// Now the level-2 sub-tab "Cash-flow" should be visible.
const cf = pg.getByRole('button',{name:'Cash-flow',exact:true});
const cfCount = await cf.count();
if (cfCount) { await cf.first().click().catch(()=>{}); await pg.waitForTimeout(1500); }
const heading = await pg.getByText('Arus kas',{exact:false}).count();
await pg.screenshot({path:`${OUT}/cashflow-nav.png`});
console.log(JSON.stringify({ costGroupFound: !!costFound, cashflowSubTabVisible: cfCount>0, panelHeading: heading>0, errs: errs.length }));
await b.close();

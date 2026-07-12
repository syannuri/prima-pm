import { chromium } from '@playwright/test';
import { PrismaClient } from '/home/mamed/prima-pm/server/node_modules/@prisma/client/index.js';
const OUT='/tmp/claude-0/-home-mamed/560838a1-f8a4-44df-9a90-820a4f1302be/scratchpad/qa';
import { mkdirSync } from 'node:fs'; mkdirSync(OUT,{recursive:true});
const BASE='http://127.0.0.1:4000';
const p=new PrismaClient();
const project=await p.project.findFirst({where:{deletedAt:null,tasks:{some:{}},directCosts:{some:{}}},orderBy:{createdAt:'asc'}});
const agile=await p.project.findFirst({where:{deletedAt:null,deliveryApproach:{in:['AGILE','HYBRID']}}});
const a=await p.user.findFirst({where:{role:'ADMIN',isActive:true}});
const {signAccessToken}=await import('/home/mamed/prima-pm/server/dist/lib/jwt.js');
const tk=signAccessToken({sub:a.id,role:a.role,email:a.email,tv:a.tokenVersion});
await p.$disconnect();
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
await ctx.addCookies([{name:'prima_at',value:tk,url:BASE,sameSite:'Strict',secure:false}]);
const pg=await ctx.newPage();
const errsByView={}; let cur='(init)';
pg.on('console',m=>{ if(m.type()==='error'){ (errsByView[cur]??=[]).push(m.text().slice(0,140)); }});
pg.on('pageerror',e=>{ (errsByView[cur]??=[]).push('PAGEERROR: '+e.message.slice(0,140)); });
const results=[];
async function check(name,fn){
  cur=name;
  try{ await fn(); await pg.waitForTimeout(1200); }catch(e){ (errsByView[name]??=[]).push('NAV-FAIL: '+e.message.slice(0,90)); }
  // horizontal overflow at the document level (real mobile scale bug)
  const o=await pg.evaluate(()=>{const d=document.documentElement;const b=document.body;const vw=window.innerWidth;const sw=Math.max(d.scrollWidth,b.scrollWidth);
    // widest element extending past the viewport (ignore fixed overlays)
    let worst=0,tag='';for(const el of document.querySelectorAll('body *')){const r=el.getBoundingClientRect();if(r.width>0&&r.right>vw+1&&r.right-vw>worst){worst=Math.round(r.right-vw);tag=el.tagName+'.'+(el.className&&typeof el.className==='string'?el.className.split(' ')[0]:'');}}
    return {vw,sw,over:Math.max(0,sw-vw),worst,tag};});
  const errs=errsByView[name]||[];
  results.push({name,over:o.over,worst:o.worst,tag:o.tag,errs:errs.length,firstErr:errs[0]||''});
  await pg.screenshot({path:`${OUT}/${name.replace(/[^\w]+/g,'-')}.png`});
}
async function tab(group,sub){ await pg.getByRole('button',{name:group,exact:true}).first().click(); await pg.waitForTimeout(300); if(sub){ await pg.getByRole('button',{name:sub,exact:true}).first().click(); } await pg.waitForTimeout(1200); }

await check('dashboard', async()=>{ await pg.goto(`${BASE}/`,{waitUntil:'domcontentloaded'}); await pg.waitForTimeout(2500); });
await check('reports', async()=>{ await pg.goto(`${BASE}/reports`,{waitUntil:'domcontentloaded'}); await pg.waitForTimeout(2000); });
await check('resources', async()=>{ await pg.goto(`${BASE}/admin/resources`,{waitUntil:'domcontentloaded'}); await pg.waitForTimeout(2000); });
await check('my-timesheet', async()=>{ await pg.goto(`${BASE}/my-timesheet`,{waitUntil:'domcontentloaded'}); await pg.waitForTimeout(2000); });
await check('settings', async()=>{ await pg.goto(`${BASE}/settings`,{waitUntil:'domcontentloaded'}); await pg.waitForTimeout(1500); });
await check('users', async()=>{ await pg.goto(`${BASE}/admin/users`,{waitUntil:'domcontentloaded'}); await pg.waitForTimeout(1500); });
// project tabs
await pg.goto(`${BASE}/projects/${project.id}`,{waitUntil:'domcontentloaded'}); await pg.waitForTimeout(2400);
await check('proj-charter', async()=>{ await tab('Initiating','Charter'); });
await check('proj-kickoff', async()=>{ await tab('Initiating','Kick-Off'); });
await check('proj-stakeholders', async()=>{ await tab('Initiating','Stakeholders'); });
await check('proj-requirements', async()=>{ await tab('Initiating','Requirements'); });
await check('proj-schedule', async()=>{ await tab('Planning','Schedule'); });
await check('proj-cost', async()=>{ await tab('Planning','Cost'); });
await check('proj-procurement', async()=>{ await tab('Planning','Procurement'); });
await check('proj-risk', async()=>{ await tab('Planning','Risk'); });
await check('proj-timesheet', async()=>{ await tab('Executing','Timesheet'); });
await check('proj-raid', async()=>{ await tab('Executing','RAID'); });
await check('proj-issues', async()=>{ await tab('Executing','Issues'); });
await check('proj-uat', async()=>{ await tab('Executing','UAT'); });
await check('proj-changereq', async()=>{ await tab('Executing','Change Req'); });
await check('proj-forecast', async()=>{ await tab('Monitoring & Controlling','Forecast'); });
await check('proj-evmtrend', async()=>{ await tab('Monitoring & Controlling','EVM Trend'); });
await check('proj-closeout', async()=>{ await pg.getByRole('button',{name:'Closing',exact:true}).first().click(); await pg.waitForTimeout(1200); });
await check('proj-audit', async()=>{ await pg.getByRole('button',{name:'Audit',exact:true}).first().click(); await pg.waitForTimeout(1200); });
if(agile){ await pg.goto(`${BASE}/projects/${agile.id}`,{waitUntil:'domcontentloaded'}); await pg.waitForTimeout(2000);
  await check('proj-agile', async()=>{ await tab('Planning','Agile'); }); }

console.log('=== QA RESULTS (view | hOverflow px | worst-el px/tag | errs) ===');
for(const r of results){ const flag=(r.over>1||r.worst>1||r.errs>0)?' <<':''; console.log(`${r.name.padEnd(20)} over=${String(r.over).padStart(4)} worst=${String(r.worst).padStart(4)} ${(r.tag||'').slice(0,28).padEnd(28)} errs=${r.errs} ${r.firstErr}${flag}`); }
await b.close();

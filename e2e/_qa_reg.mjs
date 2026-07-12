import { chromium } from '@playwright/test';
import { PrismaClient } from '/home/mamed/prima-pm/server/node_modules/@prisma/client/index.js';
const OUT='/tmp/claude-0/-home-mamed/560838a1-f8a4-44df-9a90-820a4f1302be/scratchpad/qa';
const PV='http://127.0.0.1:4200';
const PID='3cbf7d30-cd88-4824-8896-ef058ee13481'; // PRJ-2026-0004: 4 risks, 2 procurements
const p=new PrismaClient();
const a=await p.user.findFirst({where:{role:'ADMIN',isActive:true}});
const {signAccessToken}=await import('/home/mamed/prima-pm/server/dist/lib/jwt.js');
const tk=signAccessToken({sub:a.id,role:a.role,email:a.email,tv:a.tokenVersion});
await p.$disconnect();
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
await ctx.addCookies([{name:'prima_at',value:tk,url:PV,sameSite:'Strict',secure:false}]);
const pg=await ctx.newPage();
const errs=[]; pg.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,120));});
pg.on('pageerror',e=>errs.push('PAGEERR: '+e.message.slice(0,120)));
async function ov(){return pg.evaluate(()=>{const d=document.documentElement,bd=document.body,vw=innerWidth,sw=Math.max(d.scrollWidth,bd.scrollWidth);let w=0,t='';for(const el of document.querySelectorAll('body *')){const r=el.getBoundingClientRect();if(r.width>0&&r.right>vw+1&&r.right-vw>w){w=Math.round(r.right-vw);t=el.tagName+'.'+(typeof el.className==='string'?el.className.split(' ')[0]:'');}}return{over:Math.max(0,sw-vw),worst:w,tag:t};});}
async function tab(group,sub){await pg.getByRole('button',{name:group,exact:true}).first().click();await pg.waitForTimeout(300);if(sub)await pg.getByRole('button',{name:sub,exact:true}).first().click();await pg.waitForTimeout(1200);}
async function shot(name){const o=await ov();console.log(`${name.padEnd(14)} over=${o.over} worst=${o.worst} ${o.tag.slice(0,26).padEnd(26)} errs=${errs.length}`);await pg.screenshot({path:`${OUT}/reg-${name}.png`,fullPage:true});}
await pg.goto(`${PV}/projects/${PID}`,{waitUntil:'domcontentloaded'});await pg.waitForTimeout(2500);
await tab('Planning','Risk'); await shot('risk');
await tab('Planning','Procurement'); await shot('procurement');
await tab('Initiating','Stakeholders'); await shot('stakeholders');
await tab('Executing','Issues'); await shot('issues');
await tab('Executing','RAID'); await shot('raid');
await tab('Initiating','Kick-Off'); await shot('kickoff');
await pg.getByRole('button',{name:'Closing',exact:true}).first().click(); await pg.waitForTimeout(1400); await shot('closeout');
console.log('ALL ERRORS:',errs.length?errs:'none');
await b.close();

import { chromium } from '@playwright/test';
import { PrismaClient } from '/home/mamed/prima-pm/server/node_modules/@prisma/client/index.js';
const OUT='/tmp/claude-0/-home-mamed/560838a1-f8a4-44df-9a90-820a4f1302be/scratchpad/qa';
const PV='http://127.0.0.1:4200';const PID='a13628da-3294-4e33-a4e5-6ff3fe6d494b';
const p=new PrismaClient();const a=await p.user.findFirst({where:{role:'ADMIN',isActive:true}});
const {signAccessToken}=await import('/home/mamed/prima-pm/server/dist/lib/jwt.js');
const tk=signAccessToken({sub:a.id,role:a.role,email:a.email,tv:a.tokenVersion});await p.$disconnect();
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
await ctx.addCookies([{name:'prima_at',value:tk,url:PV,sameSite:'Strict',secure:false}]);
const pg=await ctx.newPage();
let cur='init';const errs={};
pg.on('console',m=>{if(m.type()==='error')(errs[cur]??=[]).push(m.text().slice(0,110));});
pg.on('pageerror',e=>(errs[cur]??=[]).push('PAGEERR:'+e.message.slice(0,110)));
async function ov(){return pg.evaluate(()=>{const d=document.documentElement,bd=document.body,vw=innerWidth,sw=Math.max(d.scrollWidth,bd.scrollWidth);let w=0,t='';for(const el of document.querySelectorAll('body *')){const r=el.getBoundingClientRect();if(r.width>0&&r.right>vw+1&&r.right-vw>w){w=Math.round(r.right-vw);t=el.tagName+'.'+(typeof el.className==='string'?el.className.split(' ').slice(0,2).join('.'):'');}}return{over:Math.max(0,sw-vw),worst:w,tag:t};});}
async function shot(name){cur=name;const o=await ov();console.log(`${name.padEnd(14)} over=${String(o.over).padStart(3)} worst=${String(o.worst).padStart(3)} ${o.tag.slice(0,30).padEnd(30)} errs=${(errs[name]||[]).length}`);await pg.screenshot({path:`${OUT}/rest-${name}.png`});}
async function step(name,fn){try{await fn();await pg.waitForTimeout(700);await shot(name);}catch(e){console.log(`${name.padEnd(14)} SKIP ${String(e.message).slice(0,50)}`);}}

await step('users',async()=>{await pg.goto(`${PV}/admin/users`,{waitUntil:'domcontentloaded'});await pg.waitForTimeout(1800);});
await step('settings',async()=>{await pg.goto(`${PV}/settings`,{waitUntil:'domcontentloaded'});await pg.waitForTimeout(1400);});
await step('manual',async()=>{await pg.goto(`${PV}/manual`,{waitUntil:'domcontentloaded'});await pg.waitForTimeout(1400);});
await step('projects',async()=>{await pg.goto(`${PV}/projects`,{waitUntil:'domcontentloaded'});await pg.waitForTimeout(1600);});
// WBS
await step('wbs',async()=>{await pg.goto(`${PV}/projects/${PID}`,{waitUntil:'domcontentloaded'});await pg.waitForTimeout(2200);await pg.getByRole('button',{name:'Planning',exact:true}).first().click();await pg.waitForTimeout(300);await pg.getByRole('button',{name:'Schedule',exact:true}).first().click();await pg.waitForTimeout(1400);await pg.getByText('WBS',{exact:false}).first().scrollIntoViewIfNeeded().catch(()=>{});await pg.waitForTimeout(400);});
const allE=Object.entries(errs).filter(([k,v])=>v.length);
console.log('ERRORS:',allE.length?JSON.stringify(allE):'none');
await b.close();

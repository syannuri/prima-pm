import { chromium } from '@playwright/test';
import { PrismaClient } from '/home/mamed/prima-pm/server/node_modules/@prisma/client/index.js';
const OUT='/tmp/claude-0/-home-mamed/560838a1-f8a4-44df-9a90-820a4f1302be/scratchpad/qa';
import {mkdirSync} from 'node:fs'; mkdirSync(OUT,{recursive:true});
const BASE='http://127.0.0.1:4000';
const PID='a13628da-3294-4e33-a4e5-6ff3fe6d494b'; // PRJ-2026-0007 active
const p=new PrismaClient();
const a=await p.user.findFirst({where:{role:'ADMIN',isActive:true}});
const {signAccessToken}=await import('/home/mamed/prima-pm/server/dist/lib/jwt.js');
const tk=signAccessToken({sub:a.id,role:a.role,email:a.email,tv:a.tokenVersion});await p.$disconnect();
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
await ctx.addCookies([{name:'prima_at',value:tk,url:BASE,sameSite:'Strict',secure:false}]);
const pg=await ctx.newPage();
let cur='init';const errs={};
pg.on('console',m=>{if(m.type()==='error')(errs[cur]??=[]).push(m.text().slice(0,110));});
pg.on('pageerror',e=>(errs[cur]??=[]).push('PAGEERR:'+e.message.slice(0,110)));
async function ov(){return pg.evaluate(()=>{const d=document.documentElement,bd=document.body,vw=innerWidth,sw=Math.max(d.scrollWidth,bd.scrollWidth);let w=0,t='';for(const el of document.querySelectorAll('body *')){const r=el.getBoundingClientRect();if(r.width>0&&r.right>vw+1&&r.right-vw>w){w=Math.round(r.right-vw);t=el.tagName+'.'+(typeof el.className==='string'?el.className.split(' ').slice(0,2).join('.'):'');}}return{over:Math.max(0,sw-vw),worst:w,tag:t};});}
async function shot(name){cur=name;const o=await ov();console.log(`${name.padEnd(20)} over=${String(o.over).padStart(3)} worst=${String(o.worst).padStart(3)} ${o.tag.slice(0,30).padEnd(30)} errs=${(errs[name]||[]).length}`);await pg.screenshot({path:`${OUT}/nt-${name}.png`});}
async function step(name,fn){try{await fn();await shot(name);}catch(e){console.log(`${name.padEnd(20)} SKIP: ${String(e.message).slice(0,60)}`);}}
async function tab(g,s){await pg.getByRole('button',{name:g,exact:true}).first().click();await pg.waitForTimeout(300);if(s)await pg.getByRole('button',{name:s,exact:true}).first().click();await pg.waitForTimeout(1000);}
async function openModal(label){await pg.getByRole('button',{name:label,exact:false}).first().click();await pg.waitForTimeout(700);}
async function esc(){await pg.keyboard.press('Escape');await pg.waitForTimeout(400);}

await pg.goto(`${BASE}/projects/${PID}`,{waitUntil:'domcontentloaded'});await pg.waitForTimeout(2400);
// MODALS
await step('modal-requirement',async()=>{await tab('Initiating','Requirements');await openModal('Add requirement');});await esc();
await step('modal-stakeholder',async()=>{await tab('Initiating','Stakeholders');await openModal('Add stakeholder');});await esc();
await step('modal-procurement',async()=>{await tab('Planning','Procurement');await openModal('Add procurement');});await esc();
await step('modal-issue',async()=>{await tab('Executing','Issues');await openModal('Log issue');});await esc();
await step('modal-uat',async()=>{await tab('Executing','UAT');await openModal('Add test case');});await esc();
// INLINE FORMS
await step('inline-risk',async()=>{await tab('Planning','Risk');await pg.getByText('Add Risk',{exact:false}).first().scrollIntoViewIfNeeded();});
await step('inline-changereq',async()=>{await tab('Executing','Change Req');});
// CHARTS
await step('chart-forecast',async()=>{await tab('Monitoring & Controlling','Forecast');});
await step('chart-evmtrend',async()=>{await tab('Monitoring & Controlling','EVM Trend');await pg.evaluate(()=>window.scrollBy(0,400));await pg.waitForTimeout(400);});
// RESOURCE MODAL
await step('modal-resource',async()=>{await pg.goto(`${BASE}/admin/resources`,{waitUntil:'domcontentloaded'});await pg.waitForTimeout(1500);await openModal('Add resource');});await esc();
// REPORTS
await step('reports-exec',async()=>{await pg.goto(`${BASE}/reports`,{waitUntil:'domcontentloaded'});await pg.waitForTimeout(1800);});
await step('reports-portfolio',async()=>{await pg.getByRole('button',{name:'Portfolio',exact:true}).first().click();await pg.waitForTimeout(1600);});
await step('reports-analytics',async()=>{await pg.getByRole('button',{name:'Analytics',exact:true}).first().click();await pg.waitForTimeout(1600);});
const allE=Object.entries(errs).filter(([k,v])=>v.length);
console.log('ERRORS:',allE.length?JSON.stringify(allE):'none');
await b.close();

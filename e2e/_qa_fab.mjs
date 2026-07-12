import { chromium } from '@playwright/test';
import { PrismaClient } from '/home/mamed/prima-pm/server/node_modules/@prisma/client/index.js';
const OUT='/tmp/claude-0/-home-mamed/560838a1-f8a4-44df-9a90-820a4f1302be/scratchpad/qa';
const PV='http://127.0.0.1:4200';
const p=new PrismaClient();const a=await p.user.findFirst({where:{role:'ADMIN',isActive:true}});
const {signAccessToken}=await import('/home/mamed/prima-pm/server/dist/lib/jwt.js');
const tk=signAccessToken({sub:a.id,role:a.role,email:a.email,tv:a.tokenVersion});await p.$disconnect();
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
await ctx.addCookies([{name:'prima_at',value:tk,url:PV,sameSite:'Strict',secure:false}]);
const pg=await ctx.newPage();
await pg.goto(`${PV}/`,{waitUntil:'domcontentloaded'});await pg.waitForTimeout(2500);
// scroll so Projects header sits near bottom (worst case for FAB overlap)
await pg.getByText('Projects',{exact:true}).first().scrollIntoViewIfNeeded().catch(()=>{});
await pg.waitForTimeout(400);
await pg.screenshot({path:`${OUT}/nav-fab-fixed.png`});
// measure: does FAB rect overlap the Closed chip rect?
const r=await pg.evaluate(()=>{
  const fab=document.querySelector('.fab')?.getBoundingClientRect();
  const chips=[...document.querySelectorAll('button')].filter(x=>/Closed/.test(x.textContent||''));
  const chip=chips.length?chips[chips.length-1].getBoundingClientRect():null;
  const overlap=fab&&chip&&!(fab.right<chip.left||fab.left>chip.right||fab.bottom<chip.top||fab.top>chip.bottom);
  return {fab:fab&&{l:Math.round(fab.left),r:Math.round(fab.right),t:Math.round(fab.top)},chip:chip&&{l:Math.round(chip.left),r:Math.round(chip.right),t:Math.round(chip.top)},overlap};
});
console.log('FAB',JSON.stringify(r.fab),'CLOSED-chip',JSON.stringify(r.chip),'OVERLAP:',r.overlap);
await b.close();

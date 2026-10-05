import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createApp} from './server.mjs';
import {Game} from './rules.mjs';
const sword='swordsman-luqinglan';
async function launch(options){const app=await createApp(options);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;return {...app,base};}
async function call(app,route,session=null,body={}){const response=await fetch(app.base+'/api/'+route,{method:'POST',headers:{'content-type':'application/json',...(session?{'x-player-id':session.id,'x-player-token':session.token}:{})},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
async function session(app){return (await call(app,'session',null,{classId:sword})).data.session;}

test('HTTP walking starts a shared random battle and schedules automatic actors',async()=>{
 const app=await launch({game:new Game({rng:()=>0}),storeFile:null,tickMs:15});
 try{
  const host=await session(app),guest=await session(app);const team=await call(app,'team/create',host);await call(app,'team/join',guest,{code:team.data.party.code});
  await call(app,'team/ready',guest,{ready:true});
  const player=app.game.player(host.id);player.x=537;player.y=790;
  let result;for(const x of [569,601,633])result=await call(app,'move',host,{x,y:790});
  assert.equal(result.status,200);assert.equal(result.data.battle.zone,'tuanzi');assert.equal(result.data.battle.enemies.length,2);
  const shared=await call(app,'state',guest);assert.equal(shared.data.battle.id,result.data.battle.id);
  assert.equal((await call(app,'move',host,{x:640,y:790})).status,409);
  for(let i=0;i<10&&app.game.battleFor(host.id).seq===0;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(app.game.battleFor(host.id).seq>0);
 }finally{await app.stop();}
});
test('HTTP five-member party rejects sixth member and gives at most ten enemies',async()=>{
 const app=await launch({game:new Game({rng:()=>.999}),storeFile:null});
 try{
  const host=await session(app);let res=await call(app,'team/create',host);const code=res.data.party.code;
  for(let i=0;i<4;i++){const guest=await session(app);assert.equal((await call(app,'team/join',guest,{code})).status,200);await call(app,'team/ready',guest,{ready:true});}
  const sixth=await session(app);assert.equal((await call(app,'team/join',sixth,{code})).status,409);
  res=await call(app,'encounter',host,{species:'wolf',rarity:'normal'});assert.equal(res.data.battle.enemies.length,10);assert.equal(res.data.party.members.length,5);
 }finally{await app.stop();}
});
test('HTTP simultaneous commands resolve only one action and reject unauthenticated calls',async()=>{
 const app=await launch({game:new Game({rng:()=>0}),storeFile:null});
 try{
  const host=await session(app);const begin=await call(app,'encounter',host,{species:'tuanzi',rarity:'normal'}),targetId=begin.data.battle.enemies[0].id;
  const results=await Promise.all([call(app,'action',host,{type:'normal',targetId}),call(app,'action',host,{type:'normal',targetId})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await call(app,'action',null,{type:'normal',targetId})).status,401);
 }finally{await app.stop();}
});
test('HTTP captures and equipped pets survive server restart with the same session',async()=>{
 const storeFile=path.resolve('work/first-map-http-test-state.json');let app=await launch({game:new Game({rng:()=>0}),storeFile});
 try{
  const host=await session(app);const begin=await call(app,'encounter',host,{species:'tuanzi',rarity:'baby'});
  const captured=await call(app,'action',host,{type:'capture',targetId:begin.data.battle.enemies[0].id});assert.equal(captured.data.player.pets.length,1);
  const petId=captured.data.player.equippedPet;await app.saveNow();await app.stop();app=await launch({storeFile});
  const restored=await call(app,'session',null,{id:host.id,token:host.token});assert.equal(restored.status,200);assert.equal(restored.data.player.equippedPet,petId);assert.equal(restored.data.player.pets[0].rarity,'baby');
 }finally{await app.stop();}
});
test('HTTP equipment validates ownership and saves worn bonuses across restart',async()=>{
 const storeFile=path.resolve('work/first-map-equipment-http-test-state.json');let app=await launch({game:new Game({rng:()=>0}),storeFile});
 try{
  const host=await session(app),guest=await session(app),weapon=app.game.player(host.id).inventory.find(i=>i.slot==='weapon');
  assert.equal((await call(app,'equipment/equip',null,{itemId:weapon.id})).status,401);
  assert.equal((await call(app,'equipment/equip',guest,{itemId:weapon.id})).status,409);
  const worn=await call(app,'equipment/equip',host,{itemId:weapon.id,stats:{atk:999999}});assert.equal(worn.status,200);assert.equal(worn.data.player.stats.atk,34);
  for(const item of app.game.player(host.id).inventory.filter(i=>i.slot!=='weapon'))assert.equal((await call(app,'equipment/equip',host,{itemId:item.id})).status,200);
  const full=await call(app,'equipment/auto',host);assert.equal(full.status,200);assert.equal(Object.values(full.data.player.equipment).filter(Boolean).length,6);
  await app.stop();app=await launch({storeFile});const restored=await call(app,'session',null,host);
  assert.equal(restored.status,200);assert.deepEqual(restored.data.player.stats,full.data.player.stats);assert.equal(restored.data.player.inventory.length,6);
  const removed=await call(app,'equipment/unequip',host,{slot:'weapon'});assert.equal(removed.status,200);assert.equal(removed.data.player.stats.atk,30);
 }finally{await app.stop();await fs.unlink(storeFile).catch(()=>{});}
});
test('HTTP loot appears once per owner and equipment waits until return to map',async()=>{
 const app=await launch({game:new Game({rng:()=>0}),storeFile:null,tickMs:10000});
 try{
  const host=await session(app),guest=await session(app),team=await call(app,'team/create',host);await call(app,'team/join',guest,{code:team.data.party.code});
  await call(app,'team/ready',guest,{ready:true});
  await call(app,'encounter',host,{species:'tuanzi',rarity:'mutant'});const battle=app.game.battleFor(host.id);
  assert.equal((await call(app,'equipment/auto',host)).status,409);
  for(const enemy of battle.enemies)enemy.hp=0;app.game.settle(battle);
  const state=await call(app,'state',guest),own=state.data.battle.result.loot.find(l=>l.ownerId===guest.id);
  assert.ok(own.items.length>0);assert.ok(state.data.player.inventory.some(i=>i.id===own.items[0].id));assert.equal((await call(app,'equipment/auto',guest)).status,409);
  await call(app,'battle/finish',host);assert.equal((await call(app,'equipment/auto',guest)).status,200);
  assert.equal((await call(app,'equipment/unequip',guest,{slot:'forged'})).status,409);
 }finally{await app.stop();}
});

test('HTTP team readiness and leader transfer validate membership and control departure',async()=>{
 const app=await launch({game:new Game({rng:()=>0}),storeFile:null,tickMs:10000});
 try{
  const host=await session(app),guest=await session(app),stranger=await session(app),team=await call(app,'team/create',host),joined=await call(app,'team/join',guest,{code:team.data.party.code});
  assert.equal(joined.data.player.ready,false);assert.equal((await call(app,'encounter',host,{species:'tuanzi'})).status,409);
  const p=app.game.player(host.id);p.x=537;p.y=790;for(const x of [569,601,633]){const moved=await call(app,'move',host,{x,y:790});assert.equal(moved.status,200);assert.equal(moved.data.battle,null);}
  assert.equal((await call(app,'team/ready',guest,{ready:'true'})).status,409);assert.equal((await call(app,'team/leader',host,{memberId:stranger.id})).status,409);
  await call(app,'team/ready',guest,{ready:true});const transferred=await call(app,'team/leader',host,{memberId:guest.id});assert.equal(transferred.status,200);assert.equal(transferred.data.party.leader,guest.id);
  assert.equal((await call(app,'encounter',host,{species:'tuanzi'})).status,409);assert.equal((await call(app,'encounter',guest,{species:'tuanzi'})).status,200);
  assert.equal((await call(app,'team/ready',guest,{ready:false})).status,409);
 }finally{await app.stop();}
});
test('HTTP map medicines and inn rest use saved resources and ignore forged recovery amounts',async()=>{
 const app=await launch({game:new Game({rng:()=>0}),storeFile:null,tickMs:10000});
 try{
  const host=await session(app);const begin=await call(app,'encounter',host,{species:'monkey'}),b=app.game.battleFor(host.id);b.allies[0].hp=20;b.allies[0].mp=10;app.game.settle(b);b.enemies.forEach(e=>e.hp=0);app.game.settle(b);await call(app,'battle/finish',host);
  const count=app.game.player(host.id).supplies['hp-pill'],used=await call(app,'bag/use',host,{itemId:'hp-pill',amount:99999,targetId:begin.data.battle.enemies[0].id});
  assert.equal(used.status,200);assert.equal(used.data.player.vitals.hp,100);assert.equal(used.data.player.supplies['hp-pill'],count-1);
  const mana=await call(app,'bag/use',host,{itemId:'mp-pill'});assert.equal(mana.data.player.vitals.mp,50);
  const p=app.game.player(host.id);p.x=500;assert.equal((await call(app,'rest',host)).status,409);p.x=245;const rested=await call(app,'rest',host);assert.equal(rested.status,200);assert.equal(rested.data.player.vitals.hp,162);assert.equal(rested.data.player.vitals.mp,100);
  const full=await call(app,'bag/use',host,{itemId:'hp-pill'});assert.equal(full.status,409);assert.equal(p.supplies['hp-pill'],count-1);
  assert.equal((await call(app,'bag/use',null,{itemId:'hp-pill'})).status,401);
 }finally{await app.stop();}
});
test('HTTP combat medicines restore the selected ally and protect inventory from duplicate actions',async()=>{
 const app=await launch({game:new Game({rng:()=>0}),storeFile:null,tickMs:10000});
 try{
  const host=await session(app);await call(app,'encounter',host,{species:'monkey'});const b=app.game.battleFor(host.id);b.allies[0].hp=10;b.allies[0].mp=0;
  const used=await call(app,'action',host,{type:'item',itemId:'mp-pill',targetId:host.id});assert.equal(used.status,200);assert.equal(used.data.player.vitals.mp,40);assert.equal(used.data.player.supplies['mp-pill'],2);assert.equal(used.data.battle.lastAction.kind,'item');
  assert.equal((await call(app,'action',host,{type:'item',itemId:'hp-pill',targetId:host.id})).status,409);assert.equal(app.game.player(host.id).supplies['hp-pill'],3);
  assert.equal((await call(app,'bag/use',host,{itemId:'hp-pill'})).status,409);assert.equal((await call(app,'battle/retreat',host)).status,409);
 }finally{await app.stop();}
});
test('HTTP captured pet rename checks ownership and publishes its fighting ability',async()=>{
 const app=await launch({game:new Game({rng:()=>0}),storeFile:null,tickMs:10000});
 try{
  const host=await session(app),guest=await session(app),begin=await call(app,'encounter',host,{species:'tuanzi',rarity:'baby'});await call(app,'action',host,{type:'capture',targetId:begin.data.battle.enemies[0].id});
  const b=app.game.battleFor(host.id),petId=app.game.player(host.id).equippedPet;assert.equal((await call(app,'pet/rename',host,{petId,name:'小团'})).status,409);b.busy=false;await call(app,'battle/finish',host);
  assert.equal((await call(app,'pet/rename',guest,{petId,name:'偷走'})).status,409);const renamed=await call(app,'pet/rename',host,{petId,name:' 小团 '});assert.equal(renamed.status,200);
  assert.equal(renamed.data.player.pets[0].name,'小团');assert.equal(renamed.data.player.pets[0].ability.cooldown,3);assert.ok(renamed.data.player.pets[0].stats.maxHp>0);
  const items=await fetch(app.base+'/first-map-v1/items.json').then(r=>r.json());assert.equal(items.find(i=>i.id==='hp-pill').amount,80);
 }finally{await app.stop();}
});
test('HTTP default scheduler honors the full capture duration before allowing return',async()=>{
 const app=await launch({game:new Game({rng:()=>0}),storeFile:null});
 try{
  const host=await session(app),begin=await call(app,'encounter',host,{species:'tuanzi',rarity:'baby'}),captured=await call(app,'action',host,{type:'capture',targetId:begin.data.battle.enemies[0].id});
  assert.equal(captured.data.battle.lastAction.durationMs,1500);await new Promise(resolve=>setTimeout(resolve,950));
  const pending=await call(app,'battle/finish',host);assert.equal(pending.status,409);assert.equal(app.game.battleFor(host.id).seq,1);
  for(let i=0;i<40&&app.game.battleFor(host.id).busy;i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal((await call(app,'battle/finish',host)).status,200);
 }finally{await app.stop();}
});
test('HTTP server restart restores shared battles and schedules saved automatic actors',async()=>{
 const testDir=await fs.mkdtemp(path.resolve('work/first-map-systems-http-')),storeFile=path.join(testDir,'state.json');let app=await launch({game:new Game({rng:()=>0}),storeFile,tickMs:10000});
 try{
  const host=await session(app);await call(app,'settings',host,{classId:sword,level:3});const team=await call(app,'team/create',host);await call(app,'team/companion',host,{classId:'healer-shenzhiwei'});
  const begin=await call(app,'encounter',host,{species:'boar'});await call(app,'action',host,{type:'skill',skillId:'a',targetId:begin.data.battle.enemies[0].id});const battleId=app.game.battleFor(host.id).id;
  await app.stop();app=await launch({storeFile,tickMs:20});const restored=await call(app,'session',null,host);assert.equal(restored.status,200);assert.equal(restored.data.party.code,team.data.party.code);assert.equal(restored.data.party.members.length,2);assert.equal(restored.data.battle.id,battleId);assert.equal(restored.data.player.vitals.mp,82);
  for(let i=0;i<30&&app.game.battleFor(host.id).seq===1;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(app.game.battleFor(host.id).seq>1);assert.ok(app.game.battleFor(host.id).lastAction.durationMs>0);
  const saved=JSON.parse(await fs.readFile(storeFile,'utf8'));assert.equal(saved.world.teams.length,1);assert.equal(saved.world.npcs.length,1);assert.equal(saved.world.battles.length,1);
 }finally{await app.stop();await fs.unlink(storeFile).catch(()=>{});await fs.rmdir(testDir).catch(()=>{});}
});

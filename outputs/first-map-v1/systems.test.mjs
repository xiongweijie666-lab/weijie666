import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from './rules.mjs';
const sword='swordsman-luqinglan',mage='mage-suyingyue',healer='healer-shenzhiwei';
function fixture(classId=sword,level=1,rng=()=>0){const game=new Game({rng}),p=game.createPlayer(classId);p.level=level;return {game,p};}
function fight(game,p,species='monkey'){game.startEncounter(p.id,species);return game.battleFor(p.id);}
function turn(b,id){b.currentActor=id;b.index=b.queue.indexOf(id);}
function pet(p,species){const q={id:'pet-'+species,species,rarity:'normal',level:1,xp:0};p.pets.push(q);p.equippedPet=q.id;return q;}

test('starter medicines migrate once and a saved empty bag remains empty',()=>{
 const {game,p}=fixture();assert.deepEqual(game.snapshot(p.id).player.supplies,{'hp-pill':3,'mp-pill':3});
 const old=game.exportPlayers()[0];delete old.supplies;
 const migrated=new Game({savedPlayers:[old]});assert.deepEqual(migrated.player(p.id).supplies,{'hp-pill':3,'mp-pill':3});
 migrated.player(p.id).supplies['hp-pill']=0;const restored=new Game({savedPlayers:migrated.exportPlayers()});
 assert.equal(restored.player(p.id).supplies['hp-pill'],0);
});
test('equipment changes preserve resource deficits even when lower maximum clamps health to zero',()=>{
 const {game,p}=fixture();assert.deepEqual(game.snapshot(p.id).player.vitals,{hp:162,mp:100,maxHp:162,maxMp:100});
 const high={id:'large-head',slot:'head',level:1,quality:'common',stats:{maxHp:300}};p.inventory.push(high);
 game.equipEquipment(p.id,high.id);let b=fight(game,p);b.allies[0].hp=100;b.allies[0].mp=35;game.settle(b);
 b.enemies.forEach(e=>e.hp=0);game.settle(b);game.finishBattle(p.id);
 game.unequipEquipment(p.id,'head');assert.equal(game.snapshot(p.id).player.vitals.hp,0);
 game.equipEquipment(p.id,high.id);assert.equal(game.snapshot(p.id).player.vitals.hp,100);
 const charm=p.inventory.find(i=>i.slot==='charm');game.equipEquipment(p.id,charm.id);
 assert.deepEqual(game.snapshot(p.id).player.vitals,{hp:100,mp:47,maxHp:462,maxMp:112});
 const restored=new Game({savedPlayers:game.exportPlayers()});assert.deepEqual(restored.snapshot(p.id).player.vitals,game.snapshot(p.id).player.vitals);
});
test('medicine consumes retained health loss before equipment can restore its maximum',()=>{
 const {game,p}=fixture(),head=p.inventory.find(item=>item.slot==='head');game.equipEquipment(p.id,head.id);const b=fight(game,p,'boar');b.allies[0].hp=5;b.enemies.forEach(e=>e.hp=0);game.settle(b);game.finishBattle(p.id);
 game.unequipEquipment(p.id,'head');assert.equal(game.snapshot(p.id).player.vitals.hp,0);
 const recovery=game.snapshot(p.id).player.supplyRecovery;game.useSupply(p.id,'hp-pill');assert.equal(game.snapshot(p.id).player.vitals.hp,73);game.equipEquipment(p.id,head.id);assert.equal(game.snapshot(p.id).player.vitals.hp,85);
 assert.deepEqual(recovery,{'hp-pill':73,'mp-pill':0});
 assert.ok(!('vitalDeficits' in game.snapshot(p.id).player));
});
test('medicine can reduce a larger retained loss without clearing it at zero health',()=>{
 const {game,p}=fixture();const head={id:'large-head',slot:'head',level:1,quality:'common',stats:{maxHp:300}};p.inventory.push(head);game.equipEquipment(p.id,head.id);
 const b=fight(game,p,'boar');b.allies[0].hp=10;b.enemies.forEach(e=>e.hp=0);game.settle(b);game.finishBattle(p.id);game.unequipEquipment(p.id,'head');
 const recovery=game.snapshot(p.id).player.supplyRecovery?.['hp-pill'],count=p.supplies['hp-pill'];game.useSupply(p.id,'hp-pill');assert.equal(p.supplies['hp-pill'],count-1);assert.equal(game.snapshot(p.id).player.vitals.hp,0);assert.equal(recovery,0);
 const restored=new Game({savedPlayers:game.exportPlayers()});restored.equipEquipment(p.id,head.id);assert.equal(restored.snapshot(p.id).player.vitals.hp,90);
});
test('battle settlement preserves clamped health loss when another hero remains alive',()=>{
 const {game,p}=fixture(),head=p.inventory.find(item=>item.slot==='head');game.equipEquipment(p.id,head.id);const first=fight(game,p,'boar');first.allies[0].hp=5;first.enemies.forEach(e=>e.hp=0);game.settle(first);game.finishBattle(p.id);game.unequipEquipment(p.id,'head');
 game.createTeam(p.id);game.addCompanion(p.id,healer);const b=fight(game,p,'boar');game.settle(b);assert.equal(b.status,'active');assert.equal(b.allies[0].hp,0);
 const restored=new Game({savedPlayers:game.exportPlayers()});restored.equipEquipment(p.id,head.id);assert.equal(restored.snapshot(p.id).player.vitals.hp,5);
});
test('combat mana medicine consumes retained loss and reports the actual restoration',()=>{
 const {game,p}=fixture(),charm=p.inventory.find(item=>item.slot==='charm');game.equipEquipment(p.id,charm.id);const first=fight(game,p,'boar');first.allies[0].mp=5;first.enemies.forEach(e=>e.hp=0);game.settle(first);game.finishBattle(p.id);game.unequipEquipment(p.id,'charm');
 const b=fight(game,p,'boar');game.settle(b);const e=game.act(p.id,{type:'item',itemId:'mp-pill',targetId:p.id});assert.equal(b.allies[0].mp,33);assert.deepEqual(e.hits,[{id:p.id,type:'mana',value:33}]);assert.equal(game.snapshot(p.id).player.vitals.mp,33);
 b.enemies.forEach(enemy=>enemy.hp=0);game.settle(b);game.finishBattle(p.id);game.equipEquipment(p.id,charm.id);assert.equal(game.snapshot(p.id).player.vitals.mp,45);
});
test('settlement persists spent mana and wounds for the next encounter and level gains adjust the maximum',()=>{
 const {game,p}=fixture(sword,3),b=fight(game,p,'tuanzi'),hero=b.allies[0];hero.hp=120;
 game.act(p.id,{type:'skill',skillId:'a',targetId:b.enemies[0].id});
 assert.equal(game.snapshot(p.id).player.vitals.mp,82);assert.equal(game.snapshot(p.id).player.vitals.hp,120);
 game.finishBattle(p.id);p.xp=60+p.level*20-1;const next=fight(game,p,'tuanzi');
 assert.equal(next.allies[0].hp,120);assert.equal(next.allies[0].mp,82);
 next.enemies.forEach(e=>e.hp=0);game.settle(next);assert.equal(p.level,4);
 assert.equal(game.snapshot(p.id).player.vitals.maxHp,213);assert.equal(game.snapshot(p.id).player.vitals.hp,137);
 assert.equal(next.allies[0].maxHp,213);assert.equal(next.allies[0].hp,137);
});
test('map medicines restore actual resources, reject full resources and never consume missing inventory',()=>{
 const {game,p}=fixture(),b=fight(game,p);b.allies[0].hp=20;b.allies[0].mp=10;game.settle(b);b.enemies.forEach(e=>e.hp=0);game.settle(b);game.finishBattle(p.id);
 const hpCount=p.supplies?.['hp-pill'],mpCount=p.supplies?.['mp-pill'];game.useSupply(p.id,'hp-pill');assert.equal(game.snapshot(p.id).player.vitals.hp,100);assert.equal(p.supplies['hp-pill'],hpCount-1);
 game.useSupply(p.id,'mp-pill');assert.equal(game.snapshot(p.id).player.vitals.mp,50);assert.equal(p.supplies['mp-pill'],mpCount-1);
 game.rest(p.id);assert.throws(()=>game.useSupply(p.id,'hp-pill'),/已满/);assert.equal(p.supplies['hp-pill'],hpCount-1);
 assert.throws(()=>game.useSupply(p.id,'forged'),/药品|物品/);p.supplies['hp-pill']=0;assert.throws(()=>game.useSupply(p.id,'hp-pill'),/不足|没有/);
});
test('rest requires the inn and map state; retreat and defeat recover the party',()=>{
 const {game,p}=fixture();assert.ok(game.snapshot(p.id).player.vitals);p.x=400;p.y=825;
 assert.throws(()=>game.rest(p.id),/驿站/);p.x=365;game.rest(p.id);const b=fight(game,p);b.allies[0].hp=1;b.allies[0].mp=0;game.settle(b);
 assert.throws(()=>game.rest(p.id),/战斗|地图/);game.retreat(p.id);assert.deepEqual(game.snapshot(p.id).player.vitals,{hp:162,mp:100,maxHp:162,maxMp:100});
 const lost=fight(game,p);lost.allies[0].hp=0;game.settle(lost);game.finishBattle(p.id);assert.equal(game.snapshot(p.id).player.vitals.hp,162);
});
test('combat medicine costs one action, heals a living pet and uses the actor owner inventory',()=>{
 const {game,p}=fixture();pet(p,'tuanzi');const b=fight(game,p),q=b.allies.find(a=>a.kind==='pet');q.hp=5;
 const e=game.act(p.id,{type:'item',itemId:'hp-pill',targetId:q.id});assert.equal(e.kind,'item');assert.equal(e.itemId,'hp-pill');assert.equal(e.durationMs,1250);
 assert.deepEqual(e.targets,[q.id]);assert.equal(q.hp,65);assert.equal(p.supplies['hp-pill'],2);assert.notEqual(b.currentActor,p.id);
});
test('invalid combat medicine targets and full resources leave inventory and turn untouched',()=>{
 const {game,p}=fixture();pet(p,'wolf');const b=fight(game,p),q=b.allies.find(a=>a.kind==='pet'),seq=b.seq;
 for(const command of [{itemId:'hp-pill',targetId:p.id},{itemId:'mp-pill',targetId:q.id},{itemId:'hp-pill',targetId:b.enemies[0].id},{itemId:'forged',targetId:p.id}])assert.throws(()=>game.act(p.id,{type:'item',...command}));
 q.hp=0;assert.throws(()=>game.act(p.id,{type:'item',itemId:'hp-pill',targetId:q.id}));
 assert.deepEqual(p.supplies,{'hp-pill':3,'mp-pill':3});assert.equal(b.currentActor,p.id);assert.equal(b.seq,seq);
 b.allies[0].mp=20;const e=game.act(p.id,{type:'item',itemId:'mp-pill',targetId:p.id});assert.equal(b.allies[0].mp,60);assert.equal(e.hits[0].type,'mana');
});
test('each owner receives medicine loot once and medicine rolls do not change equipment rolls',()=>{
 const rolls=[0,0,0,.999,0];let calls=0;const {game,p}=fixture(sword,1,()=>{calls++;return rolls.length?rolls.shift():0;});
 const b=fight(game,p,'tuanzi');b.enemies[0].hp=0;game.settle(b);
 assert.equal(b.result.loot[0].items[0].quality,'legendary');assert.equal(b.result.loot[0].items[0].slot,'weapon');
 assert.deepEqual(b.result.supplies,[{ownerId:p.id,items:[{itemId:'hp-pill',quantity:1}]}]);assert.equal(p.supplies['hp-pill'],4);
 const count=calls;game.settle(b);assert.equal(calls,count);assert.equal(p.supplies['hp-pill'],4);
});
test('unready real party members block direct and walking encounters until ready',()=>{
 const {game,p}=fixture(),guest=game.createPlayer(healer);game.createTeam(p.id);game.joinTeam(guest.id,game.party(p.id).code);
 const members=game.snapshot(p.id).party.members;assert.equal(members.find(m=>m.id===p.id).ready,true);assert.equal(members.find(m=>m.id===guest.id).ready,false);
 assert.throws(()=>game.startEncounter(p.id,'tuanzi'),/准备/);p.x=537;p.y=790;for(const x of [569,601,633])assert.equal(game.move(p.id,x,790),false);
 game.setReady(guest.id,true);for(const x of [601,569,537])game.move(p.id,x,790);assert.ok(game.battleFor(guest.id));
});
test('leadership can transfer only to a real member and the new leader controls encounters',()=>{
 const {game,p}=fixture(),guest=game.createPlayer(healer);game.createTeam(p.id);game.joinTeam(guest.id,game.party(p.id).code);game.addCompanion(p.id,mage);
 assert.equal(game.snapshot(p.id).party.members.find(m=>m.npc).ready,true);
 assert.throws(()=>game.transferLeader(p.id,game.party(p.id).members[2]),/真人/);assert.throws(()=>game.transferLeader(guest.id,p.id),/队长/);
 game.transferLeader(p.id,guest.id);assert.equal(game.party(p.id).leader,guest.id);assert.throws(()=>game.startEncounter(p.id,'tuanzi'),/队长/);
 game.startEncounter(guest.id,'tuanzi');assert.equal(game.battleFor(p.id).controller,guest.id);
});
test('result screens and busy actions prevent character, party, pet and return mutations',()=>{
 const {game,p}=fixture();pet(p,'wolf');game.createTeam(p.id);const b=fight(game,p);b.enemies.forEach(e=>e.hp=0);game.settle(b);
 for(const fn of [()=>game.leaveTeam(p.id),()=>game.equipPet(p.id,null),()=>game.settings(p.id,sword,3),()=>game.setReady(p.id,false),()=>game.renamePet(p.id,'pet-wolf','阿狼')])assert.throws(fn,/战斗|返回地图/);
 b.busy=true;assert.throws(()=>game.finishBattle(p.id),/演出|稍候/);assert.throws(()=>game.retreat(p.id),/演出|稍候/);b.busy=false;game.finishBattle(p.id);assert.equal(game.battleFor(p.id),undefined);
});
test('owned pets can be renamed with at most twelve characters and publish actual stats and abilities',()=>{
 const {game,p}=fixture(),q=pet(p,'monkey'),guest=game.createPlayer(sword);assert.ok(game.snapshot(p.id).player.pets[0].stats);
 assert.throws(()=>game.renamePet(guest.id,q.id,'桃桃'),/宠物/);assert.throws(()=>game.renamePet(p.id,q.id,''),/名字|名称/);assert.throws(()=>game.renamePet(p.id,q.id,'一二三四五六七八九十一二三'),/12/);
 game.renamePet(p.id,q.id,' 灵桃 ');const publicPet=game.snapshot(p.id).player.pets[0];assert.equal(publicPet.name,'灵桃');assert.deepEqual(publicPet.stats,{maxHp:65,atk:19,def:5,speed:23});assert.equal(publicPet.ability.cooldown,3);
 const b=fight(game,p);assert.equal(b.allies[1].name,'灵桃');for(const [key,value] of Object.entries(publicPet.stats))assert.equal(b.allies[1][key],value);
});
test('offensive pet skills use their species multiplier and three-round cooldown',()=>{
 for(const [species,damages] of [['wolf',[18]],['boar',[23]],['monkey',[5,5]]]){
  const {game,p}=fixture(),q=pet(p,species),b=fight(game,p,'boar'),actor=b.allies.find(a=>a.id===q.id),enemy=b.enemies[0];turn(b,q.id);
  const e=game.stepAuto(p.id);assert.equal(e.kind,'pet-skill');assert.equal(e.species,species);assert.deepEqual(e.hits.filter(h=>h.type==='damage').map(h=>h.value),damages);
  turn(b,q.id);assert.equal(game.stepAuto(p.id).kind,'normal');b.round=4;turn(b,q.id);assert.equal(game.stepAuto(p.id).kind,'pet-skill');assert.ok(actor.cooldowns.ability>4);
 }
});
test('tuanzi heals its injured owner and turtle protects its owner without dealing damage',()=>{
 for(const species of ['tuanzi','turtle']){
  const {game,p}=fixture(),q=pet(p,species),b=fight(game,p),hero=b.allies[0];hero.hp=50;turn(b,q.id);const before=b.enemies[0].hp,e=game.stepAuto(p.id);
  assert.equal(e.kind,'pet-skill');assert.deepEqual(e.targets,[p.id]);assert.equal(b.enemies[0].hp,before);
  if(species==='tuanzi')assert.ok(hero.hp>50);else assert.ok(hero.statuses.some(s=>s.type==='protect'));
 }
 const {game,p}=fixture(),q=pet(p,'tuanzi'),b=fight(game,p);turn(b,q.id);assert.equal(game.stepAuto(p.id).kind,'normal');
});
test('NPC and offline hero AI cast unlocked active skills and rage ultimates while online heroes wait',()=>{
 for(const classId of [sword,'saber-hanpoyue','assassin-xieqian',mage,healer]){
  const {game,p}=fixture(classId,3),b=fight(game,p,'boar');assert.equal(game.stepAuto(p.id),null);assert.equal(b.seq,0);
  const e=game.stepAuto(p.id,true);assert.equal(e.kind,'skill');assert.equal(e.skillId,'a');assert.ok(b.allies[0].mp<100);
  game.retreat(p.id);p.level=15;const next=fight(game,p);next.allies[0].rage=100;
  assert.equal(game.stepAuto(p.id,true).skillId,'ultimate');assert.equal(next.allies[0].rage,0);
 }
 const {game,p}=fixture(sword,10);game.createTeam(p.id);game.addCompanion(p.id,healer);const b=fight(game,p);b.allies[0].hp=20;const npc=b.allies.find(a=>a.npc);turn(b,npc.id);
 const e=game.stepAuto(p.id);assert.equal(e.skillId,'b');assert.equal(e.targetId,p.id);assert.ok(b.allies[0].hp>20);
});
test('level ten AI uses an area skill for several enemies and falls back when mana is exhausted',()=>{
 const {game,p}=fixture(sword,10,()=>.999),b=fight(game,p),e=game.stepAuto(p.id,true);assert.equal(e.skillId,'b');assert.equal(e.targets.length,2);
 b.allies[0].mp=0;turn(b,p.id);assert.equal(game.stepAuto(p.id,true).kind,'normal');
});
test('status-only mage skill reports every affected target and its animation duration',()=>{
 const {game,p}=fixture(mage,10,()=>.999),b=fight(game,p),hp=b.enemies.map(e=>e.hp),e=game.act(p.id,{type:'skill',skillId:'b',targetId:b.enemies[0].id});
 assert.equal(e.skillId,'b');assert.equal(e.targetId,b.enemies[0].id);assert.deepEqual(e.targets,b.enemies.map(t=>t.id));assert.equal(e.durationMs,1800);
 assert.deepEqual(b.enemies.map(t=>t.hp),hp);assert.equal(e.hits.length,0);assert.ok(b.enemies.every(t=>t.statuses.some(s=>s.type==='slow')));
});
test('healer ultimate reports full-health beneficiaries receiving regen and protection',()=>{
 const {game,p}=fixture(healer,15);game.createTeam(p.id);game.addCompanion(p.id,sword);const b=fight(game,p);b.allies[0].rage=100;turn(b,p.id);
 const e=game.act(p.id,{type:'skill',skillId:'ultimate',targetId:b.enemies[0].id});assert.equal(e.durationMs,2850);
 for(const ally of b.allies){assert.ok(e.targets.includes(ally.id));assert.ok(ally.statuses.some(s=>s.type==='regen'));assert.ok(ally.statuses.some(s=>s.type==='protect'));}
});
test('healer ultimate damages the selected enemy outside the first three positions',()=>{
 const {game,p}=fixture(healer,15,()=>.999);game.createTeam(p.id);game.addCompanion(p.id,sword);game.addCompanion(p.id,mage);const b=fight(game,p),hero=b.allies[0];assert.equal(b.enemies.length,6);
 for(const enemy of b.enemies)enemy.maxHp=enemy.hp=1000;hero.rage=100;turn(b,p.id);const e=game.act(p.id,{type:'skill',skillId:'ultimate',targetId:b.enemies[4].id});
 assert.equal(e.targetId,b.enemies[4].id);assert.deepEqual(b.enemies.map(enemy=>enemy.hp),[874,874,1000,1000,874,1000]);
 assert.deepEqual(e.hits.filter(hit=>hit.type==='damage').map(hit=>hit.id),[b.enemies[4].id,b.enemies[0].id,b.enemies[1].id]);
 for(const id of e.targets.filter(id=>b.enemies.some(enemy=>enemy.id===id)))assert.ok(e.hits.some(hit=>hit.id===id&&hit.type==='damage'));
});
test('self-applied regeneration and protection last two subsequent turns after the ultimate',()=>{
 const {game,p}=fixture(healer,15),b=fight(game,p),hero=b.allies[0];hero.hp=100;hero.rage=100;
 game.act(p.id,{type:'skill',skillId:'ultimate',targetId:b.enemies[0].id});assert.equal(hero.hp,345);assert.equal(hero.statuses.find(s=>s.type==='regen').rounds,2);
 turn(b,p.id);game.act(p.id,{type:'defend'});assert.equal(hero.hp,391);assert.equal(hero.statuses.find(s=>s.type==='protect').rounds,1);
 turn(b,p.id);game.act(p.id,{type:'defend'});assert.equal(hero.hp,400);assert.ok(!hero.statuses.some(s=>s.type==='regen'||s.type==='protect'));
});
test('party medicines drop into each owner bag and failed or captured fights add none',()=>{
 const {game,p}=fixture(),guest=game.createPlayer(healer);game.createTeam(p.id);game.joinTeam(guest.id,game.party(p.id).code);game.setReady(guest.id,true);
 const b=fight(game,p,'tuanzi');b.enemies.forEach(e=>e.hp=0);game.settle(b);
 assert.equal(b.result.supplies.length,2);for(const member of [p,guest]){const row=b.result.supplies.find(s=>s.ownerId===member.id);assert.deepEqual(row.items,[{itemId:'hp-pill',quantity:2}]);assert.equal(member.supplies['hp-pill'],5);}game.finishBattle(p.id);
 const lost=fight(game,p);lost.allies.forEach(a=>a.hp=0);game.settle(lost);assert.deepEqual(lost.result.supplies,[]);assert.equal(p.supplies['hp-pill'],5);game.finishBattle(p.id);game.leaveTeam(p.id);
 const caught=fight(game,p,'tuanzi');game.act(p.id,{type:'capture',targetId:caught.enemies[0].id});assert.deepEqual(caught.result.supplies,[{ownerId:p.id,items:[]}]);assert.equal(p.supplies['hp-pill'],5);
});
test('triggered normal attack passives are visible in combat events',()=>{
 const {game,p}=fixture(sword,5),b=fight(game,p);b.allies[0].normalCount=2;const e=game.act(p.id,{type:'normal',targetId:b.enemies[0].id});assert.equal(e.passiveTriggered,true);assert.equal(e.durationMs,850);
});
test('world reload restores teams, companions and active battle turns without a stale busy flag',()=>{
 const {game,p}=fixture(),guest=game.createPlayer(healer);game.createTeam(p.id);game.joinTeam(guest.id,game.party(p.id).code);guest.ready=true;game.addCompanion(p.id,mage);
 const b=fight(game,p);b.allies[0].hp=80;game.settle(b);b.busy=true;
 const saved=game.exportPlayers();assert.ok(saved.every(row=>row.teamId===null));const world=game.exportWorld();
 const restored=new Game({savedPlayers:saved,savedWorld:world}),state=restored.snapshot(guest.id);assert.equal(state.party.code,game.party(p.id).code);assert.equal(state.party.members.length,3);
 assert.equal(state.battle.id,b.id);assert.equal(state.battle.currentActor,b.currentActor);assert.equal(state.battle.busy,false);assert.equal(state.party.members.find(m=>m.id===p.id).vitals.hp,80);
 restored.stepAuto(p.id,true);assert.equal(restored.battleFor(p.id).seq,1);
});

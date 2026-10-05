import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,CONFIG} from './rules.mjs';
const nodes={a:[3,12,27],passive:[5,16,30],b:[10,20,33],ultimate:[15,24,36]};
const sword='swordsman-luqinglan',saber='saber-hanpoyue',assassin='assassin-xieqian',mage='mage-suyingyue',healer='healer-shenzhiwei';
function fight(classId,level){
 const game=new Game({rng:()=>0}),player=game.createPlayer(classId);player.level=level;
 game.createTeam(player.id);game.addCompanion(player.id,sword);game.addCompanion(player.id,saber);game.startEncounter(player.id,'monkey');
 const battle=game.battleFor(player.id),actor=battle.allies[0];
 for(const unit of [...battle.allies,...battle.enemies])Object.assign(unit,{hp:10000,maxHp:10000,def:0});
 Object.assign(actor,{atk:100,hp:200,maxHp:1000,mp:100,rage:100});
 battle.currentActor=actor.id;battle.index=battle.queue.indexOf(actor.id);
 return {game,player,battle,actor,target:battle.enemies[0]};
}
function cast(classId,skillId,level){const f=fight(classId,level);const event=f.game.act(f.player.id,{type:'skill',skillId,targetId:f.target.id});return {...f,event};}

for(const character of CONFIG.classes)for(const [id,levels] of Object.entries(nodes))test(character.profession+' '+id+' upgrades on the exact requested levels and never early',()=>{
 const game=new Game(),actor={classId:character.id};
 for(const [level,rank,nextLevel] of [[levels[0]-1,0,levels[0]],[levels[0],1,levels[1]],[levels[1]-1,1,levels[1]],[levels[1],2,levels[2]],[levels[2]-1,2,levels[2]],[levels[2],3,null],[60,3,null]]){
  const skill=game.skill({...actor,level},id);assert.equal(skill.rank,rank,'at level '+level);assert.equal(skill.nextLevel,nextLevel,'next upgrade at level '+level);
 }
});

for(const [classId,expected] of [[sword,[180,216,252]],[saber,[220,264,308]],[assassin,[200,240,280]],[mage,[200,240,280]],[healer,[80,96,112]]])test(classId+' first skill gains power without adding a normal attack or extra cost',()=>{
 for(const [index,level] of [3,12,27].entries()){
  const {event,actor,target}=cast(classId,'a',level);
  assert.equal(event.hits.filter(hit=>hit.id===target.id&&hit.type==='damage').reduce((sum,hit)=>sum+hit.value,0),expected[index]);
  assert.equal(event.skillRank,index+1);assert.equal(actor.mp,classId===mage?78:classId===saber||classId===assassin?80:82);
 }
});

for(const [classId,expected] of [[sword,[130,156,182]],[saber,[150,180,210]],[assassin,[150,180,210]]])test(classId+' third skill upgrades separately at 20 and 33',()=>{
 for(const [index,level] of [10,20,33].entries()){
  const {event,target}=cast(classId,'b',level);
  assert.equal(event.hits.filter(hit=>hit.id===target.id&&hit.type==='damage').reduce((sum,hit)=>sum+hit.value,0),expected[index]);
 }
});
test('mage moon binding upgrades ongoing damage and slow without dealing an immediate hit',()=>{
 for(const [index,level] of [10,20,33].entries()){
  const {game,battle,event,target}=cast(mage,'b',level);
  assert.equal(event.hits.filter(hit=>hit.type==='damage').length,0);
  const originalSpeed=target.speed,roundEvent={targets:[],hits:[]};game.endTurn(battle,target,roundEvent);
  assert.equal(roundEvent.hits.find(hit=>hit.id===target.id).value,[80,96,112][index]);
  assert.equal(game.speed(target),originalSpeed*[.8,.76,.72][index]);
 }
});
test('healer third skill upgrades both healing components and remains a non-damaging action',()=>{
 for(const [index,level] of [10,20,33].entries()){
  const {game,player,battle,actor}=fight(healer,level),target=battle.allies[1];target.hp=100;target.maxHp=1000;
  const event=game.act(player.id,{type:'skill',skillId:'b',targetId:target.id});
  assert.equal(event.hits.find(hit=>hit.id===target.id&&hit.type==='heal').value,[260,312,364][index]);
  assert.equal(event.hits.some(hit=>hit.type==='damage'),false);assert.equal(actor.mp,76);
 }
});
for(const [classId,expected] of [[sword,[450,540,630]],[saber,[280,336,392]],[assassin,[350,420,490]],[mage,[200,240,280]],[healer,[120,144,168]]])test(classId+' ultimate upgrades at 24 and 36 and keeps the 100-rage cost',()=>{
 for(const [index,level] of [15,24,36].entries()){
  const {event,actor,target}=cast(classId,'ultimate',level);
  assert.equal(event.hits.filter(hit=>hit.id===target.id&&hit.type==='damage').reduce((sum,hit)=>sum+hit.value,0),expected[index]);assert.equal(actor.rage,0);assert.equal(actor.mp,100);
 }
});
test('saber shield, armor break and passive mitigation use their own skill ranks',()=>{
 for(const [index,level] of [15,24,36].entries()){const {actor}=cast(saber,'ultimate',level);assert.equal(actor.shield,[200,240,280][index]);}
 for(const [index,level] of [3,12,27].entries()){
  const {game,battle,actor,target,event}=cast(saber,'a',level);target.def=100;game.damage(battle,actor,target,1,event);
  assert.equal(event.hits.at(-1).value,[49,51,53][index]);
 }
 for(const [index,level] of [5,16,30].entries()){
  const {game,battle,actor,target}=fight(saber,level),event={kind:'normal',targets:[],hits:[]};game.damage(battle,{atk:100},actor,1,event);
  assert.equal(event.hits.at(-1).value,[80,76,72][index]);
 }
});
test('all passive upgrades enhance their trigger rather than the normal attack base',()=>{
 for(const [classId,expected] of [[sword,[160,172,184]],[saber,[140,144,148]],[assassin,[140,148,156]],[mage,[160,172,184]],[healer,[80,80,80]]])for(const [index,level] of [5,16,30].entries()){
  const {game,player,actor,target}=fight(classId,level);actor.normalCount=2;actor.empowered=true;target.hp=3000;
  const event=game.act(player.id,{type:'normal',targetId:target.id});assert.equal(event.passiveRank,index+1);
  assert.equal(event.hits.filter(hit=>hit.id===target.id&&hit.type==='damage').reduce((sum,hit)=>sum+hit.value,0),expected[index]);
  if(classId===healer)assert.equal(event.hits.find(hit=>hit.id===actor.id&&hit.type==='heal').value,[30,36,42][index]);
 }
 const f=fight(sword,30);const event=f.game.act(f.player.id,{type:'normal',targetId:f.target.id});assert.equal(event.hits.find(hit=>hit.type==='damage').value,100);assert.equal(event.passiveTriggered,undefined);
});
test('healer ultimate upgrades healing, regeneration and protection together',()=>{
 for(const [index,level] of [15,24,36].entries()){
  const {game,battle,actor,event}=cast(healer,'ultimate',level);
  assert.equal(event.hits.find(hit=>hit.id===actor.id&&hit.type==='heal').value,[280,336,392][index]);
  const roundEvent={targets:[],hits:[]};game.endTurn(battle,actor,roundEvent);assert.equal(roundEvent.hits.find(hit=>hit.type==='heal').value,[40,48,56][index]);
  actor.shield=0;const damageEvent={kind:'normal',targets:[],hits:[]};game.damage(battle,{atk:100},actor,1,damageEvent);assert.equal(damageEvent.hits.at(-1).value,[85,82,79][index]);
 }
});
test('natural leveling activates a new rank and save restore derives it without resetting belongings',()=>{
 const f=fight(sword,26);f.player.xp=579;f.battle.enemies.forEach(enemy=>enemy.hp=0);f.game.settle(f.battle);
 assert.equal(f.player.level,27);assert.equal(f.game.skill(f.player,'a').rank,3);
 const restored=new Game({savedPlayers:f.game.exportPlayers()});assert.equal(restored.skill(restored.player(f.player.id),'a').rank,3);
 assert.deepEqual(restored.player(f.player.id).inventory,f.player.inventory);assert.deepEqual(restored.player(f.player.id).equipment,f.player.equipment);
});
test('trial settings accept all eight upgrade levels up to 36 and reject invalid levels',()=>{
 const game=new Game(),player=game.createPlayer(sword);
 for(const level of [12,16,20,24,27,30,33,36]){game.settings(player.id,sword,level);assert.equal(game.player(player.id).level,level);}
 for(const level of [0,1.5,37])assert.throws(()=>game.settings(player.id,sword,level));
});

test('sword upgraded thrust breaks armor and its third normal grants a sword-intent shield',()=>{
 for(const [level,rate] of [[12,.1],[27,.15]]){const f=cast(sword,'a',level);assert.equal(f.target.statuses.find(s=>s.type==='armor')?.multiplier,rate);}
 for(const [level,shield] of [[16,30],[30,50]]){const f=fight(sword,level);f.actor.normalCount=2;f.game.act(f.player.id,{type:'normal',targetId:f.target.id});assert.equal(f.actor.shield,shield);}
});
test('sword upgraded sweep slows hit enemies and ultimate leaves continuing sword wounds',()=>{
 for(const [level,rate] of [[20,.1],[33,.15]]){const f=cast(sword,'b',level);assert.ok(f.battle.enemies.every(enemy=>enemy.statuses.find(s=>s.type==='slow')?.multiplier===rate));}
 for(const [level,amount] of [[24,20],[36,30]]){const f=cast(sword,'ultimate',level),event={targets:[],hits:[]};f.game.endTurn(f.battle,f.target,event);assert.equal(event.hits[0].value,amount);}
});
test('saber upgraded attacks give protection while its passive gives a small self heal',()=>{
 for(const [level,shield] of [[12,50],[27,100]])assert.equal(cast(saber,'a',level).actor.shield,shield);
 for(const [level,amount] of [[16,10],[30,20]]){const f=fight(saber,level),event=f.game.act(f.player.id,{type:'normal',targetId:f.target.id});assert.equal(event.hits.find(hit=>hit.id===f.actor.id&&hit.type==='heal')?.value,amount);}
 for(const [level,rate] of [[20,.1],[33,.15]]){const f=cast(saber,'b',level);assert.ok(f.battle.enemies.every(enemy=>enemy.statuses.find(s=>s.type==='armor')?.multiplier===rate));}
 for(const [level,rate] of [[24,.05],[36,.1]])assert.equal(cast(saber,'ultimate',level).actor.statuses.find(s=>s.type==='protect')?.multiplier,rate);
});
test('assassin gains pursuit slow, weak-point rage and a post-ultimate stealth window',()=>{
 for(const [level,rate] of [[12,.1],[27,.15]])assert.equal(cast(assassin,'a',level).target.statuses.find(s=>s.type==='slow')?.multiplier,rate);
 for(const [level,rage] of [[16,25],[30,30]]){const f=fight(assassin,level);f.actor.rage=0;f.target.hp=3000;f.game.act(f.player.id,{type:'normal',targetId:f.target.id});assert.equal(f.actor.rage,rage);}
 for(const [level,rate] of [[20,.1],[33,.15]])assert.equal(cast(assassin,'b',level).target.statuses.find(s=>s.type==='armor')?.multiplier,rate);
 for(const level of [24,36]){const f=cast(assassin,'ultimate',level);assert.equal(f.actor.stealth,true);assert.equal(f.actor.shield||0,level===36?50:0);}
});
test('mage upgrades add burn, mana recovery, binding armor break and meteor slow',()=>{
 for(const [level,amount] of [[12,20],[27,30]]){const f=cast(mage,'a',level),event={targets:[],hits:[]};f.game.endTurn(f.battle,f.target,event);assert.equal(event.hits[0]?.value,amount);assert.equal(f.battle.enemies[1].statuses.some(s=>s.type==='dot'),false);}
 for(const [level,mana] of [[16,43],[30,46]]){const f=fight(mage,level);f.actor.mp=40;f.actor.empowered=true;f.game.act(f.player.id,{type:'normal',targetId:f.target.id});assert.equal(f.actor.mp,mana);}
 for(const [level,rate] of [[20,.1],[33,.15]]){const f=cast(mage,'b',level);assert.ok(f.battle.enemies.every(enemy=>enemy.statuses.find(s=>s.type==='armor')?.multiplier===rate));}
 for(const [level,rate] of [[24,.1],[36,.15]]){const f=cast(mage,'ultimate',level);assert.ok(f.battle.enemies.every(enemy=>enemy.statuses.find(s=>s.type==='slow')?.multiplier===rate));}
});
test('healer upgrades add herb slow, passive mana, protective treatment and lotus shields',()=>{
 for(const [level,rate] of [[12,.1],[27,.15]])assert.equal(cast(healer,'a',level).target.statuses.find(s=>s.type==='slow')?.multiplier,rate);
 for(const [level,mana] of [[16,43],[30,46]]){const f=fight(healer,level);f.actor.mp=40;f.actor.normalCount=2;f.game.act(f.player.id,{type:'normal',targetId:f.target.id});assert.equal(f.actor.mp,mana);}
 for(const [level,rate] of [[20,.05],[33,.1]]){const f=fight(healer,level);f.game.act(f.player.id,{type:'skill',skillId:'b',targetId:f.actor.id});assert.equal(f.actor.statuses.find(s=>s.type==='protect')?.multiplier,rate);}
 for(const [level,shield] of [[24,50],[36,80]])assert.equal(cast(healer,'ultimate',level).actor.shield,shield);
});
test('new bonuses respect the passive trigger and stronger protection is not weakened',()=>{
 const f=fight(sword,16);f.game.act(f.player.id,{type:'normal',targetId:f.target.id});assert.equal(f.actor.shield||0,0);
 const h=fight(healer,33);h.game.status(h.actor,'protect',2,h.actor,.21);h.game.act(h.player.id,{type:'skill',skillId:'b',targetId:h.actor.id});assert.equal(h.actor.statuses.find(s=>s.type==='protect').multiplier,.21);
});
test('upgraded passive shield preserves a stronger existing shield and its duration',()=>{
 const f=fight(sword,30);f.actor.shield=200;f.game.status(f.actor,'shield',3,f.actor);f.actor.normalCount=2;
 f.game.act(f.player.id,{type:'normal',targetId:f.target.id});
 assert.equal(f.actor.shield,200);assert.equal(f.actor.statuses.find(s=>s.type==='shield').rounds,3);
});

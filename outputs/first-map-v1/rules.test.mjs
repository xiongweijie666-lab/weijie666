import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,CONFIG} from './rules.mjs';
const sword='swordsman-luqinglan',doctor='healer-shenzhiwei';
function fixture(rng=()=>0){const game=new Game({rng});const player=game.createPlayer(sword);return {game,player};}
function nextHuman(game,id){for(let i=0;i<40;i++){const state=game.snapshot(id);if(state.battle.status!=='active'||state.battle.currentActor===id)return;game.stepAuto(id);}throw new Error('No next human turn');}

function walkRegion(game,player,zoneId='tuanzi'){
 const zone=CONFIG.zones.find(z=>z.id===zoneId);player.x=zone.center[0]-48;player.y=zone.center[1];
 for(const offset of [-16,16,48])game.move(player.id,zone.center[0]+offset,zone.center[1]);
}
test('safe roads and standing still never start an encounter',()=>{
 const {game,player}=fixture();for(let i=0;i<10;i++)game.move(player.id,245+i*3,825);
 assert.equal(game.battleFor(player.id),undefined);player.x=585;player.y=790;
 for(let i=0;i<20;i++)game.move(player.id,585,790);assert.equal(game.battleFor(player.id),undefined);
});
test('walking in each region randomly encounters its own species and level',()=>{
 for(const zone of CONFIG.zones){const {game,player}=fixture();walkRegion(game,player,zone.id);
  const battle=game.battleFor(player.id);assert.ok(battle);assert.equal(battle.zone,zone.id);
  assert.equal(battle.enemies.length,1);assert.equal(battle.enemies[0].level,zone.level);
 }
});
test('encounter rolls can fail and only walking allows the next roll',()=>{
 let roll=.9;const {game,player}=fixture(()=>roll);walkRegion(game,player);
 assert.equal(game.battleFor(player.id),undefined);roll=0;
 for(let i=0;i<20;i++)game.move(player.id,633,790);assert.equal(game.battleFor(player.id),undefined);
 for(const x of [601,569,537])game.move(player.id,x,790);assert.ok(game.battleFor(player.id));
});
test('only party leader movement starts a shared encounter',()=>{
 const {game,player}=fixture();const guest=game.createPlayer(doctor);game.createTeam(player.id);game.joinTeam(guest.id,game.party(player.id).code);
 game.setReady(guest.id,true);
 walkRegion(game,guest);assert.equal(game.battleFor(player.id),undefined);walkRegion(game,player);
 assert.equal(game.snapshot(guest.id).battle.id,game.snapshot(player.id).battle.id);
 assert.equal(game.snapshot(player.id).battle.enemies.length,2);
});
test('random encounters retain baby and mutant rolls and full-party ten-monster cap',()=>{
 for(const [qualityRoll,expected] of [[.8,'baby'],[.99,'mutant']]){
  const rolls=[0,qualityRoll,.999],{game,player}=fixture(()=>rolls.length?rolls.shift():0);
  game.createTeam(player.id);for(let i=0;i<4;i++)game.addCompanion(player.id,doctor);walkRegion(game,player);
  assert.equal(game.battleFor(player.id).enemies.length,10);assert.equal(game.battleFor(player.id).enemies[0].rarity,expected);
 }
});
test('leaving the region clears accumulated encounter distance',()=>{
 const {game,player}=fixture();player.x=585;player.y=790;game.move(player.id,617,790);game.move(player.id,649,790);
 game.move(player.id,245,825);game.move(player.id,585,790);game.move(player.id,617,790);assert.equal(game.battleFor(player.id),undefined);
});
test('returning from battle grants a walking buffer before another encounter',()=>{
 const {game,player}=fixture();walkRegion(game,player);const enemy=game.battleFor(player.id).enemies[0];
 game.act(player.id,{type:'capture',targetId:enemy.id});game.finishBattle(player.id);
 for(const x of [601,569,537,569,601])game.move(player.id,x,790);
 assert.equal(game.battleFor(player.id),undefined);
 for(const x of [633,601,569])game.move(player.id,x,790);assert.ok(game.battleFor(player.id));
});

test('five fixed encounter regions and three qualities',()=>{
  assert.deepEqual(CONFIG.zones.map(z=>z.level),[1,3,6,10,15]);
  assert.deepEqual(CONFIG.zones.map(z=>z.name),['团子','乌龟','狼','野猪','猴子']);
  assert.deepEqual(Object.keys(CONFIG.rarities),['normal','baby','mutant']);
});
test('party caps at five including real players; repeat joining is idempotent',()=>{
  const {game,player}=fixture();game.createTeam(player.id);const code=game.snapshot(player.id).party.code;
  for(let i=0;i<4;i++){const guest=game.createPlayer(sword);game.joinTeam(guest.id,code);game.joinTeam(guest.id,code);}
  assert.equal(game.snapshot(player.id).party.members.length,5);
  const extra=game.createPlayer(sword);assert.throws(()=>game.joinTeam(extra.id,code),/5|满/);
  assert.equal(game.snapshot(extra.id).party,null);
});
test('NPC companions also count toward the five seats',()=>{
  const {game,player}=fixture();game.createTeam(player.id);for(let i=0;i<4;i++)game.addCompanion(player.id,doctor);
  assert.throws(()=>game.addCompanion(player.id,doctor),/5|满/);
});
test('solo encounter contains exactly one or two enemies',()=>{
  for(const [random,expected] of [[0,1],[.999,2]]){
    const {game,player}=fixture(()=>random);game.startEncounter(player.id,'tuanzi','normal');
    assert.equal(game.snapshot(player.id).battle.enemies.length,expected);
  }
});
test('two to five heroes scale to their own count through twice that count, at most ten',()=>{
  for(let size=2;size<=5;size++)for(const [random,expected] of [[0,size],[.999,size*2]]){
    const {game,player}=fixture(()=>random);game.createTeam(player.id);for(let i=1;i<size;i++)game.addCompanion(player.id,doctor);
    game.startEncounter(player.id,'wolf','normal');assert.equal(game.snapshot(player.id).battle.enemies.length,expected);
  }
});
test('a successful capture removes the enemy and persists one owned equipped pet',()=>{
  const {game,player}=fixture();game.startEncounter(player.id,'tuanzi','baby');
  const target=game.snapshot(player.id).battle.enemies[0].id;game.act(player.id,{type:'capture',targetId:target});
  const state=game.snapshot(player.id);assert.equal(state.player.pets.length,1);assert.equal(state.player.pets[0].rarity,'baby');
  assert.equal(state.player.equippedPet,state.player.pets[0].id);assert.equal(state.battle.enemies[0].captured,true);
  assert.throws(()=>game.act(player.id,{type:'capture',targetId:target}),/结束|目标|回合/);
  assert.equal(game.snapshot(player.id).player.pets.length,1);
  const restored=new Game({savedPlayers:game.exportPlayers()});assert.equal(restored.snapshot(player.id).player.pets.length,1);
});
test('capture can fail and still consumes a turn without creating a pet',()=>{
  const {game,player}=fixture(()=>.999);game.startEncounter(player.id,'tuanzi','mutant');
  game.act(player.id,{type:'capture',targetId:game.snapshot(player.id).battle.enemies[0].id});
  assert.equal(game.snapshot(player.id).player.pets.length,0);assert.notEqual(game.snapshot(player.id).battle.currentActor,player.id);
});
test('a captured pet participates next battle without increasing enemy scaling',()=>{
  const {game,player}=fixture();game.startEncounter(player.id,'tuanzi','baby');game.act(player.id,{type:'capture',targetId:game.snapshot(player.id).battle.enemies[0].id});
  game.finishBattle(player.id);game.startEncounter(player.id,'turtle','normal');
  const state=game.snapshot(player.id);assert.equal(state.battle.allies.filter(a=>a.kind==='pet').length,1);assert.equal(state.battle.enemies.length,1);
  game.act(player.id,{type:'defend'});game.stepAuto(player.id);
  assert.ok(game.snapshot(player.id).battle.enemies[0].hp<state.battle.enemies[0].hp);
});
test('foreign pets and friendly capture targets are rejected without spending a turn',()=>{
  const {game,player}=fixture();const other=game.createPlayer(doctor);assert.throws(()=>game.equipPet(other.id,'foreign'),/宠物|归属/);
  game.startEncounter(player.id,'tuanzi','normal');assert.throws(()=>game.act(player.id,{type:'capture',targetId:player.id}),/目标|敌/);
  assert.equal(game.snapshot(player.id).battle.currentActor,player.id);
});
test('skill one unlocks at character level three and rejection does not spend mana',()=>{
  const {game,player}=fixture();player.level=2;game.startEncounter(player.id,'boar','normal');const target=game.snapshot(player.id).battle.enemies[0].id;
  const mana=game.snapshot(player.id).battle.allies[0].mp;
  assert.throws(()=>game.act(player.id,{type:'skill',skillId:'a',targetId:target}),/3级|解锁/);assert.equal(game.snapshot(player.id).battle.allies[0].mp,mana);
  player.level=3;game.snapshot(player.id);game.retreat(player.id);game.startEncounter(player.id,'boar','normal');
  game.act(player.id,{type:'skill',skillId:'a',targetId:game.snapshot(player.id).battle.enemies[0].id});assert.equal(game.snapshot(player.id).battle.allies[0].mp,mana-18);
});
test('ultimate needs both level fifteen and one hundred rage',()=>{
  const {game,player}=fixture();player.level=14;game.startEncounter(player.id,'monkey','normal');
  let battle=game.battleFor(player.id);battle.allies[0].rage=100;
  assert.throws(()=>game.act(player.id,{type:'skill',skillId:'ultimate',targetId:battle.enemies[0].id}),/15级|解锁/);
  game.retreat(player.id);player.level=15;game.startEncounter(player.id,'monkey','normal');battle=game.battleFor(player.id);battle.allies[0].rage=99;
  assert.throws(()=>game.act(player.id,{type:'skill',skillId:'ultimate',targetId:battle.enemies[0].id}),/怒气/);
  battle.allies[0].rage=100;game.act(player.id,{type:'skill',skillId:'ultimate',targetId:battle.enemies[0].id});assert.equal(battle.allies[0].rage,0);
});
test('party composition cannot change during an active shared fight',()=>{
  const {game,player}=fixture();game.createTeam(player.id);game.addCompanion(player.id,doctor);game.startEncounter(player.id,'tuanzi','normal');
  assert.throws(()=>game.leaveTeam(player.id),/战斗/);assert.throws(()=>game.addCompanion(player.id,doctor),/战斗/);
});
test('doctor healing spends mana, restores an ally and inflicts no enemy damage',()=>{
 const game=new Game({rng:()=>0}),player=game.createPlayer(doctor);player.level=10;game.startEncounter(player.id,'boar','normal');
 const battle=game.battleFor(player.id),hero=battle.allies[0];hero.hp=80;const enemyHp=battle.enemies[0].hp;
 game.act(player.id,{type:'skill',skillId:'b',targetId:hero.id});assert.ok(hero.hp>80);assert.equal(battle.enemies[0].hp,enemyHp);assert.equal(hero.mp,76);
});
test('mage primary target does not also receive splash damage',()=>{
 const game=new Game({rng:()=>.999}),player=game.createPlayer('mage-suyingyue');player.level=3;game.startEncounter(player.id,'boar','normal');
 const battle=game.battleFor(player.id),target=battle.enemies[0],other=battle.enemies[1],before=target.hp;
 const event=game.act(player.id,{type:'skill',skillId:'a',targetId:target.id});assert.equal(event.hits.filter(h=>h.id===target.id).length,1);assert.ok(before-target.hp>0);assert.ok(other.hp<other.maxHp);
});
test('third-attack passive stays inactive below five and activates from five',()=>{
 for(const [level,bonus] of [[4,0],[5,.6]]){
  const {game,player}=fixture();player.level=level;game.startEncounter(player.id,'boar','normal');const battle=game.battleFor(player.id),hero=battle.allies[0],target=battle.enemies[0];target.maxHp=target.hp=1000;
  for(let i=0;i<2;i++){game.act(player.id,{type:'normal',targetId:target.id});nextHuman(game,player.id);}
  const before=target.hp;game.act(player.id,{type:'normal',targetId:target.id});assert.equal(before-target.hp,Math.round(hero.atk*(1+bonus)-target.def*.6));
 }
});

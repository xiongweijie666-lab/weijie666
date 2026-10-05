import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,CONFIG} from './rules.mjs';
const sword='swordsman-luqinglan',doctor='healer-shenzhiwei';
function fixture(rng=()=>0){const game=new Game({rng}),player=game.createPlayer(sword);return {game,player};}
function item(player,slot){return player.inventory.find(i=>i.slot===slot);}
function win(game,player,species='tuanzi',rarity='normal'){
 game.startEncounter(player.id,species,rarity);const battle=game.battleFor(player.id);
 for(const enemy of battle.enemies)enemy.hp=0;game.settle(battle);return battle;
}
test('new heroes receive six unique unequipped starter items with role-specific weapons',()=>{
 for(const role of CONFIG.classes){const game=new Game(),p=game.createPlayer(role.id);
  assert.equal(p.inventory.length,6);assert.equal(new Set(p.inventory.map(i=>i.id)).size,6);
  assert.equal(new Set(p.inventory.map(i=>i.slot)).size,6);assert.equal(item(p,'weapon').classId,role.id);
  assert.equal(Object.values(p.equipment).filter(Boolean).length,0);
 }
});
test('wearing and removing gear changes exactly its own stats without duplicating items',()=>{
 const {game,player}=fixture(),base=game.snapshot(player.id).player.stats,weapon=item(player,'weapon');
 game.equipEquipment(player.id,weapon.id);assert.equal(player.equipment.weapon,weapon.id);
 assert.equal(game.snapshot(player.id).player.stats.atk,base.atk+weapon.stats.atk);
 game.equipEquipment(player.id,weapon.id);assert.equal(player.inventory.length,6);
 game.unequipEquipment(player.id,'weapon');assert.deepEqual(game.snapshot(player.id).player.stats,base);
});
test('all six slots can be equipped individually for every profession',()=>{
 for(const role of CONFIG.classes){const game=new Game(),p=game.createPlayer(role.id),base=game.snapshot(p.id).player.stats,expected={...base};
  for(const item of p.inventory){game.equipEquipment(p.id,item.id);for(const [key,value] of Object.entries(item.stats))expected[key]+=value;assert.deepEqual(game.snapshot(p.id).player.stats,expected);}
  assert.equal(Object.values(p.equipment).filter(Boolean).length,6);
 }
});
test('replacing an item returns the old item to the bag and avoids stacking both bonuses',()=>{
 const {game,player}=fixture();win(game,player);game.finishBattle(player.id);
 const old=item(player,'weapon'),newer=player.inventory.find(i=>i.slot==='weapon'&&i.id!==old.id);
 assert.ok(newer);game.equipEquipment(player.id,old.id);game.equipEquipment(player.id,newer.id);
 assert.equal(player.equipment.weapon,newer.id);assert.ok(player.inventory.some(i=>i.id===old.id));
 assert.equal(game.snapshot(player.id).player.stats.atk,30+newer.stats.atk);
});
test('foreign, forged and wrong-class items cannot be equipped',()=>{
 const {game,player}=fixture(),other=game.createPlayer(doctor);assert.throws(()=>game.equipEquipment(player.id,item(other,'weapon').id));
 assert.throws(()=>game.equipEquipment(player.id,{id:'forged',stats:{atk:999999}}));
 const wrong={...item(other,'weapon'),id:'wrong-class'};player.inventory.push(wrong);assert.throws(()=>game.equipEquipment(player.id,wrong.id),/职业|医师/);
 assert.equal(player.equipment.weapon,null);
});
test('level requirements reject higher gear until the hero reaches its level',()=>{
 const {game,player}=fixture();const battle=win(game,player,'monkey');game.finishBattle(player.id);
 const gear=battle.result.loot.find(l=>l.ownerId===player.id).items[0];assert.equal(gear.level,15);
 assert.throws(()=>game.equipEquipment(player.id,gear.id),/15级/);player.level=15;
 game.equipEquipment(player.id,gear.id);assert.equal(player.equipment[gear.slot],gear.id);
});
test('class or level changes keep the bag and remove incompatible worn items',()=>{
 const {game,player}=fixture();game.equipEquipment(player.id,item(player,'weapon').id);
 game.settings(player.id,doctor,15);assert.equal(player.equipment.weapon,null);assert.ok(player.inventory.some(i=>i.classId===sword));
 assert.ok(player.inventory.some(i=>i.classId===doctor));const before=player.inventory.length;
 game.settings(player.id,sword,15);game.settings(player.id,doctor,15);assert.equal(player.inventory.length,before);
 const b=win(game,player,'monkey');game.finishBattle(player.id);const gear=b.result.loot.find(l=>l.ownerId===player.id).items[0];
 game.equipEquipment(player.id,gear.id);game.settings(player.id,doctor,1);assert.equal(player.equipment[gear.slot],null);assert.ok(player.inventory.some(i=>i.id===gear.id));
});
test('best gear uses compatible unlocked items and skips stronger locked ones',()=>{
 const {game,player}=fixture();const b=win(game,player,'monkey');game.finishBattle(player.id);const locked=b.result.loot.find(l=>l.ownerId===player.id).items[0];
 game.autoEquipment(player.id);assert.equal(Object.values(player.equipment).filter(Boolean).length,6);assert.notEqual(player.equipment.weapon,locked.id);
 player.level=15;game.autoEquipment(player.id);assert.equal(player.equipment.weapon,locked.id);
});
test('equipment changes are blocked throughout a battle including the result screen',()=>{
 const {game,player}=fixture(),weapon=item(player,'weapon');game.startEncounter(player.id,'tuanzi');
 assert.throws(()=>game.equipEquipment(player.id,weapon.id),/战斗|地图/);assert.throws(()=>game.unequipEquipment(player.id,'weapon'));assert.throws(()=>game.autoEquipment(player.id));
 const b=game.battleFor(player.id);for(const enemy of b.enemies)enemy.hp=0;game.settle(b);
 assert.throws(()=>game.equipEquipment(player.id,weapon.id));game.finishBattle(player.id);game.equipEquipment(player.id,weapon.id);
});
test('worn gear affects actual damage, health, mana and turn order',()=>{
 const {game,player}=fixture();player.level=3;game.autoEquipment(player.id);const stats=game.snapshot(player.id).player.stats;
 game.startEncounter(player.id,'boar');const b=game.battleFor(player.id),hero=b.allies[0],enemy=b.enemies[0];
 assert.equal(hero.hp,stats.maxHp);assert.equal(hero.mp,stats.maxMp);assert.equal(hero.maxMp,stats.maxMp);assert.equal(hero.speed,stats.speed);
 const hp=enemy.hp;game.act(player.id,{type:'normal',targetId:enemy.id});assert.equal(hp-enemy.hp,Math.round(stats.atk-enemy.def*.6));
});
test('healer weapon increases healing through the actual skill calculation',()=>{
 const game=new Game({rng:()=>0}),p=game.createPlayer(doctor);p.level=10;game.equipEquipment(p.id,item(p,'weapon').id);
 game.startEncounter(p.id,'boar');const b=game.battleFor(p.id),hero=b.allies[0];hero.hp=1;const expected=Math.round(hero.atk*1.8+hero.maxHp*.08);
 game.act(p.id,{type:'skill',skillId:'b',targetId:hero.id});assert.equal(hero.hp,1+expected);
});
test('each party member owns separate drops and settlement is idempotent',()=>{
 const {game,player}=fixture(),guest=game.createPlayer(doctor);game.createTeam(player.id);game.joinTeam(guest.id,game.party(player.id).code);
 game.setReady(guest.id,true);
 const b=win(game,player,'wolf');assert.equal(b.result.loot.length,2);
 const first=b.result.loot.find(l=>l.ownerId===player.id),second=b.result.loot.find(l=>l.ownerId===guest.id);
 assert.ok(first.items.length>0);assert.ok(second.items.length>0);assert.notEqual(first.items[0].id,second.items[0].id);
 assert.ok(player.inventory.some(i=>i.id===first.items[0].id));assert.ok(!player.inventory.some(i=>i.id===second.items[0].id));
 assert.equal(first.items[0].classId,sword);assert.equal(second.items[0].classId,doctor);
 const length=player.inventory.length,xp=player.xp;game.settle(b);assert.equal(player.inventory.length,length);assert.equal(player.xp,xp);
});
test('captured monsters and defeats grant no equipment',()=>{
 const {game,player}=fixture();game.startEncounter(player.id,'tuanzi','baby');game.act(player.id,{type:'capture',targetId:game.battleFor(player.id).enemies[0].id});
 assert.equal(player.inventory.length,6);assert.ok(game.battleFor(player.id).result.loot.every(l=>l.items.length===0));game.finishBattle(player.id);
 game.startEncounter(player.id,'monkey');const b=game.battleFor(player.id);for(const hero of b.allies)hero.hp=0;game.settle(b);assert.equal(player.inventory.length,6);
});
test('drops can fail and quality rolls can produce legendary items',()=>{
 const {game,player}=fixture(()=>.999);win(game,player);assert.equal(player.inventory.length,6);
 const rolls=[0,0,0,.999],f=fixture(()=>rolls.length?rolls.shift():0);const b=win(f.game,f.player);
 assert.equal(b.result.loot[0].items[0].quality,'legendary');assert.ok(b.result.loot[0].items[0].stats.atk>item(f.player,'weapon').stats.atk);
});
test('equipment and bonuses survive reload while old saves receive a kit only once',()=>{
 const {game,player}=fixture();game.autoEquipment(player.id);const expected=game.snapshot(player.id).player.stats;
 const restored=new Game({savedPlayers:game.exportPlayers()});assert.deepEqual(restored.snapshot(player.id).player.stats,expected);assert.equal(restored.player(player.id).inventory.length,6);
 const old={...player};delete old.inventory;delete old.equipment;const migrated=new Game({savedPlayers:[old]});assert.equal(migrated.player(player.id).inventory.length,6);
 const twice=new Game({savedPlayers:migrated.exportPlayers()});assert.equal(twice.player(player.id).inventory.length,6);assert.equal(twice.player(player.id).pets.length,player.pets.length);
});

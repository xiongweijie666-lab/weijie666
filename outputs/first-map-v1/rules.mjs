import fs from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import {actionDuration} from './combat-art.mjs';
import {resolveSkill} from './skill-growth.mjs';
export const CONFIG=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
export const EQUIPMENT=JSON.parse(fs.readFileSync(new URL('./equipment.json',import.meta.url),'utf8'));
export const ITEMS=JSON.parse(fs.readFileSync(new URL('./items.json',import.meta.url),'utf8'));
export const PET_SKILLS=JSON.parse(fs.readFileSync(new URL('./pet-skills.json',import.meta.url),'utf8'));
const skillData=JSON.parse(fs.readFileSync(new URL('../character-animation-v3/skills.json',import.meta.url),'utf8'));
const copy=value=>structuredClone(value),alive=u=>u.hp>0&&!u.captured;
const needXp=level=>60+level*20;
function requireRule(ok,message){if(!ok)throw new Error(message);}
function baseStats(p){return {maxHp:145+p.level*17,maxMp:100,atk:24+p.level*6,def:6+p.level*2,speed:CONFIG.classes.find(c=>c.id===p.classId).speed+p.level};}
function canWear(p,item){return item.level<=p.level&&(!item.classId||item.classId===p.classId);}
function equipmentBonus(p){
 const bonus={maxHp:0,maxMp:0,atk:0,def:0,speed:0};
 for(const slot of EQUIPMENT.slots){const item=p.inventory.find(i=>i.id===p.equipment[slot.id]&&i.slot===slot.id);if(item&&canWear(p,item))for(const key of Object.keys(bonus))bonus[key]+=item.stats[key]||0;}
 return bonus;
}
function stats(p){const base=baseStats(p),bonus=equipmentBonus(p);return Object.fromEntries(Object.keys(base).map(key=>[key,base[key]+bonus[key]]));}
function makeEquipment(classId,slotId,level=1,qualityId='common',origin='starter'){
 const slot=EQUIPMENT.slots.find(s=>s.id===slotId),tier=EQUIPMENT.levels.indexOf(level),quality=EQUIPMENT.qualities.find(q=>q.id===qualityId),weapon=slotId==='weapon'?EQUIPMENT.weapons[classId]:null;
 return {id:randomUUID(),slot:slotId,level,quality:qualityId,name:(weapon||slot).names[tier],icon:weapon?.icon||slotId,stats:{[slot.stat]:Math.round(slot.values[tier]*quality.multiplier)},origin,...(weapon?{classId}:{})};
}
function prepareEquipment(p){
 if(!p.inventory)p.inventory=EQUIPMENT.slots.map(s=>makeEquipment(p.classId,s.id));
 p.equipment={...Object.fromEntries(EQUIPMENT.slots.map(s=>[s.id,null])),...p.equipment};
 for(const slot of EQUIPMENT.slots){const item=p.inventory.find(i=>i.id===p.equipment[slot.id]&&i.slot===slot.id);if(!item||!canWear(p,item))p.equipment[slot.id]=null;}
}
function prepareVitals(p){
 const effective=stats(p);
 if(!p.vitals)p.vitals={hp:effective.maxHp,mp:effective.maxMp,maxHp:effective.maxHp,maxMp:effective.maxMp};
 if(!p.vitalDeficits)p.vitalDeficits={hp:Math.max(0,p.vitals.maxHp-p.vitals.hp),mp:Math.max(0,p.vitals.maxMp-p.vitals.mp)};
 for(const [resource,maximum] of [['hp','maxHp'],['mp','maxMp']])if(p.vitals[maximum]!==effective[maximum]){p.vitals[maximum]=effective[maximum];p.vitals[resource]=Math.max(0,effective[maximum]-p.vitalDeficits[resource]);}
 return p.vitals;
}
function preparePlayer(p){prepareEquipment(p);p.supplies={...Object.fromEntries(ITEMS.map(item=>[item.id,3])),...p.supplies};p.ready=p.ready??true;prepareVitals(p);}
function petStats(pet){const quality=CONFIG.rarities[pet.rarity];return {maxHp:Math.round((55+pet.level*10)*quality.growth),atk:Math.round((15+pet.level*4)*quality.growth),def:4+pet.level,speed:22+pet.level};}
function petName(pet){return pet.name||CONFIG.rarities[pet.rarity].name+CONFIG.zones.find(zone=>zone.id===pet.species).name;}

export class Game{
 constructor({rng=Math.random,savedPlayers=[],savedWorld=null}={}){
  this.rng=rng;this.players=new Map();this.teams=new Map();this.battles=new Map();this.travel=new Map();
  for(const saved of savedPlayers){const p={...copy(saved),teamId:null,npc:false};preparePlayer(p);this.players.set(p.id,p);}
  for(const saved of savedWorld?.npcs||[]){const p={...copy(saved),teamId:null,npc:true};preparePlayer(p);this.players.set(p.id,p);}
  for(const saved of savedWorld?.teams||[]){const team=copy(saved);team.members=team.members.filter(id=>this.players.has(id));if(!team.members.length||!team.members.includes(team.leader))continue;this.teams.set(team.code,team);for(const id of team.members)this.player(id).teamId=team.code;}
  for(const [key,saved] of savedWorld?.battles||[])if(this.players.has(key)||this.teams.has(key)){const battle=copy(saved);battle.busy=false;this.battles.set(key,battle);}
 }
 player(id){const p=this.players.get(id);requireRule(p,'人物不存在');return p;}
 createPlayer(classId){
  requireRule(CONFIG.classes.some(c=>c.id===classId),'职业不存在');
  const p={id:randomUUID(),classId,level:1,xp:0,pets:[],equippedPet:null,x:CONFIG.world.spawn[0],y:CONFIG.world.spawn[1],teamId:null,npc:false};
  preparePlayer(p);this.players.set(p.id,p);return p;
 }
 key(id){return this.player(id).teamId||id;}
 battleFor(id){return this.battles.get(this.key(id));}
 requirePeace(id){requireRule(!this.battleFor(id),'战斗中不能调整，请先返回地图');}
 party(id){const p=this.player(id);return p.teamId?this.teams.get(p.teamId):null;}
 leader(id){const team=this.party(id);requireRule(!team||team.leader===id,'请由队长操作');}
 members(id){return this.party(id)?.members.map(mid=>this.player(mid))||[this.player(id)];}
 createTeam(id){this.requirePeace(id);requireRule(!this.party(id),'已经有队伍');const code=randomBytes(3).toString('hex').toUpperCase();this.teams.set(code,{code,leader:id,members:[id]});this.player(id).teamId=code;this.player(id).ready=true;}
 joinTeam(id,code){
  this.requirePeace(id);const team=this.teams.get(String(code).trim().toUpperCase());requireRule(team,'队伍不存在，请核对房号');
  if(team.members.includes(id))return;
  requireRule(!this.party(id),'请先离开当前队伍');requireRule(!this.battles.has(team.code),'队伍正在战斗，请结束后加入');
  requireRule(team.members.length<5,'队伍已满，上限5人');team.members.push(id);this.player(id).teamId=team.code;this.player(id).ready=false;
 }
 setReady(id,ready){this.requirePeace(id);requireRule(this.party(id),'请先加入队伍');requireRule(typeof ready==='boolean','准备状态无效');this.player(id).ready=ready;}
 transferLeader(id,memberId){this.requirePeace(id);this.leader(id);const team=this.party(id);requireRule(team&&team.members.includes(memberId)&&!this.player(memberId).npc,'请选一名队内真人队友');team.leader=memberId;this.player(memberId).ready=true;}
 allReady(id){return this.members(id).every(p=>p.ready);}
 addCompanion(id,classId){
  this.requirePeace(id);this.leader(id);const team=this.party(id);requireRule(team,'请先创建队伍');requireRule(team.members.length<5,'队伍已满，上限5人');
  const npc=this.createPlayer(classId);npc.npc=true;npc.level=this.player(id).level;npc.teamId=team.code;prepareVitals(npc);team.members.push(npc.id);
 }
 removeMember(id,memberId){
  this.requirePeace(id);this.leader(id);const team=this.party(id);requireRule(team&&memberId!==id&&team.members.includes(memberId),'队友不存在');
  const member=this.player(memberId);team.members=team.members.filter(mid=>mid!==memberId);member.teamId=null;member.ready=true;if(member.npc)this.players.delete(memberId);
 }
 leaveTeam(id){
  this.requirePeace(id);const team=this.party(id);if(!team)return;
  if(team.leader===id){for(const mid of team.members){this.player(mid).teamId=null;this.player(mid).ready=true;if(this.player(mid).npc)this.players.delete(mid);}this.teams.delete(team.code);this.battles.delete(team.code);}
  else{team.members=team.members.filter(mid=>mid!==id);this.player(id).teamId=null;this.player(id).ready=true;}
 }
 settings(id,classId,level){
  this.requirePeace(id);requireRule(CONFIG.classes.some(c=>c.id===classId)&&Number.isInteger(level)&&level>=1&&level<=skillData.trialMaxLevel,'试玩等级需为1—'+skillData.trialMaxLevel+'级');
  const p=this.player(id);p.classId=classId;p.level=level;p.xp=0;
  if(!p.inventory.some(i=>i.origin==='starter'&&i.slot==='weapon'&&i.classId===classId))p.inventory.push(makeEquipment(classId,'weapon'));
  prepareEquipment(p);prepareVitals(p);if(!this.party(id)||this.party(id).leader===id)for(const m of this.members(id))if(m.npc){m.level=level;prepareEquipment(m);prepareVitals(m);}
 }
 move(id,x,y){
  requireRule(!this.battleFor(id),'战斗中不能移动');requireRule(Number.isFinite(x)&&Number.isFinite(y),'位置无效');
  const p=this.player(id),before={x:p.x,y:p.y};p.x=Math.max(170,Math.min(CONFIG.world.width-60,x));p.y=Math.max(75,Math.min(CONFIG.world.height-65,y));
  const distance=Math.hypot(p.x-before.x,p.y-before.y);if(distance<.01)return false;
  const zoneAt=point=>CONFIG.zones.find(z=>Math.hypot(point.x-z.center[0],point.y-z.center[1])<z.radius);
  const zone=zoneAt(p),previousZone=zoneAt(before),old=this.travel.get(id),travel={zone:zone?.id,distance:old?.zone===zone?.id?old?.distance||0:0,grace:old?.grace||0};this.travel.set(id,travel);
  if(travel.grace>0){travel.grace=Math.max(0,travel.grace-distance);travel.distance=0;return false;}
  if(!zone||previousZone?.id!==zone.id||this.party(id)&&this.party(id).leader!==id||!this.allReady(id)){travel.distance=0;return false;}
  travel.distance+=distance;if(travel.distance<96)return false;travel.distance%=96;
  if(this.rng()>=.24)return false;
  const roll=this.rng();this.startEncounter(id,zone.id,roll<.75?'normal':roll<.95?'baby':'mutant');return true;
 }
 equipPet(id,petId){
  this.requirePeace(id);const p=this.player(id);requireRule(petId===null||p.pets.some(pet=>pet.id===petId),'宠物不属于此人物');p.equippedPet=petId;
 }
 renamePet(id,petId,name){this.requirePeace(id);const pet=this.player(id).pets.find(pet=>pet.id===petId);requireRule(pet,'宠物不属于此人物');requireRule(typeof name==='string'&&name.trim()&&Array.from(name.trim()).length<=12,'宠物名字需为1—12个字');pet.name=name.trim();}
 requireEquipmentPeace(id){requireRule(!this.battleFor(id),'请先返回地图，再调整装备');}
 equipEquipment(id,itemId){
  this.requireEquipmentPeace(id);const p=this.player(id),item=p.inventory.find(i=>i.id===itemId);requireRule(item,'装备不属于此人物');
  if(item.classId)requireRule(item.classId===p.classId,'此武器限'+CONFIG.classes.find(c=>c.id===item.classId).profession+'职业使用');requireRule(p.level>=item.level,item.level+'级才能穿戴此装备');
  p.equipment[item.slot]=item.id;prepareVitals(p);
 }
 unequipEquipment(id,slot){this.requireEquipmentPeace(id);requireRule(EQUIPMENT.slots.some(s=>s.id===slot),'装备部位不存在');const p=this.player(id);p.equipment[slot]=null;prepareVitals(p);}
 autoEquipment(id){
  this.requireEquipmentPeace(id);const p=this.player(id),score=i=>Object.values(i.stats).reduce((n,v)=>n+v,0);
  for(const slot of EQUIPMENT.slots){const best=p.inventory.filter(i=>i.slot===slot.id&&canWear(p,i)).sort((a,b)=>score(b)-score(a))[0];if(best)p.equipment[slot.id]=best.id;}
  prepareVitals(p);
 }
 supply(p,itemId,target){const item=ITEMS.find(item=>item.id===itemId);requireRule(item,'药品不存在');requireRule(p.supplies[itemId]>0,'此药品数量不足');requireRule(target,'请选择己方目标');requireRule(item.resource!=='mp'||target.kind==='hero','灵露只能用于人物');const maximum=item.resource==='hp'?'maxHp':'maxMp';requireRule(target[item.resource]<target[maximum],(item.resource==='hp'?'气血':'法力')+'已满');return item;}
 useSupply(id,itemId){this.requirePeace(id);const p=this.player(id);prepareVitals(p);const target={...p.vitals,kind:'hero',owner:id},item=this.supply(p,itemId,target);p.supplies[itemId]--;this.recoverResource(target,item.resource,item.amount);}
 restore(p){const effective=stats(p);p.vitalDeficits={hp:0,mp:0};p.vitals={hp:effective.maxHp,mp:effective.maxMp,maxHp:effective.maxHp,maxMp:effective.maxMp};}
 rest(id){this.requirePeace(id);const p=this.player(id);requireRule(Math.hypot(p.x-CONFIG.world.spawn[0],p.y-CONFIG.world.spawn[1])<=120,'请到驿站附近休整');this.restore(p);}
 hero(p){const effective=stats(p),vitals=prepareVitals(p);return {...CONFIG.classes.find(c=>c.id===p.classId),...effective,id:p.id,owner:p.id,classId:p.classId,kind:'hero',level:p.level,hp:vitals.hp,mp:vitals.mp,rage:0,npc:p.npc,cooldowns:{},statuses:[],normalCount:0};}
 petUnit(p,pet){
  const effective=petStats(pet);return {...pet,...effective,name:petName(pet),ability:copy(PET_SKILLS[pet.species]),kind:'pet',owner:p.id,hp:effective.maxHp,cooldowns:{},statuses:[]};
 }
 startEncounter(id,species,rarity='normal'){
  this.leader(id);requireRule(!this.battleFor(id),'请先返回地图');requireRule(this.allReady(id),'队友尚未准备，请全员准备后再出发');const zone=CONFIG.zones.find(z=>z.id===species);requireRule(zone&&CONFIG.rarities[rarity],'怪物区域或品质无效');
  const members=this.members(id),count=members.length+Math.floor(this.rng()*(members.length+1));
  const allies=members.map(p=>this.hero(p));for(const p of members){const pet=p.pets.find(q=>q.id===p.equippedPet);if(pet)allies.push(this.petUnit(p,pet));}
  const enemies=Array.from({length:Math.min(10,count)},(_,index)=>{
   const roll=this.rng(),kind=index===0?rarity:roll<.75?'normal':roll<.95?'baby':'mutant',quality=CONFIG.rarities[kind],maxHp=Math.round((40+zone.level*18)*quality.wildScale);
   return {id:randomUUID(),kind:'enemy',species,rarity:kind,name:quality.name+zone.name,level:zone.level,maxHp,hp:maxHp,atk:Math.round((5+zone.level*4)*quality.wildScale),def:3+zone.level,speed:zone.speed+zone.level,statuses:[],captured:false};
  });
  const battle={id:randomUUID(),controller:id,zone:zone.id,area:zone.area,round:1,allies,enemies,queue:[],index:0,currentActor:null,status:'active',log:[],seq:0,lastAction:null,busy:false};
  battle.queue=this.order(battle);battle.currentActor=battle.queue[0];this.battles.set(this.key(id),battle);this.message(battle,'遭遇'+enemies.length+'只'+zone.name+'，队伍'+members.length+'人。');
 }
 order(b){return [...b.allies,...b.enemies].filter(alive).sort((a,c)=>this.speed(c)-this.speed(a)).map(u=>u.id);}
 speed(u){const slow=u.statuses.find(s=>s.type==='slow');return u.speed*(slow?1-(slow.multiplier||.2):1);}
 unit(b,id){return [...b.allies,...b.enemies].find(u=>u.id===id);}
 message(b,text){b.log.push(text);if(b.log.length>12)b.log.shift();}
 captureChance(target){const q=CONFIG.rarities[target.rarity];return Math.min(.95,q.capture+(target.hp/target.maxHp<=.5?.15:0)+(target.hp/target.maxHp<=.25?.10:0));}
 skill(actor,id){return resolveSkill(skillData,actor.classId,id,actor.level);}
 event(b,actor,type,target,skillId=null){return {seq:++b.seq,actorId:actor.id,kind:type,skillName:skillId?this.skill(actor,skillId).name:({normal:'普通攻击',defend:'防御',capture:'捕捉',item:'使用药品','pet-skill':actor.ability?.name}[type]),...(skillId?{skillId,skillRank:this.skill(actor,skillId).rank}:{}),targetId:target?.id||actor.id,targets:[target?.id||actor.id],durationMs:actionDuration(actor.classId,type,skillId),hits:[],text:''};}
 markTarget(event,target){if(!event.targets.includes(target.id))event.targets.push(target.id);}
 finishAction(b,actor,event){this.endTurn(b,actor,event);b.lastAction=event;this.message(b,event.text);this.settle(b);if(b.status==='active')this.advance(b);return event;}
 act(id,command){
  const b=this.battleFor(id);requireRule(b&&b.status==='active','战斗已经结束');requireRule(!b.busy,'动作正在演出，请稍候');requireRule(b.currentActor===id,'尚未轮到你行动');
  const actor=this.unit(b,id);requireRule(actor&&alive(actor),'当前角色不能行动');return this.command(b,actor,command);
 }
 command(b,actor,{type,targetId,skillId,itemId}){
  requireRule(['normal','defend','capture','skill','item'].includes(type),'指令无效');let target=null,skill=null,item=null,cost=0,cd=0;
  const heal=type==='skill'&&actor.classId==='healer-shenzhiwei'&&skillId==='b';
  if(type!=='defend'){
   target=(heal||type==='item'?b.allies:b.enemies).find(u=>u.id===targetId&&alive(u));requireRule(target,'请选择有效的'+(heal||type==='item'?'己方':'敌方')+'目标');
  }
  if(type==='skill'){
   skill=this.skill(actor,skillId);requireRule(skill&&skill.kind!=='passive','技能不可主动施放');requireRule(actor.level>=skill.unlockLevel,skill.unlockLevel+'级解锁此技能');
   if(skill.kind==='ultimate')requireRule(actor.rage>=100,'需要100怒气');
   else{const values=skill.resource.match(/(\d+)法力 \/ (\d+)回合/);cost=Number(values[1]);cd=Number(values[2]);requireRule(actor.mp>=cost,'法力不足');requireRule((actor.cooldowns[skillId]||0)<=b.round,'技能仍在冷却');}
  }
  requireRule(type!=='capture'||actor.kind==='hero','只有人物可以捕捉');
  if(type==='item'){requireRule(actor.kind==='hero','只有人物可以使用药品');item=this.supply(this.player(actor.owner),itemId,target);}
  const event=this.event(b,actor,type,target,type==='skill'?skillId:null);
  if(type==='defend'){actor.defending=true;event.text=actor.name+'凝神防御，本轮减伤50%。';}
  if(type==='normal'){
   const passive=actor.kind==='hero'?this.skill(actor,'passive'):null,v=passive?.values;
   let multiplier=actor.kind==='pet'?1:actor.classId==='saber-hanpoyue'?1.2:actor.classId==='healer-shenzhiwei'?.8:1;
   actor.normalCount=(actor.normalCount||0)+1;
   if(passive?.rank){
    if(actor.classId==='swordsman-luqinglan'&&actor.normalCount%3===0){multiplier+=v.normalBonus;event.passiveTriggered=true;}
    if(actor.classId==='saber-hanpoyue'&&actor.hp/actor.maxHp<.35){multiplier+=v.normalBonus;event.passiveTriggered=true;}
    if(actor.classId==='assassin-xieqian'&&target.hp/target.maxHp<=.4){multiplier+=v.normalBonus;event.passiveTriggered=true;}
    if(actor.classId==='mage-suyingyue'&&actor.empowered){multiplier+=v.normalBonus;actor.empowered=false;event.passiveTriggered=true;}
   }
   if(actor.classId==='assassin-xieqian'){this.damage(b,actor,target,multiplier/2,event);this.damage(b,actor,target,multiplier/2,event);}else this.damage(b,actor,target,multiplier,event);
   if(actor.classId==='healer-shenzhiwei'&&passive?.rank&&actor.normalCount%3===0){this.heal(actor,actor.maxHp*v.selfHeal,event);event.passiveTriggered=true;}
   if(event.passiveTriggered&&passive?.rank){event.passiveRank=passive.rank;this.applyBonuses(b,actor,event,passive.bonusEffects);}
   if(actor.kind==='hero')actor.rage=Math.min(100,actor.rage+20);
   event.text=actor.name+'使用普通攻击。';
  }
  if(type==='capture'){
   const chance=this.captureChance(target);event.captureChance=chance;
   if(this.rng()<chance){
    const p=this.player(actor.owner),pet={id:randomUUID(),species:target.species,rarity:target.rarity,level:target.level,xp:0};p.pets.push(pet);if(!p.equippedPet)p.equippedPet=pet.id;
    target.captured=true;target.hp=0;event.captured=pet.id;event.hits.push({id:target.id,type:'capture',value:0});event.text='捕捉成功！'+target.name+'加入'+actor.name+'的宠物栏，下场战斗可以参战。';
   }else event.text=target.name+'挣脱了捕捉，消耗本次行动。';
  }
  if(type==='skill'){
   actor.mp-=cost;if(skill.kind==='ultimate')actor.rage-=100;else{actor.rage=Math.min(100,actor.rage+15);actor.cooldowns[skillId]=b.round+cd;}
   this.cast(b,actor,target,skillId,event);this.applyBonuses(b,actor,event,skill.bonusEffects);event.text=actor.name+'施放'+skill.name+'（'+skill.stageName+'）。';
   if(actor.classId==='mage-suyingyue'&&actor.level>=5&&skill.kind==='active')actor.empowered=true;
  }
  if(type==='item'){
   this.player(actor.owner).supplies[item.id]--;event.itemId=item.id;event.skillName=item.name;
   if(item.resource==='hp')this.heal(target,item.amount,event);else this.recoverResource(target,'mp',item.amount,event);
   event.text=actor.name+'为'+target.name+'使用'+item.name+'。';
  }
  return this.finishAction(b,actor,event);
 }
 damage(b,source,target,multiplier,event,dot=false){
  if(!alive(target))return;
  this.markTarget(event,target);
  const armorStatus=target.statuses.find(s=>s.type==='armor'),armor=target.def*(armorStatus?1-(armorStatus.multiplier||.15):1);let amount=Math.max(1,Math.round(source.atk*multiplier-armor*.6));
  if(target.defending)amount=Math.round(amount*.5);
  if(target.kind==='hero'&&target.classId==='saber-hanpoyue'&&target.level>=5&&target.hp/target.maxHp<.35){amount=Math.round(amount*(1-this.skill(target,'passive').values.damageReduction));if(event.kind==='normal')event.passiveTriggered=true;}
  const protect=target.statuses.find(s=>s.type==='protect');if(protect)amount=Math.round(amount*(1-(protect.multiplier||.15)));
  if(target.shield){const absorbed=Math.min(amount,target.shield);target.shield-=absorbed;amount-=absorbed;event.hits.push({id:target.id,type:'shield',value:absorbed});}
  const actual=Math.min(target.hp,amount);target.hp-=actual;if(actual>0)event.hits.push({id:target.id,type:'damage',value:actual});
  if(actual>0&&target.kind==='hero'&&!dot&&target.hurtRound!==b.round){target.rage=Math.min(100,target.rage+10);target.hurtRound=b.round;}
 }
 recoverResource(target,resource,amount,event=null){
  const maximum=resource==='hp'?'maxHp':'maxMp',p=target.kind==='hero'?this.player(target.owner):null,overflow=p?Math.max(0,p.vitalDeficits[resource]-p.vitals[maximum]):0;
  const deficit=Math.max(0,target[maximum]-target[resource]+overflow-Math.round(amount)),value=Math.max(0,target[maximum]-deficit)-target[resource];target[resource]+=value;
  if(p){p.vitalDeficits[resource]=deficit;p.vitals[resource]=target[resource];p.vitals[maximum]=target[maximum];}
  if(event&&value>0)event.hits.push({id:target.id,type:resource==='hp'?'heal':'mana',value});return value;
 }
 heal(target,amount,event){if(!alive(target))return;this.markTarget(event,target);this.recoverResource(target,'hp',amount,event);}
 status(target,type,rounds,source,multiplier=0){const existing=target.statuses.find(s=>s.type===type);if(existing&&['armor','slow','protect'].includes(type)){const fallback=type==='slow'?.2:.15;multiplier=Math.max(existing.multiplier||fallback,multiplier||fallback);rounds=Math.max(existing.rounds,rounds);}target.statuses=target.statuses.filter(s=>s.type!==type);target.statuses.push({type,rounds,atk:source.atk,multiplier,...(target.id===source.id?{fresh:true}:{})});}
 applyBonuses(b,actor,event,effects){
  const marked=event.targets.map(id=>this.unit(b,id)).filter(alive);
  for(const effect of effects){
   const targets=effect.target==='self'?[actor]:effect.target==='target'?[this.unit(b,event.targetId)].filter(alive):marked.filter(unit=>effect.target==='enemies'?unit.kind==='enemy':unit.kind!=='enemy');
   for(const target of targets){
    this.markTarget(event,target);(event.bonusEffects??=[]).push({id:target.id,type:effect.type});
    if(effect.type==='shield'){target.shield=Math.max(target.shield||0,Math.round(target.maxHp*effect.value));this.status(target,'shield',Math.max(effect.rounds,target.statuses.find(s=>s.type==='shield')?.rounds||0),actor);}
    else if(effect.type==='heal')this.heal(target,target.maxHp*effect.value,event);
    else if(effect.type==='mana')this.recoverResource(target,'mp',effect.value,event);
    else if(effect.type==='rage')target.rage=Math.min(100,target.rage+effect.value);
    else if(effect.type==='stealth')target.stealth=true;
    else this.status(target,effect.type,effect.rounds,actor,effect.value);
   }
  }
 }
 cast(b,a,target,id,e){
  const v=this.skill(a,id).values;
  const enemies=()=>[target,...b.enemies.filter(u=>alive(u)&&u.id!==target.id)].filter(alive).slice(0,3);
  const hit=(t,m)=>this.damage(b,a,t,m,e),status=(t,type,n,m=0)=>{this.markTarget(e,t);this.status(t,type,n,a,m);},dot=(t,m,n)=>status(t,'dot',n,m);
  switch(a.classId){
   case 'swordsman-luqinglan':if(id==='a'||id==='b'){(id==='a'?[target]:enemies()).forEach(t=>hit(t,v.damage));}else v.damage.forEach(m=>hit(target,m));break;
   case 'saber-hanpoyue':if(id==='a'){hit(target,v.damage);status(target,'armor',2,v.armorReduction);}else if(id==='b')enemies().forEach(t=>hit(t,v.damage));else{enemies().forEach(t=>hit(t,v.damage));a.shield=Math.round(a.maxHp*v.shield);status(a,'shield',2);}break;
   case 'assassin-xieqian':if(id==='a'){hit(target,v.damage);a.stealth=true;this.markTarget(e,a);}else if(id==='b'){hit(target,v.damage);dot(target,v.dot,3);}else{const execute=target.hp/target.maxHp<=.3;for(let i=0;i<5;i++)hit(target,v.damage+(i===4&&execute?v.executeBonus:0));}break;
   case 'mage-suyingyue':if(id==='a'){hit(target,v.damage);const at=b.enemies.indexOf(target);b.enemies.filter(alive).filter(t=>t.id!==target.id).sort((x,y)=>Math.abs(b.enemies.indexOf(x)-at)-Math.abs(b.enemies.indexOf(y)-at)).slice(0,2).forEach(t=>hit(t,v.splash));}else if(id==='b')enemies().forEach(t=>{dot(t,v.dot,3);status(t,'slow',2,v.slow);});else enemies().forEach(t=>{hit(t,v.damage);dot(t,v.dot,2);});break;
   case 'healer-shenzhiwei':if(id==='a'){hit(target,v.damage);dot(target,v.dot,3);}else if(id==='b')this.heal(target,a.atk*v.heal+target.maxHp*v.maxHpHeal,e);else{
    b.allies.filter(alive).sort((x,y)=>x.hp/x.maxHp-y.hp/y.maxHp).slice(0,3).forEach(t=>{this.heal(t,a.atk*v.heal+t.maxHp*v.maxHpHeal,e);status(t,'regen',2,v.regen);status(t,'protect',2,v.protect);});enemies().forEach(t=>hit(t,v.damage));
   }break;
  }
 }
 endTurn(b,actor,event){
  for(const s of actor.statuses){
   if(s.fresh){delete s.fresh;continue;}
   if(s.type==='dot'&&alive(actor))this.damage(b,{atk:s.atk},actor,s.multiplier,event,true);
   if(s.type==='regen')this.heal(actor,s.atk*s.multiplier,event);
   s.rounds--;
  }
  const shield=actor.statuses.find(s=>s.type==='shield');if(shield&&shield.rounds<=0)actor.shield=0;
  actor.statuses=actor.statuses.filter(s=>s.rounds>0);
 }
 advance(b){
  for(let i=0;i<30;i++){
   b.index++;if(b.index>=b.queue.length){b.round++;b.queue=this.order(b);b.index=0;}
   const next=this.unit(b,b.queue[b.index]);if(next&&alive(next)){b.currentActor=next.id;next.defending=false;next.stealth=false;return;}
  }
 }
 autoCommand(b,actor){
  const enemies=b.enemies.filter(alive),target=enemies[0],usable=id=>{const skill=this.skill(actor,id);if(!skill||actor.level<skill.unlockLevel)return false;if(skill.kind==='ultimate')return actor.rage>=100;const cost=Number(skill.resource.match(/(\d+)法力/)[1]);return actor.mp>=cost&&(actor.cooldowns[id]||0)<=b.round;};
  if(usable('ultimate'))return {type:'skill',skillId:'ultimate',targetId:target.id};
  if(actor.classId==='healer-shenzhiwei'&&usable('b')){const injured=b.allies.filter(a=>alive(a)&&a.hp<a.maxHp).sort((a,c)=>a.hp/a.maxHp-c.hp/c.maxHp)[0];if(injured)return {type:'skill',skillId:'b',targetId:injured.id};}
  if(actor.classId!=='healer-shenzhiwei'&&usable('b')&&(actor.classId==='assassin-xieqian'?!target.statuses.some(s=>s.type==='dot'):enemies.length>1&&(actor.classId!=='mage-suyingyue'||!target.statuses.some(s=>s.type==='dot'))))return {type:'skill',skillId:'b',targetId:target.id};
  if(usable('a'))return {type:'skill',skillId:'a',targetId:target.id};
  return {type:'normal',targetId:target.id};
 }
 petAction(b,actor){
  const enemy=b.enemies.find(alive),owner=b.allies.find(a=>a.id===actor.owner&&alive(a)),support=actor.species==='tuanzi'||actor.species==='turtle';
  if((actor.cooldowns.ability||0)>b.round||support&&(!owner||actor.species==='tuanzi'&&owner.hp>=owner.maxHp))return this.command(b,actor,{type:'normal',targetId:enemy.id});
  const target=support?owner:enemy,event=this.event(b,actor,'pet-skill',target);event.species=actor.species;actor.cooldowns.ability=b.round+3;
  if(actor.species==='tuanzi')this.heal(owner,actor.atk*1.6+owner.maxHp*.05,event);
  else if(actor.species==='turtle')this.status(owner,'protect',2,actor);
  else if(actor.species==='monkey'){this.damage(b,actor,enemy,.7,event);this.damage(b,actor,enemy,.7,event);}
  else this.damage(b,actor,enemy,actor.species==='boar'?1.6:1.35,event);
  event.text=actor.name+'施放'+actor.ability.name+'。';return this.finishAction(b,actor,event);
 }
 stepAuto(id,allowHuman=false){
  const b=this.battleFor(id);if(!b||b.status!=='active')return null;const actor=this.unit(b,b.currentActor);
  if(actor.kind==='hero'&&!actor.npc&&!allowHuman)return null;
  if(actor.kind==='pet')return this.petAction(b,actor);
  if(actor.kind==='hero')return this.command(b,actor,this.autoCommand(b,actor));
  const available=b.allies.filter(alive),visible=available.filter(a=>!a.stealth),targets=visible.length?visible:available,target=targets[Math.min(targets.length-1,Math.floor(this.rng()*targets.length))];
  const event=this.event(b,actor,'normal',target);event.text=actor.name+'攻击'+target.name+'。';
  this.damage(b,actor,target,1,event);return this.finishAction(b,actor,event);
 }
 syncVitals(b){for(const actor of b.allies.filter(a=>a.kind==='hero')){const p=this.player(actor.owner);for(const [resource,maximum] of [['hp','maxHp'],['mp','maxMp']])p.vitalDeficits[resource]=actor[maximum]-actor[resource]+Math.max(0,p.vitalDeficits[resource]-p.vitals[maximum]);p.vitals={hp:actor.hp,mp:actor.mp,maxHp:actor.maxHp,maxMp:actor.maxMp};}}
 settle(b){
  if(b.status!=='active')return;
  this.syncVitals(b);
  if(!b.allies.some(a=>a.kind==='hero'&&alive(a))){b.status='defeated';b.result={xp:0,captured:b.enemies.filter(e=>e.captured).length,loot:[],supplies:[]};this.message(b,'暂时不敌，返回驿站休整。');return;}
  if(b.enemies.some(alive))return;
  b.status='victory';const xp=b.enemies.reduce((n,e)=>n+Math.round((18+e.level*4)*(e.captured?.5:1)),0);b.result={xp,captured:b.enemies.filter(e=>e.captured).length,defeated:b.enemies.filter(e=>!e.captured).length,loot:[],supplies:[]};
  for(const actor of b.allies.filter(a=>a.kind==='hero')){
   const p=this.player(actor.owner);p.xp+=xp;while(p.xp>=needXp(p.level)){p.xp-=needXp(p.level);p.level++;}
   const vitals=prepareVitals(p);Object.assign(actor,stats(p),vitals,{level:p.level});
   const items=[];
   for(const enemy of b.enemies.filter(e=>!e.captured)){
    if(items.length>=2)break;const drop=EQUIPMENT.drops[enemy.rarity];if(this.rng()>=drop.chance)continue;
    const roll=this.rng();let total=0,index=drop.weights.findIndex(weight=>{total+=weight;return roll<total;});if(index<0)index=drop.weights.length-1;
    const slot=EQUIPMENT.slots[Math.floor(this.rng()*EQUIPMENT.slots.length)],level=EQUIPMENT.levels.findLast(n=>n<=enemy.level);
    items.push(makeEquipment(p.classId,slot.id,level,EQUIPMENT.qualities[index].id,'drop'));
   }
   p.inventory.push(...items);b.result.loot.push({ownerId:p.id,items:copy(items)});
   for(const pet of p.pets){pet.xp+=xp;while(pet.xp>=needXp(pet.level)){pet.xp-=needXp(pet.level);pet.level++;}}
  }
  // Roll supplies after all equipment drops so existing equipment RNG order stays intact.
  for(const actor of b.allies.filter(a=>a.kind==='hero')){
   const p=this.player(actor.owner),items=[];
   for(const enemy of b.enemies.filter(e=>!e.captured)){if(items.reduce((n,item)=>n+item.quantity,0)>=2)break;if(this.rng()>=.35)continue;const itemId=this.rng()<.7?'hp-pill':'mp-pill',existing=items.find(item=>item.itemId===itemId);if(existing)existing.quantity++;else items.push({itemId,quantity:1});p.supplies[itemId]++;}
   b.result.supplies.push({ownerId:p.id,items});
  }
  this.message(b,'战斗胜利，每位角色获得'+xp+'经验。');
 }
 finishBattle(id){this.leader(id);const b=this.battleFor(id);requireRule(b&&b.status!=='active','战斗尚未结束');requireRule(!b.busy,'动作正在演出，请稍候');if(b.status==='defeated')this.home(id);this.battles.delete(this.key(id));for(const p of this.members(id))this.travel.set(p.id,{zone:b.zone,distance:0,grace:160});}
 retreat(id){this.leader(id);const b=this.battleFor(id);requireRule(b,'没有当前战斗');requireRule(!b.busy,'动作正在演出，请稍候');this.battles.delete(this.key(id));this.home(id);}
 home(id){for(const p of this.members(id)){p.x=CONFIG.world.spawn[0];p.y=CONFIG.world.spawn[1];this.travel.delete(p.id);this.restore(p);}}
 publicPlayer(p){prepareVitals(p);const result={...copy(p),...CONFIG.classes.find(c=>c.id===p.classId),id:p.id,baseStats:baseStats(p),equipmentBonus:equipmentBonus(p),stats:stats(p),nextXp:needXp(p.level)};delete result.vitalDeficits;result.supplyRecovery=Object.fromEntries(ITEMS.map(item=>{const maximum=item.resource==='hp'?'maxHp':'maxMp';return [item.id,Math.max(0,p.vitals[maximum]-Math.max(0,p.vitalDeficits[item.resource]-item.amount))-p.vitals[item.resource]];}));result.pets=p.pets.map(pet=>({...copy(pet),name:petName(pet),stats:petStats(pet),ability:copy(PET_SKILLS[pet.species])}));return result;}
 snapshot(id){
  const p=this.player(id),team=this.party(id),battle=this.battleFor(id);
  const current=battle?copy(battle):null;if(current)for(const e of current.enemies)e.captureChance=this.captureChance(e);
  return {player:this.publicPlayer(p),party:team?{code:team.code,leader:team.leader,members:team.members.map(mid=>this.publicPlayer(this.player(mid)))}:null,battle:current};
 }
 exportPlayers(){return [...this.players.values()].filter(p=>!p.npc).map(p=>{const row=copy(p);row.teamId=null;return row;});}
 exportWorld(){return {teams:copy([...this.teams.values()]),npcs:copy([...this.players.values()].filter(p=>p.npc)),battles:copy([...this.battles])};}
}

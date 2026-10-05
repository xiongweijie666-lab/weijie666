import {actionDuration,resolveFrame,actionPose,drawEffects,effectTargets} from './combat-art.mjs';
import {createSkillPanel} from './skill-ui.js';
import {createSystemsPanels} from './systems-ui.js';
import {resolveSkill} from './skill-growth.mjs';
const $=selector=>document.querySelector(selector);
const esc=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),point=p=>({x:p[0],y:p[1]});
const world=$('#world'),ctx=world.getContext('2d'),battleCanvas=$('#battle-canvas'),battleCtx=battleCanvas.getContext('2d');
let config,manifest,skills,equipmentData,state,session,eventStream,mapImage,width=1,height=1,dpr=1,zoom=1,pos={x:245,y:825},facing=1,walking=false;
let path=[],keys=new Set(),stick={x:0,y:0},images=new Map(),lastTime=performance.now(),lastMove=0,sendingMove=false,lastSent={x:0,y:0},lastHud=0,toastTimer=null;
let selectedEnemy=null,selectedAlly=null,eventKey='',visual=null,previousHp={},leaderTrail=[],npcPositions=new Map();
let camera={x:0,y:0};
let equipmentSignature='',equipmentFilter='all',selectedEquipment=null,itemsData,systemsPanels,skillPanel;
function image(url){if(images.has(url))return images.get(url);const img=new Image();img.src=url;images.set(url,img);return img;}
function ready(img){return img.complete&&img.naturalWidth>0;}
function loaded(img){if(ready(img))return Promise.resolve();return new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('素材载入失败：'+img.src));});}
function toast(text){
 clearTimeout(toastTimer);document.querySelectorAll('.panel-toast').forEach(node=>node.remove());
 const dialog=document.querySelector('dialog[open]');
 if(dialog){const note=document.createElement('p');note.className='panel-toast';note.setAttribute('role','status');note.textContent=text;dialog.append(note);}else{$('#toast').textContent=text;$('#toast').style.display='block';}
 toastTimer=setTimeout(()=>{$('#toast').style.display='none';document.querySelectorAll('.panel-toast').forEach(node=>node.remove());},3200);
}
async function request(route,body={},apply=true){
 const response=await fetch('/api/'+route,{method:'POST',headers:{'content-type':'application/json',...(session?{'x-player-id':session.id,'x-player-token':session.token}:{})},body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw new Error(result.error);if(apply&&result.player)applyState(result);return result;
}
async function command(route,body={}){try{return await request(route,body);}catch(error){toast(error.message);return null;}}
function openDialog(id){
 path=[];keys.clear();stick={x:0,y:0};walking=false;$('#knob').style.transform='';
 for(const dialog of document.querySelectorAll('dialog[open]'))if(dialog!==$(id))dialog.close();
 if(!$(id).open)$(id).showModal();
}
function openPanel(name){
 if(!state?.player)return;
 if(name==='equipment'){openEquipment();return;}
 if(name==='skills')skillPanel.open();else if(name==='team')renderTeam(true);else if(name==='pets')renderPets(true);else if(name==='bag')systemsPanels.renderBag(true);
 openDialog('#'+name+'-dialog');
}
async function fullscreen(){
 try{if(document.fullscreenElement){await document.exitFullscreen();return;}if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();if(screen.orientation?.lock)await screen.orientation.lock('landscape');}
 catch{if(matchMedia('(orientation:portrait)').matches)$('#orientation-note').textContent='请手动横置设备；当前浏览器不支持自动转向。';}
 resize();
}
document.querySelectorAll('[data-fullscreen]').forEach(button=>button.onclick=fullscreen);
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
function modalOpen(){return [...document.querySelectorAll('dialog')].some(d=>d.open)||matchMedia('(max-width:600px) and (orientation:portrait)').matches;}
function clip(classId,action){return manifest.characters.find(c=>c.id===classId)?.clips.find(c=>c.id===action);}
function atlas(classId,action){return image('../character-animation-v3/'+clip(classId,action).atlas);}
function preloadClass(classId){return Promise.all(['idle','walk','attack','cast','hit'].map(a=>loaded(atlas(classId,a))));}
function drawHero(context,classId,x,y,size,action='idle',time=performance.now(),mirror=false,alpha=1){
 let c=clip(classId,action),img=atlas(classId,action);if(!ready(img)){c=clip(classId,'idle');img=atlas(classId,'idle');}if(!ready(img))return;
 const frame=c.frames[resolveFrame(c,time)];
 context.save();context.translate(x,y);context.globalAlpha=alpha;context.fillStyle='#16362438';context.beginPath();context.ellipse(0,3,size*.18,6,0,0,Math.PI*2);context.fill();if(mirror)context.scale(-1,1);
 context.drawImage(img,frame.atlas.x,frame.atlas.y,512,512,-size/2,-size*440/512,size,size);context.restore();
}
function drawCreature(context,species,rarity,x,y,size,mirror=false,alpha=1){
 const img=image('assets/'+species+'-'+rarity+'.png');if(!ready(img))return;context.save();context.translate(x,y);context.globalAlpha=alpha;context.fillStyle='#233a2940';context.beginPath();context.ellipse(0,3,size*.3,5,0,0,Math.PI*2);context.fill();if(mirror)context.scale(-1,1);context.drawImage(img,-size/2,-size,size,size*340/320);context.restore();
}
function label(context,text,x,y,color='#fff9db',font=12){context.save();context.font=font+'px Microsoft YaHei';context.textAlign='center';context.lineWidth=3;context.strokeStyle='#1b3425c4';context.strokeText(text,x,y);context.fillStyle=color;context.fillText(text,x,y);context.restore();}
function segmentDistance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.y-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(p.x-a[0]-t*dx,p.y-a[1]-t*dy);}
function canWalk(p){
 if(p.x<170||p.x>config.world.width-60||p.y<75||p.y>config.world.height-65)return false;
 if(((p.x-340)/140)**2+((p.y-350)/75)**2<1)return false;
 if(distance(p,point(config.world.spawn))<120||config.zones.some(z=>distance(p,point(z.center))<z.radius))return true;
 return config.roads.some(road=>road.some((a,i)=>i>0&&segmentDistance(p,road[i-1],a)<62));
}
function routeTo(destination){
 const nodes=[],links=new Map(),key=p=>p.join(',');
 for(const road of config.roads){for(const p of road){if(!links.has(key(p))){nodes.push(p);links.set(key(p),[]);}}for(let i=1;i<road.length;i++){links.get(key(road[i-1])).push(road[i]);links.get(key(road[i])).push(road[i-1]);}}
 const nearest=p=>nodes.reduce((a,b)=>distance(p,point(a))<distance(p,point(b))?a:b),start=nearest(pos),end=nearest(destination),dist=new Map([[key(start),0]]),prev=new Map(),left=new Set(nodes.map(key));
 while(left.size){const at=[...left].sort((a,b)=>(dist.get(a)??Infinity)-(dist.get(b)??Infinity))[0];left.delete(at);if(at===key(end))break;const a=nodes.find(p=>key(p)===at);for(const b of links.get(at)){const cost=(dist.get(at)??Infinity)+distance(point(a),point(b));if(cost<(dist.get(key(b))??Infinity)){dist.set(key(b),cost);prev.set(key(b),a);}}}
 let pathNodes=[end],at=end;while(key(at)!==key(start)){at=prev.get(key(at));if(!at)break;pathNodes.unshift(at);}return [...pathNodes.map(point),destination];
}
function navigate(destination){path=distance(pos,destination)<100?[destination]:routeTo(destination);toast('沿小径前往目标区域，进入活动区后移动可能遇敌');}
function applyState(next){
 const before=state;if(before?.battle&&next.battle&&next.battle.lastAction&&next.battle.id+':'+next.battle.seq!==eventKey){
  eventKey=next.battle.id+':'+next.battle.seq;previousHp=Object.fromEntries([...before.battle.allies,...before.battle.enemies].map(u=>[u.id,u.hp]));const event=next.battle.lastAction,actor=next.battle.allies.find(a=>a.id===event.actorId);visual={...event,start:performance.now(),duration:event.durationMs||actionDuration(actor?.classId,event.kind,event.skillId)};
  visual.durationMs=visual.duration;
 }
 state=next;if(!before||before.battle&&!next.battle||!walking&&!path.length){pos={x:next.player.x,y:next.player.y};}
 if(next.battle){path=[];stick={x:0,y:0};keys.clear();$('#knob').style.transform='';}
 $('#battle').hidden=!next.battle;
 if(!before?.battle&&next.battle){eventKey=next.battle.id+':'+next.battle.seq;visual=null;selectedEnemy=next.battle.enemies.find(u=>u.hp>0)?.id;selectedAlly=session.id;}
 const classes=[next.player.classId,...(next.party?.members.map(p=>p.classId)||[])];for(const id of new Set(classes)){atlas(id,'idle');atlas(id,'walk');}
 updateHud();if(next.battle)updateBattle();if($('#team-dialog').open)renderTeam();if($('#pets-dialog').open)renderPets();if($('#equipment-dialog').open)renderEquipment();if($('#bag-dialog').open)systemsPanels.renderBag();if($('#skills-dialog').open)skillPanel.render();
}
function updateHud(){
 if(!state)return;const p=state.player;$('#hero-name').textContent=p.name;$('#hero-level').textContent=p.level+'级 · '+p.profession;$('#hero-portrait').src='../cast-v5/'+p.classId+'.png';$('#xp-fill').style.width=Math.min(100,p.xp/p.nextXp*100)+'%';$('#xp-text').textContent='经验 '+p.xp+' / '+p.nextXp;
 $('#party-count').textContent=(state.party?.members.length||1)+'/5';$('#pet-count').textContent=p.pets.length;
 $('#equipment-count').textContent=Object.values(p.equipment).filter(Boolean).length+'/6';
 $('#skill-count').textContent=skills.characters.find(c=>c.id===p.classId).skills.filter(s=>p.level>=s.unlockLevel).length+'/4';$('#supply-count').textContent=Object.values(p.supplies||{}).reduce((n,v)=>n+v,0)+'药';
 $('#hero-resources').textContent=p.vitals?'生命 '+p.vitals.hp+'/'+p.vitals.maxHp+' · 法力 '+p.vitals.mp+'/'+p.vitals.maxMp:'';
 const zone=config.zones.find(z=>distance(pos,point(z.center))<z.radius+40);$('#area-name').textContent=zone?zone.area+' · '+zone.level+'级':'石溪驿站 / 山间小径';$('#coordinates').textContent=(zone?zone.name+'活动区':'沿小径探索')+' · '+Math.round(pos.x)+', '+Math.round(pos.y);
}
function renderTeam(force=false){systemsPanels?.renderTeam(force);}
function renderPets(force=false){systemsPanels?.renderPets(force);}
function gearQuality(item){return equipmentData.qualities.find(q=>q.id===item.quality);}
function gearIcon(icon){return '<svg class="gear-icon" aria-hidden="true"><use href="assets/equipment-icons.svg#'+esc(icon)+'"></use></svg>';}
function gearStats(item){return Object.entries(item.stats).map(([key,value])=>equipmentData.statNames[key]+' +'+value).join(' · ');}
function openEquipment(itemId=null){
 path=[];keys.clear();stick={x:0,y:0};walking=false;$('#knob').style.transform='';
 if(itemId){selectedEquipment=itemId;equipmentFilter='all';}renderEquipment(true);openDialog('#equipment-dialog');
}
function renderEquipment(force=false){
 const p=state.player,sig=JSON.stringify([p.classId,p.level,p.inventory,p.equipment,!!state.battle,equipmentFilter,selectedEquipment]);if(!force&&sig===equipmentSignature)return;equipmentSignature=sig;
 const wornIds=Object.values(p.equipment),selected=p.inventory.find(i=>i.id===selectedEquipment)||p.inventory.find(i=>equipmentFilter==='all'||i.slot===equipmentFilter);selectedEquipment=selected?.id||null;
 $('#equipment-identity').textContent=p.name+' · '+p.profession+' · '+p.level+'级';$('#equipment-portrait').src='../cast-v5/'+p.classId+'.png';
 $('#worn-slots').innerHTML=equipmentData.slots.map(slot=>{const item=p.inventory.find(i=>i.id===p.equipment[slot.id]);return '<button class="worn-slot" data-slot="'+slot.id+'" aria-label="查看'+slot.name+'：'+(item?esc(item.name):'未穿戴')+'" style="--quality:'+(item?gearQuality(item).color:'#bac3b1')+'"><small>'+slot.name+'</small>'+gearIcon(item?.icon||(slot.id==='weapon'?equipmentData.weapons[p.classId].icon:slot.id))+'<span>'+(item?esc(item.name):'未穿戴')+'</span></button>';}).join('');
 $('#worn-slots').querySelectorAll('[data-slot]').forEach(button=>button.onclick=()=>{equipmentFilter=button.dataset.slot;selectedEquipment=p.equipment[equipmentFilter]||p.inventory.find(i=>i.slot===equipmentFilter&&(!i.classId||i.classId===p.classId))?.id||null;renderEquipment(true);});
 $('#equipment-stats').innerHTML=Object.entries(equipmentData.statNames).map(([key,name])=>'<div data-stat="'+key+'"><span>'+name+'</span><strong>'+p.stats[key]+'</strong><small>基础 '+p.baseStats[key]+' <em>+'+p.equipmentBonus[key]+'</em></small></div>').join('');
 $('#equipment-auto').disabled=!!state.battle;$('#equipment-state-note').textContent=state.battle?'返回地图后可以调整装备。':wornIds.some(Boolean)?'穿戴加成已计入属性，下场战斗生效。':'新手行装已入行囊，可以逐件穿戴。';
 $('#bag-count').textContent=p.inventory.length+'件 · 已穿戴'+wornIds.filter(Boolean).length+'件';
 $('#equipment-filters').innerHTML=[{id:'all',name:'全部'},...equipmentData.slots].map(s=>'<button data-filter="'+s.id+'" aria-pressed="'+(equipmentFilter===s.id)+'">'+s.name+'</button>').join('');
 $('#equipment-filters').querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{equipmentFilter=button.dataset.filter;selectedEquipment=null;renderEquipment(true);});
 const items=p.inventory.filter(i=>equipmentFilter==='all'||i.slot===equipmentFilter).sort((a,b)=>b.level-a.level||equipmentData.qualities.findIndex(q=>q.id===b.quality)-equipmentData.qualities.findIndex(q=>q.id===a.quality));
 $('#equipment-items').innerHTML=items.length?items.map(item=>{const q=gearQuality(item),worn=wornIds.includes(item.id),locked=item.level>p.level||item.classId&&item.classId!==p.classId;return '<button class="bag-item'+(locked?' gear-locked':'')+'" data-item="'+item.id+'" aria-label="查看装备：'+esc(item.name)+'，'+q.name+'，'+item.level+'级'+(worn?'，已穿戴':'')+'" aria-pressed="'+(selectedEquipment===item.id)+'" style="--quality:'+q.color+'">'+gearIcon(item.icon)+'<strong>'+esc(item.name)+'</strong><small>'+item.level+'级 · '+q.name+'</small>'+(worn?'<i>已穿戴</i>':locked?'<i class="locked-mark">未满足</i>':'')+'</button>';}).join(''):'<div class="empty">此部位暂无装备<br>击败怪物有机会获得</div>';
 $('#equipment-items').querySelectorAll('[data-item]').forEach(button=>button.onclick=()=>{selectedEquipment=button.dataset.item;renderEquipment(true);});
 const detail=$('#equipment-detail');
 if(selected){
  const q=gearQuality(selected),slot=equipmentData.slots.find(s=>s.id===selected.slot),current=p.inventory.find(i=>i.id===p.equipment[selected.slot]),worn=current?.id===selected.id,wrongClass=selected.classId&&selected.classId!==p.classId,tooHigh=selected.level>p.level,profession=config.classes.find(c=>c.id===selected.classId)?.profession;
  const compare=Object.keys({...current?.stats,...selected.stats}).map(key=>{const delta=(selected.stats[key]||0)-(current?.stats[key]||0);return '<div class="gear-compare"><span>'+equipmentData.statNames[key]+'</span><strong>'+(selected.stats[key]||0)+'</strong><em class="'+(delta<0?'lower':'')+'">'+(worn?'已生效':delta>0?'↑ +'+delta:delta<0?'↓ '+delta:'无变化')+'</em></div>';}).join('');
  detail.innerHTML='<div class="detail-art" style="--quality:'+q.color+'">'+gearIcon(selected.icon)+'<span>'+q.name+'</span></div><h3 style="color:'+q.color+'">'+esc(selected.name)+'</h3><p class="gear-requirement">'+selected.level+'级 · '+slot.name+' · '+(profession?profession+'专用':'全职业通用')+'</p>'+compare+'<div class="current-gear"><small>当前'+slot.name+'</small><strong>'+(current?esc(current.name):'未穿戴')+'</strong><span>'+(current?gearStats(current):'无装备加成')+'</span></div><p class="gear-reason">'+(wrongClass?'此武器限'+profession+'使用。':tooHigh?'人物达到'+selected.level+'级后可穿戴。':worn?'这件装备正在使用。':'可以穿戴'+(current?'，替换当前'+slot.name:'')+'。')+'</p><div class="detail-actions"><button id="equipment-equip" class="primary" '+(state.battle||wrongClass||tooHigh||worn?'disabled':'')+'>'+(worn?'已穿戴':current?'替换装备':'穿戴装备')+'</button>'+(worn?'<button id="equipment-remove" '+(state.battle?'disabled':'')+'>卸下装备</button>':'')+'</div><p class="equipment-note">'+(selected.slot==='weapon'?'攻击 / 术力影响普攻、技能与医师治疗。':selected.slot==='feet'?'速度越高，回合内越早出手。':selected.origin==='drop'?'历练所得，已归入个人行囊。':'新手行装，伴你初入仙途。')+'</p>';
  $('#equipment-equip').onclick=async()=>{if(await command('equipment/equip',{itemId:selected.id}))toast('已穿戴'+selected.name+'，属性已更新。');};if(worn)$('#equipment-remove').onclick=async()=>{if(await command('equipment/unequip',{slot:selected.slot}))toast('已卸下'+selected.name+'，物品保留在行囊。');};
 }else detail.innerHTML='<div class="empty">选择一件装备<br>查看属性和穿戴要求</div>';
 $('#equipment-quality-legend').innerHTML='<span>品质</span>'+equipmentData.qualities.map(q=>'<span style="--quality:'+q.color+'"><i class="quality-dot '+q.id+'"></i>'+q.name+'</span>').join('')+'<span class="gear-level-note">装备等级 1 / 5 / 10 / 15</span>';
}
function renderLoot(b){
 const items=b.result.loot?.find(l=>l.ownerId===session.id)?.items||[],supplies=b.result.supplies?.find(l=>l.ownerId===session.id)?.items||[];
 $('#result-loot').innerHTML=b.status==='victory'?'<h4>我的战利品</h4>'+(items.length?items.map(item=>'<button class="loot-item" data-loot="'+item.id+'" style="--quality:'+gearQuality(item).color+'">'+gearIcon(item.icon)+'<span><strong>'+esc(item.name)+'</strong><small>'+item.level+'级 · '+gearQuality(item).name+' · '+gearStats(item)+'</small></span></button>').join(''):'<p>本场未掉落装备</p>')+supplies.map(drop=>'<p class="supply-loot">'+esc(itemsData.find(i=>i.id===drop.itemId)?.name||'药品')+' ×'+drop.quantity+'</p>').join('')+((items.length||supplies.length)?'<small>已放入你的行囊</small>':''):'';
 $('#result-loot').querySelectorAll('[data-loot]').forEach(button=>button.onclick=()=>openEquipment(button.dataset.loot));
}
function ownActor(){return state.battle?.allies.find(a=>a.id===session.id);}
function statusTags(unit){
 const names={dot:'持续伤害',slow:'减速',armor:'破甲',regen:'回春',protect:'护佑',shield:'护盾'};
 return '<div class="status-tags">'+(unit.statuses||[]).map(s=>'<span class="'+(['regen','protect','shield'].includes(s.type)?'good':'')+'">'+(names[s.type]||s.type)+' '+s.rounds+'回合</span>').join('')+(unit.defending?'<span class="good">防御</span>':'')+(unit.stealth?'<span class="good">隐匿</span>':'')+(unit.shield?'<span class="good">盾 '+unit.shield+'</span>':'')+'</div>';
}
function updateBattle(){
 const b=state.battle,me=ownActor(),actor=[...b.allies,...b.enemies].find(a=>a.id===b.currentActor),finished=b.status!=='active',myTurn=!finished&&!b.busy&&b.currentActor===session.id;
 $('#battle-title').textContent=b.area+' · 遭遇战';$('#turn-label').textContent='第'+b.round+'回合 · '+(finished?b.status==='victory'?'胜利':'不敌':b.busy&&b.lastAction?b.lastAction.text:actor?.name+'行动')+' · '+b.allies.filter(a=>a.kind==='hero').length+'人 / '+b.allies.filter(a=>a.kind==='pet').length+'宠';
 $('#turn-label').textContent+=' · 法力 '+me.mp+'/'+me.maxMp+' · 怒气 '+me.rage;
 $('#battle-log').textContent=b.log.at(-1)||'';$('#retreat').disabled=b.busy||state.party&&state.party.leader!==session.id;
 $('#battle-party').innerHTML=b.allies.map(a=>'<div class="unit-hud"><strong>'+esc(a.name)+(a.kind==='pet'?' · 宠':'')+'</strong><div class="health"><i style="width:'+a.hp/a.maxHp*100+'%"></i></div><p>生命 '+a.hp+'/'+a.maxHp+(a.kind==='hero'?'<br>法力 '+a.mp+'/'+a.maxMp+' · 怒气 '+a.rage:'')+'</p>'+statusTags(a)+'</div>').join('');
 if(!b.enemies.some(e=>e.id===selectedEnemy&&e.hp>0&&!e.captured))selectedEnemy=b.enemies.find(e=>e.hp>0&&!e.captured)?.id;
 if(!b.allies.some(a=>a.id===selectedAlly&&a.hp>0))selectedAlly=b.allies.find(a=>a.hp>0)?.id;
 $('#enemy-count').textContent='本场'+b.enemies.length+'只 · 剩余'+b.enemies.filter(e=>e.hp>0&&!e.captured).length+'只';
 $('#enemy-targets').innerHTML=b.enemies.map(e=>'<button class="target '+e.rarity+'" aria-label="选择'+e.name+'目标'+(b.enemies.indexOf(e)+1)+'" aria-pressed="'+(selectedEnemy===e.id)+'" data-target="'+e.id+'" '+(e.hp<=0?'disabled':'')+'>'+e.name+'<small>'+e.level+'级 · '+(e.captured?'已捕获':e.hp<=0?'已击败':'生命 '+e.hp+'/'+e.maxHp)+'</small>'+statusTags(e)+'</button>').join('');
 $('#enemy-targets').querySelectorAll('[data-target]').forEach(button=>button.onclick=()=>{selectedEnemy=button.dataset.target;updateBattle();});
 $('#ally-targets').innerHTML=b.allies.map(a=>'<button class="target" data-ally="'+a.id+'" aria-pressed="'+(selectedAlly===a.id)+'" '+(a.hp<=0?'disabled':'')+'>'+a.name+'<small>生命 '+a.hp+'/'+a.maxHp+'</small></button>').join('');$('#ally-targets').querySelectorAll('[data-ally]').forEach(button=>button.onclick=()=>{selectedAlly=button.dataset.ally;updateBattle();});
 const target=b.enemies.find(e=>e.id===selectedEnemy);$('#capture').textContent='捕捉'+(target?' '+Math.round(target.captureChance*100)+'%':'');
 for(const selector of ['#normal-attack','#capture','#defend'])$(selector).disabled=!myTurn;
 const info=skills.characters.find(c=>c.id===me.classId);$('#skill-buttons').innerHTML=info.skills.filter(s=>s.kind!=='passive').map(base=>{const s=resolveSkill(skills,me.classId,base.id,me.level),cd=Math.max(0,(me.cooldowns[s.id]||0)-b.round),mana=Number(s.resource.match(/^(\d+)法力/)?.[1]||0),unlocked=!!s.rank,available=myTurn&&unlocked&&cd===0&&me.mp>=mana&&(s.kind!=='ultimate'||me.rage>=100);return '<button data-skill="'+s.id+'" '+(!available?'disabled':'')+'>'+s.name+(unlocked?' · '+s.stageName:'')+'<small>'+(!unlocked?s.unlockLevel+'级开放':cd?'冷却'+cd+'回合':s.kind==='ultimate'?'100怒气':mana+'法力')+'</small></button>';}).join('');
 $('#skill-buttons').querySelectorAll('[data-skill]').forEach(button=>button.onclick=()=>command('action',{type:'skill',skillId:button.dataset.skill,targetId:me.classId==='healer-shenzhiwei'&&button.dataset.skill==='b'?selectedAlly:selectedEnemy}));
 const passive=resolveSkill(skills,me.classId,'passive',me.level);$('#passive-state').textContent='被动 · '+passive.name+(passive.rank?' · '+passive.stageName:'')+'：'+(passive.rank?passive.effect+(passive.bonusText?'；'+passive.bonusText:''):'5级开放，满足条件自动触发');
 $('#battle-controls').hidden=finished;$('#battle-result').hidden=!finished;
 $('#battle-result').classList.toggle('pending-result',finished&&b.busy);
 if(finished){$('#result-title').textContent=b.status==='victory'?'历练胜利':'返回驿站休整';$('#result-copy').textContent='获得经验 '+b.result.xp+' · 捕获宠物 '+b.result.captured+'只。'+(b.result.captured?'宠物已加入各自角色的收藏。':'');$('#return-map').disabled=b.busy||state.party&&state.party.leader!==session.id;renderLoot(b);}
}
function positions(b,w,h){
 const heroes=b.allies.filter(a=>a.kind==='hero'),out=new Map(),full=heroes.length>2;
 const heroSize=Math.min(full?165:235,h*(full?.34:.65),w*(full?.19:.32));
 b.allies.forEach(a=>{const i=heroes.findIndex(hero=>hero.id===(a.kind==='hero'?a.id:a.owner)),offset=i-(heroes.length-1)/2;
  const x=w*(.25+offset*.064),y=h*(.62+offset*.105),pet=a.kind==='pet';
  out.set(a.id,{x:x+(pet?w*.095:0),y:y+(pet?6:0),size:heroSize*(pet?.52:1)});
 });
 const count=b.enemies.length,columns=count>5?2:1,rows=Math.ceil(count/columns),size=Math.min(150,h*(count>5?.26:.42),w*(count>5?.14:.2));
 b.enemies.forEach((a,i)=>{const col=columns===2?Math.floor(i/rows):0,row=i%rows,offset=row-(rows-1)/2;
  out.set(a.id,{x:w*(.755+offset*.061+(col? .045:-.045)*(columns-1)),y:Math.min(h-28,h*(.615+offset*.095+(col?-.065:.065)*(columns-1))),size});
 });return out;
}
function renderBattle(now){
 const rect=battleCanvas.getBoundingClientRect(),w=rect.width,h=rect.height;if(!w||!h)return;
 if(battleCanvas.width!==Math.round(w*dpr)||battleCanvas.height!==Math.round(h*dpr)){battleCanvas.width=Math.round(w*dpr);battleCanvas.height=Math.round(h*dpr);}
 const b=state.battle,c=battleCtx,spots=positions(b,w,h),z=config.zones.find(z=>z.id===b.zone),units=[...b.allies,...b.enemies];c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);c.fillStyle='#d2ddc4';c.fillRect(0,0,w,h);
 const sw=Math.min(1536,w*1.2),sh=Math.min(1024,sw*h/w);
 c.save();c.globalAlpha=.86;c.filter='brightness(1.1) saturate(.8)';c.drawImage(mapImage,Math.max(0,Math.min(1536-sw,z.center[0]-sw/2)),Math.max(0,Math.min(1024-sh,z.center[1]-sh/2)),sw,sh,0,0,w,h);c.restore();c.fillStyle='#e4ead51a';c.fillRect(0,0,w,h);
 const t=visual?(now-visual.start)/visual.duration:2,active=visual&&t>=0&&t<1,actor=visual?units.find(u=>u.id===visual.actorId):null;
 const targetId=visual?.targetId||effectTargets(visual||{})[0],args={event:visual,actor,spots,units,progress:t,width:w,height:h,atlas:image('assets/skill-vfx-v1.png')};
 if(active)drawEffects(c,{...args,layer:'back'});
 for(const u of units.sort((a,d)=>spots.get(a.id).y-spots.get(d.id).y)){
  const spot={...spots.get(u.id)},hit=active&&visual.hits.some(h=>h.id===u.id&&h.type==='damage'),acting=active&&u.id===visual.actorId;
  let pose='idle',time=0,alpha=u.hp<=0?.22:1;
  if(active&&t<.57&&previousHp[u.id]>0)alpha=1;
  if(acting){const action=actionPose(visual,u,t,spot,spots.get(targetId));pose=action.pose;time=action.time;spot.x+=action.x;spot.y+=action.y;alpha*=action.alpha;}
  else if(hit&&t>.5&&t<.88){pose='hit';time=(t-.5)*visual.duration;spot.x+=(u.kind==='enemy'?9:-7)*Math.sin((t-.5)/.38*Math.PI);}
  if(u.stealth)alpha*=.6;c.save();if(hit&&t>.51&&t<.58)c.filter='brightness(1.6)';
  if(u.kind==='hero')drawHero(c,u.classId,spot.x,spot.y,spot.size,pose,time,false,alpha);else drawCreature(c,u.species,u.rarity,spot.x,spot.y,spot.size,u.kind==='pet',alpha);c.restore();
  const shownHp=active&&t<.5&&previousHp[u.id]!==undefined?previousHp[u.id]:u.hp,bar=Math.min(68,spot.size*.65);c.fillStyle='#34422acc';c.fillRect(spot.x-bar/2,spot.y+6,bar,4);c.fillStyle=u.kind==='enemy'?'#b98d64':'#809f6b';c.fillRect(spot.x-bar/2,spot.y+6,Math.max(0,bar*shownHp/u.maxHp),4);label(c,u.name,spot.x,spot.y+22,u.rarity?config.rarities[u.rarity].color:'#fff5d7',w<600?9:11);
  if(u.id===selectedEnemy&&u.hp>0){c.strokeStyle='#f3db9c';c.lineWidth=2;c.beginPath();c.ellipse(spot.x,spot.y+3,bar*.65,Math.min(14,bar*.25),0,0,Math.PI*2);c.stroke();}
 }
 if(active)drawEffects(c,args);
 if(active&&t>.5){
  const seen=new Map();for(const hit of visual.hits){const spot=spots.get(hit.id);if(!spot||hit.type==='shield')continue;const index=seen.get(hit.id)||0;seen.set(hit.id,index+1);const at=.5+index*.055;if(t<at||t>at+.32)continue;
   const value=hit.type==='capture'?'捕获':hit.type==='heal'?'+'+hit.value:hit.type==='mana'?'法力 +'+hit.value:'−'+hit.value;
   label(c,value,spot.x+(index%2?12:-8),spot.y-spot.size*.66-(t-at)*45-index*14,hit.type==='heal'?'#deffd4':hit.type==='mana'?'#d1e9ff':hit.type==='capture'?'#ffe8ab':'#fff1d9',Math.max(14,Math.min(22,h*.06)));
  }
 }
 const caption=$('#effect-caption');caption.hidden=!active;
 if(active){caption.querySelector('strong').textContent=visual.skillName+(visual.skillRank?' · '+['一阶','二阶','三阶'][visual.skillRank-1]:'');caption.querySelector('span').textContent=t<.23?'凝气 · 蓄势':t<.5?'出招':t<.83?'命中 · '+(visual.passiveTriggered?'被动触发':visual.kind==='capture'?'缔结灵契':visual.kind==='item'?'恢复补给':'招式生效'):'收势';}
}
function renderWorld(now){
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle='#263c30';ctx.fillRect(0,0,width,height);
 camera.x=Math.max(0,Math.min(config.world.width-width/zoom,pos.x-width/zoom*.5));camera.y=Math.max(0,Math.min(config.world.height-height/zoom,pos.y-height/zoom*.47));
 ctx.save();ctx.scale(zoom,zoom);ctx.translate(-camera.x,-camera.y);ctx.drawImage(mapImage,0,0,config.world.width,config.world.height);
 for(const z of config.zones){label(ctx,z.area+' · '+z.level+'级 '+z.name,z.center[0],z.center[1]-95,'#fff8d4',15);}
 label(ctx,'石溪驿站 · 安全区',245,730,'#fff6d9',15);
 if(path.length){ctx.save();ctx.strokeStyle='#f1e9a465';ctx.setLineDash([7,9]);ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(pos.x,pos.y);for(const p of path)ctx.lineTo(p.x,p.y);ctx.stroke();ctx.restore();}
 const entities=[];const members=state.party?.members||[state.player],leader=members.find(p=>p.id===state.party?.leader)||state.player,leaderPos=leader.id===session.id?pos:{x:leader.x,y:leader.y};
 if(!leaderTrail.length||distance(leaderTrail.at(-1),leaderPos)>12){leaderTrail.push({...leaderPos});if(leaderTrail.length>150)leaderTrail.shift();}
 let followers=0;for(const p of members){let at=p.id===session.id?pos:{x:p.x,y:p.y},moving=p.id===session.id?walking:false,mirror=p.id===session.id?facing<0:false;
  if(p.npc){followers++;const target=leaderTrail.length>followers*4?leaderTrail[leaderTrail.length-1-followers*4]:{x:leaderPos.x+(followers-(members.filter(m=>m.npc).length+1)/2)*42,y:leaderPos.y+48+(followers%2)*15},before=npcPositions.get(p.id)||target,travel=distance(target,before);moving=travel>.3;mirror=target.x<before.x;const ratio=travel?Math.min(1,2.4/travel):1;at={x:before.x+(target.x-before.x)*ratio,y:before.y+(target.y-before.y)*ratio};npcPositions.set(p.id,{...at});}entities.push({...p,...at,entity:'hero',moving,mirror});
  const pet=p.pets.find(q=>q.id===p.equippedPet);if(pet){const petAt=p.id===session.id&&leaderTrail.length>5?leaderTrail[leaderTrail.length-5]:{x:at.x-35,y:at.y+23};entities.push({...pet,...petAt,entity:'pet'});}
 }
 entities.sort((a,b)=>a.y-b.y).forEach(e=>{if(e.entity==='hero'){drawHero(ctx,e.classId,e.x,e.y,106,e.moving?'walk':'idle',now,e.mirror);label(ctx,e.name,e.x,e.y+20,'#fff3ca',e.npc?10:12);}else{drawCreature(ctx,e.species,e.rarity,e.x,e.y,48,true);label(ctx,e.name||'随行宠物',e.x,e.y+18,config.rarities[e.rarity].color,11);}});ctx.restore();
 const mini=$('#mini').getContext('2d');mini.clearRect(0,0,180,120);mini.drawImage(mapImage,0,0,180,120);config.zones.forEach(z=>{mini.fillStyle='#f7eac0';mini.beginPath();mini.arc(z.center[0]/1536*180,z.center[1]/1024*120,3,0,7);mini.fill();});mini.fillStyle='#fff';mini.strokeStyle='#305c3a';mini.lineWidth=2;mini.beginPath();mini.arc(pos.x/1536*180,pos.y/1024*120,4,0,7);mini.fill();mini.stroke();
}
async function sendPosition(now){if(sendingMove||now-lastMove<170||distance(pos,lastSent)<2||state.battle)return;lastMove=now;sendingMove=true;const sent={...pos};try{await request('move',sent);lastSent=sent;}catch(error){if(!state.battle)toast(error.message);}finally{sendingMove=false;}}
function animate(now){
 const dt=Math.min(.05,(now-lastTime)/1000);lastTime=now;
 if(state){if(!state.battle){let vx=stick.x+(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0),vy=stick.y+(keys.has('s')||keys.has('arrowdown')?1:0)-(keys.has('w')||keys.has('arrowup')?1:0);if(modalOpen()){vx=0;vy=0;}else if(path.length&&Math.hypot(vx,vy)<.1){const next=path[0],dist=distance(pos,next);if(dist<5){path.shift();}else{vx=(next.x-pos.x)/dist;vy=(next.y-pos.y)/dist;}}
  const length=Math.hypot(vx,vy);walking=length>.08&&!modalOpen();if(walking){vx/=Math.max(1,length);vy/=Math.max(1,length);if(Math.abs(vx)>.12)facing=vx>0?1:-1;const next={x:pos.x+vx*146*dt,y:pos.y+vy*146*dt};if(canWalk(next))pos=next;else{const x={x:next.x,y:pos.y},y={x:pos.x,y:next.y};if(canWalk(x))pos=x;if(canWalk(y))pos=y;}}
  sendPosition(now);renderWorld(now);if(now-lastHud>180){updateHud();lastHud=now;}
 }else renderBattle(now);skillPanel?.animate(now);}requestAnimationFrame(animate);
}
function resize(){if(!config)return;const rect=world.getBoundingClientRect();width=rect.width;height=rect.height;dpr=Math.min(2,devicePixelRatio);world.width=Math.round(width*dpr);world.height=Math.round(height*dpr);zoom=Math.max(.6,Math.min(1,Math.max(width/980,height/config.world.height)));}
window.addEventListener('resize',resize);
window.addEventListener('keydown',event=>{const key=event.key.toLowerCase();if(modalOpen()||event.target.matches('input,select'))return;if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)){event.preventDefault();keys.add(key);path=[];}});
window.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));window.addEventListener('blur',()=>{keys.clear();stick={x:0,y:0};$('#knob').style.transform='';});
const joystick=$('#joystick');let pointer=null;
function updateStick(event){const rect=joystick.getBoundingClientRect(),x=event.clientX-rect.left-rect.width/2,y=event.clientY-rect.top-rect.height/2,limit=rect.width*.3,r=Math.hypot(x,y),scale=r>limit?limit/r:1;stick={x:x*scale/limit,y:y*scale/limit};$('#knob').style.transform='translate('+x*scale+'px,'+y*scale+'px)';path=[];}
joystick.onpointerdown=event=>{if(state?.battle)return;pointer=event.pointerId;joystick.setPointerCapture(pointer);updateStick(event);};joystick.onpointermove=event=>{if(event.pointerId===pointer)updateStick(event);};joystick.onpointerup=joystick.onpointercancel=()=>{pointer=null;stick={x:0,y:0};$('#knob').style.transform='';};
world.onpointerup=event=>{if(!state||state.battle||modalOpen())return;const rect=world.getBoundingClientRect(),target={x:(event.clientX-rect.left)/zoom+camera.x,y:(event.clientY-rect.top)/zoom+camera.y};if(canWalk(target))navigate(target);else toast('溪水和山石无法通行，请沿小径走。');};
for(const [id,name] of [['skills-open','skills'],['equipment-open','equipment'],['team-open','team'],['pets-open','pets'],['bag-open','bag'],['result-equipment','equipment'],['result-pets','pets'],['result-bag','bag']])$('#'+id).onclick=()=>openPanel(name);
document.querySelectorAll('[data-panel]').forEach(button=>button.onclick=()=>openPanel(button.dataset.panel));
$('#equipment-auto').onclick=async()=>{if(await command('equipment/auto'))toast('已穿戴各部位当前可用的最佳装备。');};
$('#mini-open').onclick=()=>openDialog('#regions-dialog');$('#normal-attack').onclick=()=>command('action',{type:'normal',targetId:selectedEnemy});$('#capture').onclick=()=>command('action',{type:'capture',targetId:selectedEnemy});$('#defend').onclick=()=>command('action',{type:'defend'});$('#retreat').onclick=()=>command('battle/retreat');$('#return-map').onclick=()=>command('battle/finish');
$('#settings-open').onclick=()=>{if(state.battle){toast('战斗结束后可以调整试玩设置');return;}$('#class-picker').value=state.player.classId;$('#level-picker').value=String(Math.min(skills.trialMaxLevel,state.player.level));openDialog('#settings-dialog');};
$('#settings-form').onsubmit=async event=>{event.preventDefault();const result=await command('settings',{classId:$('#class-picker').value,level:Number($('#level-picker').value)});if(result){await preloadClass(result.player.classId);$('#settings-dialog').close();toast('试玩设置已应用，宠物收藏保留。');}};
function updateFormation(){
 const zone=config.zones.find(z=>z.id===$('#formation-species').value),withPets=$('#formation-pets').checked;
 const heroes=config.classes.map(c=>({...c,id:'preview-'+c.id,classId:c.id,kind:'hero',level:15,hp:400,maxHp:400}));
 const pets=withPets?heroes.map((hero,i)=>({id:'preview-pet-'+i,owner:hero.id,kind:'pet',species:config.zones[i].id,rarity:'baby',name:'宝宝'+config.zones[i].name,hp:200,maxHp:200})):[];
 const enemies=Array.from({length:10},(_,i)=>{const rarity=i===8?'baby':i===9?'mutant':'normal';return {id:'preview-enemy-'+i,kind:'enemy',species:zone.id,rarity,name:config.rarities[rarity].name+zone.name+' '+(i+1),level:zone.level,hp:300,maxHp:300};});
 state={battle:{zone:zone.id,allies:[...heroes,...pets],enemies}};
 $('#turn-label').textContent='我方 5人'+(withPets?'＋5只宠物':'')+' · 敌方 10只怪物 · '+zone.area;
 $('#battle-canvas').setAttribute('aria-label','满员站位：五个职业'+(withPets?'和五只宠物':'')+'对阵十只'+zone.name+'，敌方两列各五只');
 $('#formation-roster').innerHTML='<span>我方：'+heroes.map(h=>h.name+'（'+h.profession+'）').join('、')+'</span><span>敌方：8只普通、1只宝宝、1只变异'+(withPets?' · 每人携带1只宝宝':'')+'</span>';
}
async function startFormation(){
 document.body.classList.add('formation-preview');document.title='满员战斗站位 · 我的修仙日记';$('#battle').hidden=false;$('#formation-tools').hidden=false;
 $('#battle-title').textContent='五人满队 · 十怪站位';$('#formation-species').innerHTML=config.zones.map(z=>'<option value="'+z.id+'">'+z.level+'级 '+z.name+'</option>').join('');$('#formation-species').value='wolf';
 $('#formation-species').onchange=$('#formation-pets').onchange=updateFormation;updateFormation();
 $('.below').textContent='左右相对的斜阵 · 敌方两列各五只 · 可切换怪物与宠物查看站位';
 await Promise.all([loaded(mapImage),...config.classes.map(c=>loaded(atlas(c.id,'idle'))),...config.zones.flatMap(z=>Object.keys(config.rarities).map(q=>loaded(image('assets/'+z.id+'-'+q+'.png'))))]);
 $('#loading').style.display='none';resize();requestAnimationFrame(animate);
}
async function start(){
 [config,manifest,skills,equipmentData,itemsData]=await Promise.all(['config.json','../character-animation-v3/manifest.json','../character-animation-v3/skills.json','equipment.json','items.json'].map(url=>fetch(url).then(r=>r.json())));
 $('#class-picker').innerHTML=config.classes.map(c=>'<option value="'+c.id+'">'+c.name+' · '+c.profession+'</option>').join('');for(let level=1;level<=skills.trialMaxLevel;level++)$('#level-picker').add(new Option(level+'级',String(level)));
 $('#zone-list').innerHTML=config.zones.map(z=>'<article class="zone"><img src="assets/'+z.id+'-normal.png" alt="'+z.name+'"><div><strong>'+z.area+'</strong><p>'+z.level+'级 · '+z.name+' · 普通 / 宝宝 / 变异</p></div><button data-zone="'+z.id+'" aria-label="前往'+z.level+'级'+z.name+'区域">前往</button></article>').join('');$('#zone-list').querySelectorAll('[data-zone]').forEach(button=>button.onclick=()=>{const z=config.zones.find(z=>z.id===button.dataset.zone);$('#regions-dialog').close();if(state.battle){toast('结束战斗后再前往新区域');return;}navigate(point(z.center));});
 mapImage=image('assets/map.png');image('assets/skill-vfx-v1.png');
 systemsPanels=createSystemsPanels({config,equipment:equipmentData,items:itemsData,getState:()=>state,command,openEquipment,toast,gearIcon,gearStats});
 skillPanel=createSkillPanel({config,skills,getState:()=>state,command,getTargets:()=>({selectedEnemy,selectedAlly}),toast,drawHero,drawCreature,label,image,getMap:()=>mapImage,preloadClass});
 document.querySelectorAll('[data-panel-tabs]').forEach(nav=>{nav.innerHTML=[['skills','技能'],['equipment','装备'],['team','队伍'],['pets','宠物'],['bag','行囊']].map(([name,label])=>'<button data-panel="'+name+'" '+(nav.dataset.panelTabs===name?'aria-current="page"':'')+'>'+label+'</button>').join('');nav.querySelectorAll('button').forEach(button=>button.onclick=()=>openPanel(button.dataset.panel));});
 const url=new URL(location.href),room=url.searchParams.get('room');if(url.searchParams.get('formation')==='1'){await startFormation();return;}if(url.searchParams.get('new')==='1'){sessionStorage.removeItem('firstMapSession');url.searchParams.delete('new');history.replaceState(null,'',url);}
 const old=JSON.parse(sessionStorage.getItem('firstMapSession')||'null'),login=await request('session',old||{classId:'swordsman-luqinglan'},false);session=login.session;sessionStorage.setItem('firstMapSession',JSON.stringify(session));applyState(login);
 eventStream=new EventSource('/api/events?id='+encodeURIComponent(session.id)+'&token='+encodeURIComponent(session.token));eventStream.onmessage=event=>applyState(JSON.parse(event.data));let lost=false;eventStream.onerror=()=>{if(!lost){toast('联机连接暂时断开，正在重连。');lost=true;}};eventStream.onopen=()=>{lost=false;};
 if(room&&!state.party)await command('team/join',{code:room});
 await Promise.all([loaded(mapImage),preloadClass(state.player.classId),...config.zones.flatMap(z=>Object.keys(config.rarities).map(q=>loaded(image('assets/'+z.id+'-'+q+'.png'))))]);
 $('#loading').style.display='none';resize();requestAnimationFrame(animate);
}
start().catch(error=>{$('#loading').textContent=error.message+'。请确认本地服务运行后刷新页面。';console.error(error);});

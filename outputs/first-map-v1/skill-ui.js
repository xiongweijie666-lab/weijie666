import {actionDuration,skillArt,actionPose,drawEffects} from './combat-art.mjs';
import {resolveSkill} from './skill-growth.mjs';

export function createSkillPanel({config,skills,getState,command,getTargets,toast,drawHero,drawCreature,label,image,getMap,preloadClass}){
 const $=selector=>document.querySelector(selector),esc=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let classId=null,skillId='a',signature='',event=null,elapsed=0,started=0,paused=false,lastFrame=0;
 const atlas=image('assets/skill-vfx-v1.png'),canvas=$('#skill-preview'),ctx=canvas.getContext('2d');
 const info=()=>skills.characters.find(c=>c.id===classId);
 const selected=()=>resolveSkill(skills,classId,skillId,getState().player.level);
 const names={active:'主动技能',passive:'被动技能',ultimate:'终极技能'};
 function reason(skill){
  const state=getState(),p=state.player,b=state.battle,actor=b?.allies.find(a=>a.id===p.id);
  if(classId!==p.classId)return '当前查看其他职业';
  if(p.level<skill.unlockLevel)return skill.unlockLevel+'级开放';
  if(skill.kind==='passive')return '满足条件自动触发';
  if(!b)return '进入战斗后可释放';
  if(b.status!=='active')return '战斗已结束';
  if(b.busy)return '正在演出招式';
  if(b.currentActor!==p.id)return '等待自己的回合';
  if(actor.hp<=0)return '角色已倒下';
  if(skill.kind==='ultimate'&&actor.rage<100)return '需要100怒气';
  const cost=Number(skill.resource.match(/^(\d+)法力/)?.[1]||0),cd=Math.max(0,(actor.cooldowns[skill.id]||0)-b.round);
  if(cd)return '冷却剩余'+cd+'回合';if(actor.mp<cost)return '法力不足';
  return '';
 }
 function render(force=false){
  if(!classId)classId=getState().player.classId;
  const state=getState(),p=state.player,chosen=selected(),sig=JSON.stringify([classId,skillId,p.classId,p.level,state.battle?.round,state.battle?.currentActor,state.battle?.busy,state.battle?.status,state.battle?.allies.find(a=>a.id===p.id)]);
  if(!force&&sig===signature)return;signature=sig;
  const character=info(),art=skillArt[classId],own=classId===p.classId;
  $('#skill-class-picker').value=classId;
  $('#skill-normal').textContent='普通攻击基础 · 1级可用：'+character.normalAttack.effect+'。'+(own?'当前'+p.level+'级。':'按'+p.level+'级查看此职业。');
  $('#skill-list').innerHTML=character.skills.map(base=>{const s=resolveSkill(skills,classId,base.id,p.level);return '<button class="skill-card '+s.kind+(!s.rank?' skill-locked':'')+'" data-preview-skill="'+s.id+'" aria-label="查看'+s.name+'，'+s.unlockLevel+'级'+names[s.kind]+'" aria-pressed="'+(s.id===skillId)+'" style="--skill-color:'+art.color+'"><span class="skill-emblem">'+(s.kind==='ultimate'?'极':s.kind==='passive'?'心':s.id==='a'?'一':'三')+'</span><span><strong>'+s.name+'</strong><small class="skill-brief">'+esc(s.effect)+'</small><small class="skill-next">'+(s.nextLevel?s.nextLevel+'级'+(s.rank?'提升':'解锁'):'已达三阶')+'</small></span><span>'+s.stageName+'<br>'+names[s.kind]+'</span></button>';}).join('');
  $('#skill-list').querySelectorAll('[data-preview-skill]').forEach(button=>button.onclick=()=>{skillId=button.dataset.previewSkill;event=null;elapsed=0;$('#preview-progress').value=0;$('#preview-pause').disabled=true;render(true);});
  $('#skill-theme').textContent=art.theme;$('#skill-preview-title').textContent=chosen.name+' · '+chosen.stageName;
  const stageMarkup=chosen.stages.map(stage=>'<span class="'+(stage.rank===chosen.rank?'current':stage.level<=p.level?'achieved':'future')+'"><strong>'+stage.name+'</strong><small>'+stage.level+'级'+(stage.rank===chosen.rank?' · 当前':'')+'</small></span>').join('');
  $('#skill-detail').innerHTML='<div class="skill-stages" aria-label="技能三段成长">'+stageMarkup+'</div><p class="skill-resource">'+chosen.unlockLevel+'级开放 · '+names[chosen.kind]+' · '+(chosen.resource==='无'?'自动触发，无消耗':chosen.resource)+'</p><p>'+esc(chosen.effect).replace(/(\d+(?:\.\d+)?(?:%|段|回合))/g,'<span class="skill-number">$1</span>')+'</p>'+(chosen.bonusText?'<p class="skill-bonus"><b>附加效果</b> '+esc(chosen.bonusText)+'</p>':'')+'<p class="skill-growth-next">'+(chosen.nextLevel?'下一阶段：'+chosen.nextLevel+'级'+(chosen.rank?'提升':'解锁'):'三阶已达成')+'</p><details class="skill-stage-comparison"><summary>对比三个阶段</summary>'+chosen.stages.map(stage=>'<div><strong>'+stage.name+' · '+stage.level+'级</strong><p>'+esc(stage.effect)+'</p>'+(stage.bonusText?'<p class="skill-bonus">附加：'+esc(stage.bonusText)+'</p>':'')+'</div>').join('')+'</details>';
  $('#preview-play').textContent=chosen.kind==='passive'?'试演被动触发':'试演技能';
  const why=reason(chosen);$('#skill-cast').disabled=!!why;$('#skill-cast-reason').textContent=why||(classId==='healer-shenzhiwei'&&skillId==='b'?'对已选己方目标治疗':'对已选战斗目标释放');
  $('#skill-preview-caption').textContent=event?phase(elapsed/event.durationMs):'站姿固定 · 点击试演查看招式';
 }
 function phase(p){return p<.23?'蓄力':p<.5?'出招':p<.83?'命中与效果':'余光消散';}
 function play(){
  const s=selected(),healing=classId==='healer-shenzhiwei'&&(s.id==='b'||s.id==='ultimate');
  event={actorId:'demo-hero',kind:s.kind==='passive'?'normal':'skill',skillId:s.id,skillName:s.name,stageName:s.stageName,skillRank:s.kind==='passive'?undefined:s.rank||1,passiveRank:s.kind==='passive'?s.rank||1:undefined,durationMs:actionDuration(classId,s.kind==='passive'?'normal':'skill',s.id),targetId:healing?'demo-ally-1':'demo-enemy-0',targets:healing?s.id==='ultimate'?['demo-hero','demo-ally-1','demo-ally-2','demo-enemy-0','demo-enemy-1','demo-enemy-2']:['demo-ally-1']:s.id==='b'&&classId!=='assassin-xieqian'||s.id==='ultimate'&&['saber-hanpoyue','mage-suyingyue'].includes(classId)||s.id==='a'&&classId==='mage-suyingyue'?['demo-enemy-0','demo-enemy-1','demo-enemy-2']:['demo-enemy-0'],hits:[],passiveTriggered:s.kind==='passive',bonusEffects:[]};
  for(const effect of s.bonusEffects){const ids=effect.target==='self'?['demo-hero']:effect.target==='target'?[event.targetId]:event.targets.filter(id=>effect.target==='enemies'?id.startsWith('demo-enemy'):!id.startsWith('demo-enemy'));for(const id of ids){if(!event.targets.includes(id))event.targets.push(id);event.bonusEffects.push({id,type:effect.type});}}
  started=performance.now();elapsed=0;paused=false;$('#preview-pause').disabled=false;$('#preview-pause').textContent='暂停';
 }
 function animate(now){
  if(!$('#skills-dialog').open||!classId)return;
  if(event&&!paused){elapsed=Math.min(event.durationMs,now-started);if(elapsed>=event.durationMs){paused=true;$('#preview-pause').textContent='继续';}}
  const p=event?elapsed/event.durationMs:0,rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height,dpr=Math.min(2,devicePixelRatio);
  if(!w||!h)return;if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const map=getMap();if(map?.complete){ctx.save();ctx.filter='brightness(1.06) saturate(.75)';ctx.drawImage(map,550,80,780,520,0,0,w,h);ctx.restore();}else{ctx.fillStyle='#c9d5c0';ctx.fillRect(0,0,w,h);}
  const healer=classId==='healer-shenzhiwei'&&['b','ultimate'].includes(skillId),hero={id:'demo-hero',kind:'hero',classId,name:info().name,hp:150,maxHp:240},heroSize=Math.min(h*.78,w*.3),spots=new Map([[hero.id,{x:w*.21,y:h*.78,size:heroSize}]]),units=[hero];
  for(let i=0;i<3;i++){const u={id:'demo-enemy-'+i,kind:'enemy',species:'wolf',rarity:'normal',name:'训练灵影',hp:240,maxHp:240};spots.set(u.id,{x:w*(.64+i*.105),y:h*(.48+i*.155),size:Math.min(h*.42,w*.16)});units.push(u);}
  if(healer)for(let i=1;i<=2;i++){const u={id:'demo-ally-'+i,kind:'hero',classId:i===1?'swordsman-luqinglan':'saber-hanpoyue',name:i===1?'陆青岚':'韩破岳',hp:120,maxHp:240};spots.set(u.id,{x:w*(.17+i*.12),y:h*(.49+i*.13),size:heroSize*.65});units.push(u);}
  const args={event,actor:hero,spots,units,progress:p,width:w,height:h,atlas};if(event)drawEffects(ctx,{...args,layer:'back'});
  for(const unit of units.sort((a,b)=>spots.get(a.id).y-spots.get(b.id).y)){
   const spot=spots.get(unit.id),pose=event&&unit.id===hero.id?actionPose(event,hero,p,spot,spots.get(event.targetId)):{pose:'idle',time:0,x:0,y:0,alpha:1};
   if(unit.kind==='hero')drawHero(ctx,unit.classId,spot.x+pose.x,spot.y+pose.y,spot.size,pose.pose,pose.time,false,pose.alpha);else drawCreature(ctx,'wolf','normal',spot.x,spot.y,spot.size);
   label(ctx,unit.name,spot.x,spot.y+14,unit.kind==='hero'?'#fff4db':'#ecedcc',w<500?8:10);
  }
  if(event)drawEffects(ctx,args);
  if(event&&p>.54&&p<.86){const target=spots.get(event.targetId);if(target&&classId==='healer-shenzhiwei'&&skillId==='b')label(ctx,'治疗 · 无伤害',target.x,target.y-75*(h/250),'#d6ffd1',12);else if(classId==='mage-suyingyue'&&skillId==='b')label(ctx,'月缚 · 持续伤害',target.x,target.y-55*(h/250),'#f1defc',11);}
  if(now-lastFrame>60){$('#preview-progress').value=Math.round(p*1000);$('#skill-preview-caption').textContent=event?phase(p):'站姿固定 · 点击试演查看招式';lastFrame=now;}
 }
 $('#skill-class-picker').innerHTML=config.classes.map(c=>'<option value="'+c.id+'">'+c.name+' · '+c.profession+'</option>').join('');
 $('#skill-class-picker').onchange=async()=>{classId=$('#skill-class-picker').value;skillId='a';event=null;render(true);await preloadClass(classId);};
 $('#preview-play').onclick=play;
 $('#preview-pause').onclick=()=>{if(!event)return;paused=!paused;if(!paused){if(elapsed>=event.durationMs)elapsed=0;started=performance.now()-elapsed;}$('#preview-pause').textContent=paused?'继续':'暂停';};
 $('#preview-progress').oninput=()=>{if(!event)play();paused=true;elapsed=Number($('#preview-progress').value)/1000*event.durationMs;$('#preview-pause').textContent='继续';};
 $('#skill-cast').onclick=async()=>{const s=selected(),why=reason(s);if(why){toast(why);return;}const targets=getTargets(),targetId=classId==='healer-shenzhiwei'&&s.id==='b'?targets.selectedAlly:targets.selectedEnemy;if(await command('action',{type:'skill',skillId:s.id,targetId}))$('#skills-dialog').close();};
 return {render,animate,open(){classId=getState().player.classId;skillId='a';event=null;elapsed=0;$('#preview-pause').disabled=true;render(true);preloadClass(classId);}};
}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolveFrame,actionDuration,effectTargets,actionPose,skillArt,targetEffect,drawEffects} from './combat-art.mjs';
const manifest=JSON.parse(fs.readFileSync(new URL('../character-animation-v3/manifest.json',import.meta.url),'utf8'));

test('all five approved standing poses stay still regardless of elapsed time',()=>{
 for(const character of manifest.characters){
  const idle=character.clips.find(c=>c.id==='idle');
  for(const time of [0,80,250,500,850,1000,3400,100000])assert.equal(resolveFrame(idle,time),0,character.id);
 }
});

test('movement retains 12 drawings per second and action clips retain 18',()=>{
 for(const character of manifest.characters){
  const walk=character.clips.find(c=>c.id==='walk');
  assert.equal(walk.fps,12);assert.equal(resolveFrame(walk,83.4),1);assert.equal(resolveFrame(walk,walk.durationMs+.1),0);
  for(const name of ['attack','cast','hit']){
   const clip=character.clips.find(c=>c.id===name);
   assert.equal(clip.fps,18);assert.equal(resolveFrame(clip,55.6),1);assert.equal(resolveFrame(clip,100000),clip.frames.length-1);
  }
 }
});

test('major skills have time for anticipation, impact and a tail',()=>{
 for(const character of manifest.characters){
  assert.ok(actionDuration(character.id,'skill','ultimate')>=2200);
  assert.ok(actionDuration(character.id,'skill','a')>actionDuration(character.id,'normal'));
 }
 assert.equal(actionDuration(null,'item'),1250);
});

test('status-only and full-health healing casts still have visible effect targets',()=>{
 assert.deepEqual(effectTargets({targetId:'enemy',targets:['enemy','neighbor'],hits:[]}),['enemy','neighbor']);
 assert.deepEqual(effectTargets({targetId:'ally',targets:['ally','caster'],hits:[]}),['ally','caster']);
 assert.deepEqual(effectTargets({targetId:'enemy',hits:[{id:'enemy'},{id:'extra'}]}),['enemy','extra']);
});

test('all fifteen active skills use distinct painted effect cells',()=>{
 const cells=Object.values(skillArt).flatMap(art=>Object.values(art.cells));
 assert.equal(cells.length,15);assert.equal(new Set(cells).size,15);
});

test('healer passive heals the caster while the same normal attack hits the enemy',()=>{
 const actor={id:'healer',classId:'healer-shenzhiwei'},enemy={id:'enemy',kind:'enemy'},event={actorId:actor.id,kind:'normal',passiveTriggered:true,targets:['enemy','healer'],hits:[{id:'enemy',type:'damage',value:20},{id:'healer',type:'heal',value:6}]};
 assert.equal(targetEffect(event,actor,enemy),'damage');
 assert.equal(targetEffect(event,actor,{id:'healer',kind:'hero'}),'heal');
 event.hits=event.hits.filter(hit=>hit.type!=='heal');
 assert.equal(targetEffect(event,actor,{id:'healer',kind:'hero'}),'heal','full HP still receives a healing effect instead of a slash');
 assert.equal(targetEffect({kind:'pet-skill',hits:[]},{species:'turtle'},{id:'ally',kind:'hero'}),'support');
});

test('passive healing draws no impact texture on the healer',()=>{
 const draws=[],noop=()=>{},gradient={addColorStop:noop};
 const ctx=new Proxy({createRadialGradient:()=>gradient,createLinearGradient:()=>gradient,drawImage:(...args)=>draws.push(args)},{get:(o,k)=>k in o?o[k]:noop,set:(o,k,v)=>(o[k]=v,true)});
 const actor={id:'healer',kind:'hero',classId:'healer-shenzhiwei'},enemy={id:'enemy',kind:'enemy'},event={actorId:actor.id,kind:'normal',targets:['enemy','healer'],passiveTriggered:true,hits:[{id:'enemy',type:'damage',value:20},{id:'healer',type:'heal',value:6}]};
 const spots=new Map([['healer',{x:100,y:200,size:100}],['enemy',{x:500,y:200,size:100}]]),atlas={complete:true,naturalWidth:400,naturalHeight:400};
 drawEffects(ctx,{event,actor,spots,units:[actor,enemy],progress:.55,width:730,height:410,atlas});
 assert.equal(draws.filter(args=>args[1]===300&&args[2]===300).length,2,'only the enemy receives slash and impact');
 assert.equal(draws.filter(args=>args[1]===100&&args[2]===300).length,1,'the caster receives the healing texture');
});

test('a full-mana caster receives a recovery effect rather than a self slash',()=>{
 const actor={id:'mage',classId:'mage-suyingyue'};
 assert.equal(targetEffect({kind:'normal',hits:[],bonusEffects:[{id:'mage',type:'mana'}]},actor,{id:'mage',kind:'hero'}),'mana');
});

test('resting combatants have no translation, rotation or pose loop',()=>{
 const from={x:100,y:100},to={x:600,y:180},event={kind:'skill',skillId:'a',durationMs:1100};
 for(const classId of Object.keys(skillArt))for(const p of [-1,1,2,100])assert.deepEqual(actionPose(event,{classId},p,from,to),{pose:'idle',time:0,x:0,y:0,alpha:1});
});

test('every skill can render its full timeline without depending on a damage hit',()=>{
 const noop=()=>{},gradient={addColorStop:noop};
 const ctx=new Proxy({createRadialGradient:()=>gradient,createLinearGradient:()=>gradient},{get:(o,k)=>k in o?o[k]:noop,set:(o,k,v)=>(o[k]=v,true)});
 for(const classId of Object.keys(skillArt))for(const skillId of ['a','b','ultimate']){
  const actor={id:'caster',kind:'hero',classId},spots=new Map([['caster',{x:120,y:250,size:180}],['target',{x:500,y:260,size:130}]]),units=[actor,{id:'target',kind:classId.startsWith('healer')?'hero':'enemy'}],event={actorId:'caster',kind:'skill',skillId,skillName:skillId,targets:['target'],hits:[]};
  for(const progress of [0,.15,.3,.52,.7,.9,1])for(const layer of ['back','front'])assert.doesNotThrow(()=>drawEffects(ctx,{event,actor,spots,units,progress,width:730,height:410,layer}));
 }
});

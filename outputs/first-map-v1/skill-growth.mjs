// Shared by the battle rules and skill panels so rank and text stay in sync.
export function resolveSkill(data,classId,skillId,level){
 const skill=data.characters.find(character=>character.id===classId)?.skills.find(skill=>skill.id===skillId);
 if(!skill)return;
 const unlocked=level>=skill.unlockLevel,stage=skill.stages.filter(stage=>level>=stage.level).at(-1)||skill.stages[0];
 const next=skill.stages.find(stage=>level<stage.level);
 return {...skill,...stage,rank:unlocked?stage.rank:0,stageName:unlocked?stage.name:'未解锁',name:skill.name,nextLevel:next?.level??null};
}

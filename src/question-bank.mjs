import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const CATEGORIES = Object.freeze({all:'كل المجالات',general:'معلومات عامة',football:'كرة القدم',anime:'الأنمي',gaming:'الألعاب',history:'التاريخ',geography:'الجغرافيا',science:'العلوم والكيمياء',technology:'التقنية',math:'رياضيات وألغاز'});
export const DIFFICULTIES = Object.freeze({all:'كل المستويات',easy:'سهل',medium:'متوسط',hard:'صعب',impossible:'مستحيل'});
export function loadDefaultQuestions() {
  const data = JSON.parse(readFileSync(new URL('../data/questions.ar.json', import.meta.url),'utf8'));
  if (data.schemaVersion!==1 || data.language!=='ar') throw new Error('صيغة بنك الأسئلة غير معروفة');
  return data.questions;
}
export class QuestionBank {
  constructor(questions=loadDefaultQuestions(),random=randomInt){
    if(!Array.isArray(questions)) throw new TypeError('Question bank must be an array');
    this.questions=questions;this.used=new Set();this.random=random;
    const ids=new Set(),prompts=new Set();
    for(const q of questions){
      if(!q||typeof q.id!=='string'||!q.id||ids.has(q.id))throw new Error('Duplicate or missing question ID');
      ids.add(q.id);
      if(!Object.hasOwn(CATEGORIES,q.category)||q.category==='all')throw new Error('Unknown question category');
      if(!Object.hasOwn(DIFFICULTIES,q.difficulty)||q.difficulty==='all')throw new Error('Unknown question difficulty');
      if(typeof q.question!=='string'||!q.question.trim()||q.question.length>200||prompts.has(q.question))throw new Error('Invalid or duplicate question');
      prompts.add(q.question);
      if(!Array.isArray(q.options)||q.options.length!==4||q.options.some(x=>typeof x!=='string'||!x||x.length>80)||new Set(q.options).size!==4)throw new Error('Invalid options');
      if(!['1','2','3','4'].includes(q.answer)||typeof q.source!=='string'||!q.source)throw new Error('Invalid answer/source');
    }
  }
  validateFilter({category='all',difficulty='all'}={}){
    if(!Object.hasOwn(CATEGORIES,category)||!Object.hasOwn(DIFFICULTIES,difficulty))throw new Error('الفئة أو مستوى الصعوبة غير معروف');
    return {category,difficulty};
  }
  stats(){
    const categories=Object.fromEntries(Object.keys(CATEGORIES).filter(k=>k!=='all').map(k=>[k,{title:CATEGORIES[k],total:0,remaining:0}]));
    const difficulties=Object.fromEntries(Object.keys(DIFFICULTIES).filter(k=>k!=='all').map(k=>[k,{title:DIFFICULTIES[k],total:0,remaining:0}]));
    for(const q of this.questions){categories[q.category].total++;difficulties[q.difficulty].total++;if(!this.used.has(q.id)){categories[q.category].remaining++;difficulties[q.difficulty].remaining++;}}
    return {total:this.questions.length,used:this.used.size,remaining:this.questions.length-this.used.size,categories,difficulties};
  }
  draw(filter={}){
    const {category,difficulty}=this.validateFilter(filter);
    const available=this.questions.filter(q=>!this.used.has(q.id)&&(category==='all'||q.category===category)&&(difficulty==='all'||q.difficulty===difficulty));
    if(!available.length)throw new Error('لا توجد أسئلة جديدة لهذه الفئة والمستوى. اختر فئة أخرى أو أعد ضبط سجل الأسئلة.');
    const i=this.random(available.length);
    if(!Number.isInteger(i)||i<0||i>=available.length)throw new Error('Random question index out of range');
    const q=available[i];this.used.add(q.id);return {...q,options:[...q.options]};
  }
  reset(){this.used.clear();return this.stats();}
}
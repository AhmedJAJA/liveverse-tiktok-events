import test from 'node:test';
import assert from 'node:assert/strict';
import {QuestionBank,loadDefaultQuestions,CATEGORIES,DIFFICULTIES} from '../src/question-bank.mjs';
import {Engine} from '../src/engine.mjs';
const data=loadDefaultQuestions();
const make=()=>new QuestionBank(data,()=>0);
test('bank includes at least 1,200 Arabic questions',()=>assert.ok(data.length>=1200));
test('all IDs and question prompts unique',()=>{assert.equal(new Set(data.map(x=>x.id)).size,data.length);assert.equal(new Set(data.map(x=>x.question)).size,data.length)});
test('bank schema validates',()=>assert.doesNotThrow(make));
test('nine domains represented',()=>{for(const k of Object.keys(CATEGORIES).filter(x=>x!=='all'))assert.ok(data.some(q=>q.category===k),k)});
test('all four levels represented',()=>{for(const k of Object.keys(DIFFICULTIES).filter(x=>x!=='all'))assert.ok(data.some(q=>q.difficulty===k),k)});
test('all questions include a proper answer and four unique choices',()=>{for(const q of data){assert.ok(q.question.endsWith('؟'));assert.equal(q.options.length,4);assert.equal(new Set(q.options).size,4);assert.ok(['1','2','3','4'].includes(q.answer))}});
test('sources are HTTPS references or calculated',()=>{for(const q of data)assert.ok(q.source==='calculated'||q.source.startsWith('https://'))});
test('no question repeats during a session',()=>{const bank=make();const ids=new Set();for(let i=0;i<110;i++){const q=bank.draw();assert.ok(!ids.has(q.id));ids.add(q.id);}assert.equal(bank.stats().used,110)});
test('filters return only requested categories and difficulties',()=>{const bank=make();for(const category of Object.keys(CATEGORIES).filter(x=>x!=='all'))assert.equal(bank.draw({category}).category,category);for(const difficulty of Object.keys(DIFFICULTIES).filter(x=>x!=='all'))assert.equal(bank.draw({difficulty}).difficulty,difficulty)});
test('unknown category or difficulty are blocked',()=>{const bank=make();assert.throws(()=>bank.draw({category:'invalid'}));assert.throws(()=>bank.draw({difficulty:'invalid'}))});
test('exhaustion and reset controls work',()=>{const bank=new QuestionBank(data.filter(q=>q.category==='general').slice(0,3),()=>0);for(let i=0;i<3;i++)bank.draw();assert.throws(()=>bank.draw(),/لا توجد أسئلة/);bank.reset();assert.equal(bank.stats().used,0)});
test('public game state hides the correct answer',()=>{const q=make().draw();const engine=new Engine();engine.configure({mode:'quiz',prompt:q.question,options:q.options,answer:q.answer});assert.equal(engine.snapshot().status.answer,undefined);assert.ok(!JSON.stringify(engine.snapshot()).includes('"answer"'))});
test('correct selection from bank scores winner',()=>{const q=make().draw({category:'geography'});const e=new Engine();e.configure({mode:'quiz',prompt:q.question,options:q.options,answer:q.answer});e.start();e.receiveChat({id:'1',username:'A',text:q.answer});e.stop();assert.equal(e.status.results.rankings[0].name,'A')});
test('bank statistics never leak answer keys',()=>{const s=JSON.stringify(make().stats());assert.equal(s.includes('options'),false);assert.equal(s.includes('"answer"'),false)});
test('439 generated arithmetic questions have independent correct evaluation',()=>{
  let checked=0;
  for(const q of data.filter(x=>x.category==='math')){
    const text=q.question,nums=[...text.matchAll(/\d+/g)].map(x=>Number(x[0]));let value;
    if(text.startsWith('كم يساوي')){
      if(text.includes(' + '))value=nums[0]+nums[1];
      if(text.includes(' - '))value=nums[0]-nums[1];
      if(text.includes(' × '))value=nums[0]*nums[1];
      if(text.includes(' ÷ '))value=nums[0]/nums[1];
    }else if(text.startsWith('ما قيمة 20٪'))value=nums[1]/5;
    else if(text.includes(' × 2'))value=nums[0]+nums[1]*2;
    else if(text.startsWith('ما ناتج'))value=(nums[0]+nums[1])*nums[2];
    assert.equal(Number(q.options[Number(q.answer)-1]),value,text);
    checked++;
  }
  assert.equal(checked,439);
});

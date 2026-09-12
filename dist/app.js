import { EXAMPLES, matchesExample } from './examples.js';
import { ARCHITECTURES, Machine, compile, address, assembly, formatNumber } from './engine.js';

const $ = id => document.getElementById(id);
const editor=$('source'),picker=$('example'),archPicker=$('architecture');
let machine=null,program=null,timer=null,hex=true,dirty=false,breakpoints=new Set(),lastHighlighted=-1;
for(const example of EXAMPLES)picker.add(new Option(example.name,example.id));
const selected=()=>EXAMPLES.find(e=>e.id===picker.value);
const element=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
function stop(){if(timer!==null)clearInterval(timer);timer=null;$('play').textContent='▶ 运行';}
function lineNumbers(){const height=parseFloat(getComputedStyle(editor).lineHeight);$('line-numbers').replaceChildren(...editor.value.split('\n').map((_,i)=>{const d=element('div','',String(i+1));d.style.height=height+'px';return d;}));$('line-numbers').scrollTop=editor.scrollTop;}
function loadExample(){stop();editor.value=selected().source;$('example-description').textContent=selected().description;lineNumbers();compileCurrent();}
function compileCurrent(){
  stop();breakpoints.clear();lastHighlighted=-1;dirty=false;$('validation-results').textContent='';
  try{program=compile(editor.value);machine=new Machine(program,archPicker.value);$('source-state').textContent='编译成功 · '+program.code.length+' 条教学指令';renderInstructions();render();return true;}
  catch(error){program=null;machine=null;$('source-state').textContent='编译失败';$('status').textContent='编译失败';$('result').textContent=error.message;$('result').className='result-summary error';$('console').textContent='请修正源代码后重新编译。';$('instructions').replaceChildren();$('registers').replaceChildren();$('memory').replaceChildren();$('flags').replaceChildren();$('call-stack').textContent='—';$('step-count').textContent='STEP 0000';$('operation').textContent=error.message;$('pc-value').textContent='—';$('decoded').textContent='编译失败';$('register-preview').textContent='—';$('alu-value').textContent='—';$('memory-preview').textContent='0 bytes';$('validation-badge').textContent='编译失败';$('arch-badge').textContent=ARCHITECTURES[archPicker.value].name;document.querySelectorAll('.cpu-unit').forEach(el=>el.classList.remove('active'));updateButtons();return false;}
}
function updateButtons(){const invalid=!machine||dirty;$('step').disabled=invalid||machine.s.halted;$('play').disabled=invalid||machine.s.halted;$('back').disabled=invalid||!machine.history.length;}
function renderInstructions(){
  const frag=document.createDocumentFragment();
  program.code.forEach((ins,i)=>{
    const row=element('div','instruction-row');row.dataset.index=i;
    const bp=element('button','breakpoint','●');bp.title=`切换指令 ${i} 的断点`;bp.setAttribute('aria-label',bp.title);bp.setAttribute('aria-pressed','false');
    bp.addEventListener('click',()=>{if(breakpoints.has(i))breakpoints.delete(i);else breakpoints.add(i);bp.classList.toggle('set',breakpoints.has(i));bp.setAttribute('aria-pressed',String(breakpoints.has(i)));});
    const addr=element('span','address',(0x400000+i*4).toString(16).padStart(8,'0'));addr.title=address(i,machine.arch);
    const asm=element('span','asm',assembly(ins,machine.arch));asm.title=asm.textContent;
    row.append(bp,addr,asm,element('span','line-ref',String(ins.line)));frag.append(row);
  });$('instructions').replaceChildren(frag);
}
function render(){
  if(!machine)return;const s=machine.s,a=machine.model,ins=program.code[s.last??s.pc];
  $('arch-badge').textContent=a.name;$('status').textContent=s.error?'执行异常':s.halted?'执行完成':timer!==null?'运行中':'已暂停 / 就绪';
  $('step-count').textContent='STEP '+String(s.steps).padStart(4,'0');
  $('pc-value').textContent=address(s.pc,machine.arch);$('decoded').textContent=s.last===null?'准备执行':assembly(ins,machine.arch);
  $('register-preview').textContent=`${a.regs[0]} = ${s.registers[a.regs[0]]}`;
  $('alu-value').textContent=s.activity.includes('alu')?s.operation:'—';$('memory-preview').textContent=Object.keys(s.memory).length*4+' bytes';
  $('operation').textContent=s.operation;
  document.querySelectorAll('.cpu-unit').forEach(el=>el.classList.toggle('active',s.activity.includes(el.id.replace('unit-',''))));
  $('flags').replaceChildren(...a.flags.map((name,i)=>element('span','flag'+(s.flags[i]?' on':''),name+' '+s.flags[i])));
  const registerScroll=$('registers').scrollTop;
  $('registers').replaceChildren(...Object.entries(s.registers).map(([name,value])=>{const row=element('div','register-row'+(s.changed.includes(name)?' changed':''));const label=element('span','reg-name',name);if(name===a.pc)label.append(element('small','','PC'));if(name===a.sp)label.append(element('small','','栈'));row.append(label,element('span','',formatNumber(value,machine.arch,hex)));return row;}));
  $('registers').scrollTop=registerScroll;
  const memoryScroll=$('memory').scrollTop;
  const cells=Object.entries(s.memory).sort((a,b)=>Number(b[0])-Number(a[0]));
  $('memory').replaceChildren(...cells.map(([addr,cell])=>{
    const row=element('div','memory-row'+(s.changedMemory.includes(Number(addr))?' changed':''));
    const bytes=cell.value===null?'?? ?? ?? ??':Array.from({length:4},(_,i)=>((cell.value>>>(i*8))&255).toString(16).padStart(2,'0').toUpperCase()).join(' ');
    row.append(element('span','memory-name',cell.name),element('span','memory-value',cell.value===null?'未初始化':String(cell.value)),element('span','memory-address',formatNumber(Number(addr),machine.arch,true)+' · #'+cell.frame),element('span','memory-bytes',bytes));return row;
  }));
  if(!cells.length)$('memory').append(element('div','memory-empty','执行变量声明后，在这里查看地址与数值。'));
  $('memory').scrollTop=memoryScroll;$('call-stack').textContent=s.frames.map(f=>f.name+'()').join(' → ');
  const current=selected(),matches=program.source.trim()===current.source.trim();
  $('console').textContent=s.output||(s.halted?'（无输出）':'程序输出将显示在这里。');
  $('result').className='result-summary';
  if(s.error){$('result').textContent=s.error;$('result').classList.add('error');$('validation-badge').textContent='执行错误';}
  else if(s.halted){const passed=matches&&matchesExample(s,current);$('result').textContent=`返回值 ${s.result} · 已执行 ${s.steps} 条教学指令`+(matches?passed?' · 与预期一致':' · 与预期不符':' · 自定义程序执行完成');$('result').classList.add(matches&&!passed?'error':'success');$('validation-badge').textContent=matches?(passed?'✓ 验证通过':'验证失败'):'执行完成';}
  else{$('result').textContent=matches?`预期返回值 ${current.result} · 运行结束后自动校验输出与返回值${current.expectedMemory?'及成员值':''}`:'自定义程序 · 执行 assert 可验证结果';$('validation-badge').textContent='待验证';}
  const active=s.last??s.pc;
  for(const row of $('instructions').children){const idx=Number(row.dataset.index);row.classList.toggle('current',s.last===idx);row.classList.toggle('next',!s.halted&&idx===s.pc);}
  if(active!==lastHighlighted){
    const row=$('instructions').children[active];if(row){const container=$('instructions');const top=row.offsetTop-container.offsetTop;if(top<container.scrollTop||top>container.scrollTop+container.clientHeight-30)container.scrollTop=Math.max(0,top-container.clientHeight/2);}
    lastHighlighted=active;
  }
  const line=ins?.line;
  for(let i=0;i<$('line-numbers').children.length;i++)$('line-numbers').children[i].classList.toggle('current-line',i+1===line);
  if(document.activeElement!==editor&&line){const height=parseFloat(getComputedStyle(editor).lineHeight);const y=(line-1)*height;if(y<editor.scrollTop||y>editor.scrollTop+editor.clientHeight-height*2)editor.scrollTop=Math.max(0,y-editor.clientHeight/3);$('line-numbers').scrollTop=editor.scrollTop;}
  updateButtons();
}
function step(){if(!machine||dirty)return;machine.step();if(machine.s.halted)stop();render();}
function play(){
  if(timer!==null){stop();render();return;}if(!machine||dirty||machine.s.halted)return;
  let first=true;
  timer=setInterval(()=>{if(!first&&breakpoints.has(machine.s.pc)){stop();render();$('status').textContent='命中断点';return;}first=false;step();},1000/Number($('speed').value));
  $('play').textContent='Ⅱ 暂停';render();
}
async function validateExamples(){
  stop();render();$('validate').disabled=true;const modelCount=Object.keys(ARCHITECTURES).length;$('validation-results').textContent=`正在验证 ${EXAMPLES.length} 个示例 × ${modelCount} 种模型…`;let total=0;const failures=[];
  try{
    for(const a of Object.keys(ARCHITECTURES)){
      for(const example of EXAMPLES){try{const s=new Machine(compile(example.source),a).run();if(!matchesExample(s,example))failures.push(`${ARCHITECTURES[a].name} / ${example.name}: ${s.error||'结果不符'}`);else total++;}catch(error){failures.push(error.message);}}
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    $('validation-results').textContent=failures.length?failures.join('\n'):`✓ ${total}/${EXAMPLES.length*modelCount} 全部通过 · 输出、返回值与预期内存均匹配`;
  }finally{$('validate').disabled=false;}
}
editor.addEventListener('input',()=>{stop();dirty=true;lineNumbers();updateButtons();$('source-state').textContent='源码已修改 · 请重新编译';$('status').textContent='待编译';});
editor.addEventListener('scroll',()=>{$('line-numbers').scrollTop=editor.scrollTop;});
editor.addEventListener('keydown',event=>{if(event.key==='Tab'){event.preventDefault();editor.setRangeText('  ',editor.selectionStart,editor.selectionEnd,'end');editor.dispatchEvent(new Event('input'));}if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();compileCurrent();}});
picker.addEventListener('change',loadExample);archPicker.addEventListener('change',compileCurrent);
$('compile').addEventListener('click',compileCurrent);$('step').addEventListener('click',()=>{stop();step();});$('play').addEventListener('click',play);
$('back').addEventListener('click',()=>{stop();machine?.back();render();});
$('speed').addEventListener('input',()=>{$('speed-value').textContent=$('speed').value+' 指令/s';if(timer!==null){stop();play();}});
$('number-format').addEventListener('click',()=>{hex=!hex;$('number-format').textContent=hex?'HEX ⇄ DEC':'DEC ⇄ HEX';render();});
$('validate').addEventListener('click',validateExamples);
$('help-button').addEventListener('click',()=>$('help').showModal());$('close-help').addEventListener('click',()=>$('help').close());
loadExample();

const context=document.modelContext;
if(context?.registerTool){
  const lifecycle=new AbortController();
  const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{/* Optional API. */}};
  register({name:'cpu_load_program',title:'载入 CPU 教学程序',description:'载入 C++ 教学子集源码、选择模型并编译，重置当前模拟状态。',inputSchema:{type:'object',properties:{source:{type:'string',maxLength:40000},architecture:{type:'string',enum:Object.keys(ARCHITECTURES)}},required:['source','architecture'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute(input){if(!input||typeof input.source!=='string'||input.source.length>40000||!Object.hasOwn(ARCHITECTURES,input.architecture))throw new Error('需要合法源码和 CPU 模型');compile(input.source);editor.value=input.source;archPicker.value=input.architecture;lineNumbers();compileCurrent();return {compiled:!!program,instructions:program?.code.length||0,architecture:archPicker.value};}});
  register({name:'cpu_step_program',title:'执行 CPU 教学指令',description:'执行指定数量的教学指令并更新界面，返回输出与当前状态。',inputSchema:{type:'object',properties:{steps:{type:'integer',minimum:1,maximum:1000}},required:['steps'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute(input){if(!Number.isInteger(input?.steps)||input.steps<1||input.steps>1000)throw new Error('steps 必须为 1–1000');if(!machine||dirty)throw new Error('请先编译程序');stop();for(let i=0;i<input.steps&&!machine.s.halted;i++)machine.step();render();return {steps:machine.s.steps,halted:machine.s.halted,output:machine.s.output,result:machine.s.result,error:machine.s.error};}});
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}

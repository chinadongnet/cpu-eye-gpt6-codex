// Deterministic teaching VM. This is intentionally not a native ISA emulator.
export const ARCHITECTURES = {
  x86: { name: 'x86', bits: 32, family: 'x86', regs: ['EAX','EBX','ECX','EDX','ESI','EDI','EBP','ESP'], pc: 'EIP', sp: 'ESP', bp: 'EBP', flags: ['ZF','SF','CF','OF'] },
  x64: { name: 'x86-64', bits: 64, family: 'x86', regs: ['RAX','RBX','RCX','RDX','RSI','RDI','R8','R9','R10','R11','R12','R13','R14','R15','RBP','RSP'], pc: 'RIP', sp: 'RSP', bp: 'RBP', flags: ['ZF','SF','CF','OF'] },
  arm32: { name: 'ARM32', bits: 32, family: 'arm', regs: ['R0','R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11','R12','SP','LR'], pc: 'PC', sp: 'SP', bp: 'R11', flags: ['Z','N','C','V'] },
  arm64: { name: 'ARM64', bits: 64, family: 'arm', regs: [...Array.from({length:29},(_,i)=>`X${i}`),'X29','X30','SP'], pc: 'PC', sp: 'SP', bp: 'X29', flags: ['Z','N','C','V'] }
};
export class ProgramError extends Error {
  constructor(message, line = 1) { super(`第 ${line} 行：${message}`); this.line = line; }
}
function tokenize(source) {
  if (source.length > 40000) throw new ProgramError('程序不能超过 40,000 个字符');
  const tokens = []; let i = 0, line = 1;
  const add = (value, kind = 'symbol') => tokens.push({ value, kind, line });
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { if(c === '\n') line++; i++; continue; }
    if (source.startsWith('//',i)) { while(i < source.length && source[i] !== '\n') i++; continue; }
    if (source.startsWith('/*',i)) { const end=source.indexOf('*/',i+2); if(end<0) throw new ProgramError('注释未结束',line); line+=(source.slice(i,end).match(/\n/g)||[]).length; i=end+2; continue; }
    if (c === '#') { const end=source.indexOf('\n',i); const text=source.slice(i,end<0?source.length:end); if(!/^#\s*include\s*<(iostream|cassert)>\s*$/.test(text)) throw new ProgramError('仅支持 #include <iostream> 和 <cassert>',line); i=end<0?source.length:end; continue; }
    if (c === '"') {
      const startLine=line; let value=''; i++;
      while(i<source.length && source[i] !== '"') {
        if(source[i]==='\n') throw new ProgramError('字符串不能直接换行',startLine);
        if(source[i]==='\\') { i++; const escapes={n:'\n',t:'\t',r:'\r','"':'"','\\':'\\'}; if(!(source[i] in escapes)) throw new ProgramError('不支持此字符串转义',line); value+=escapes[source[i++]]; }
        else value+=source[i++];
      }
      if(i>=source.length) throw new ProgramError('字符串未结束',startLine);
      i++; add(value,'string'); continue;
    }
    const num=source.slice(i).match(/^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)/);
    if(num) { add(num[0],'number'); i+=num[0].length; continue; }
    const id=source.slice(i).match(/^[a-zA-Z_][a-zA-Z_0-9]*/);
    if(id) { add(id[0],'id'); i+=id[0].length; continue; }
    const op=['<<=','>>=','++','--','+=','-=','*=','/=','%=','==','!=','<=','>=','&&','||','<<','>>','&=','|=','^=','::'].find(op=>source.startsWith(op,i));
    if(op) {add(op);i+=op.length;continue;}
    if('{}()[];,+-*/%<>=!~&|^'.includes(c)) {add(c);i++;continue;}
    throw new ProgramError(`不支持的字符「${c}」`,line);
  }
  add('<eof>'); return tokens;
}
const precedence={'=':1,'+=':1,'-=':1,'*=':1,'/=':1,'%=':1,'&=':1,'|=':1,'^=':1,'<<=':1,'>>=':1,'||':2,'&&':3,'|':4,'^':5,'&':6,'==':7,'!=':7,'<':8,'>':8,'<=':8,'>=':8,'<<':9,'>>':9,'+':10,'-':10,'*':11,'/':11,'%':11};
class Parser {
  constructor(source) {this.t=tokenize(source);this.i=0;this.depth=0;}
  peek(v) {return this.t[this.i].value===v;}
  take(v) {if(this.peek(v)) {this.i++;return true;}return false;}
  expect(v) {if(!this.take(v)) throw new ProgramError(`需要「${v}」，但遇到「${this.t[this.i].value}」`,this.t[this.i].line);}
  id() {const t=this.t[this.i++];if(t.kind!=='id') throw new ProgramError('需要标识符',t.line); return t.value;}
  type() {const t=this.t[this.i++];if(!['int','bool','void'].includes(t.value)) throw new ProgramError('仅支持 int、bool 与 void 函数返回类型',t.line);return t.value;}
  parse() {
    const functions=[];
    while(!this.peek('<eof>')) {
      if(this.take('using')) {this.expect('namespace');this.expect('std');this.expect(';');continue;}
      const line=this.t[this.i].line,type=this.type(),name=this.id(); this.expect('(');const params=[];
      if(!this.peek(')')) do {const type=this.type();if(type==='void') throw new ProgramError('参数不能为 void',line);params.push({type,name:this.id()});} while(this.take(','));
      this.expect(')');if(!this.peek('{')) throw new ProgramError('函数需要函数体；不支持全局变量或函数原型',line);
      functions.push({name,type,params,body:this.statement(),line});
    }
    return functions;
  }
  statement() {
    if(++this.depth>120) throw new ProgramError('嵌套层数过多',this.t[this.i].line);
    try {return this.statementInner();} finally {this.depth--;}
  }
  statementInner() {
    const line=this.t[this.i].line;
    if(this.take('{')) {const items=[];while(!this.peek('}')) {if(this.peek('<eof>')) this.expect('}');items.push(this.statement());}this.expect('}');return {kind:'block',items,line};}
    if(this.take(';')) return {kind:'empty',line};
    if(this.take('if')) {this.expect('(');const cond=this.expr();this.expect(')');const yes=this.statement(),no=this.take('else')?this.statement():null;return {kind:'if',cond,yes,no,line};}
    if(this.take('while')) {this.expect('(');const cond=this.expr();this.expect(')');return {kind:'while',cond,body:this.statement(),line};}
    if(this.take('for')) {
      this.expect('(');let init=null;if(!this.peek(';')) init=this.peek('int')||this.peek('bool')?this.decl():{kind:'expr',expr:this.expr(),line};this.expect(';');
      const cond=this.peek(';')?{kind:'number',value:1,line}:this.expr();this.expect(';');const update=this.peek(')')?null:this.expr();this.expect(')');return {kind:'for',init,cond,update,body:this.statement(),line};
    }
    if(this.peek('int')||this.peek('bool')) {const n=this.decl();this.expect(';');return n;}
    if(this.take('return')) {const expr=this.peek(';')?null:this.expr();this.expect(';');return {kind:'return',expr,line};}
    for(const kind of ['break','continue']) if(this.take(kind)){this.expect(';');return {kind,line};}
    if(this.peek('cout')||(this.peek('std')&&this.t[this.i+2]?.value==='cout')) {
      if(this.take('std')) this.expect('::');this.expect('cout');const values=[];
      if(!this.peek('<<')) this.expect('<<');
      while(this.take('<<')) {
        if(this.peek('std')&&this.t[this.i+2]?.value==='endl'){this.i+=3;values.push({kind:'string',value:'\n',line});}
        else if(this.take('endl')) values.push({kind:'string',value:'\n',line});
        else values.push(this.expr(0,new Set(['<<',';'])));
      }
      this.expect(';');return {kind:'print',values,line};
    }
    const expr=this.expr();this.expect(';');return {kind:'expr',expr,line};
  }
  decl() {
    const line=this.t[this.i].line,type=this.type(),name=this.id();let size=null,init=null;
    if(this.take('[')) {const t=this.t[this.i++];if(t.kind!=='number'||!Number.isInteger(Number(t.value))) throw new ProgramError('数组长度必须是整数字面量',line);size=Number(t.value);if(size<1||size>256) throw new ProgramError('数组长度范围为 1–256',line);this.expect(']');}
    if(this.take('=')) {if(this.take('{')) {init=[];if(!this.peek('}')) do{init.push(this.expr());}while(this.take(','));this.expect('}');if(!size) throw new ProgramError('花括号初始化仅支持数组',line);}else{if(size) throw new ProgramError('数组需要花括号初始化',line);init=this.expr();}}
    if(Array.isArray(init)&&init.length>size) throw new ProgramError('数组初始化元素过多',line);
    return {kind:'decl',name,type,size,init,line};
  }
  expr(min=0,stop=new Set()) {
    if(++this.depth>120) throw new ProgramError('表达式嵌套过深',this.t[this.i].line);
    try {
      const t=this.t[this.i++];let node;
      if(t.kind==='number') {const value=Number(t.value);if(!Number.isSafeInteger(value)||value>2147483648) throw new ProgramError('整数字面量超出教学 int32 范围',t.line);node={kind:'number',value,line:t.line};}
      else if(t.kind==='string') node={kind:'string',value:t.value,line:t.line};
      else if(t.value==='(') {node=this.expr();this.expect(')');}
      else if(['+','-','!','~','++','--'].includes(t.value)) node={kind:'unary',op:t.value,expr:this.expr(12,stop),line:t.line};
      else if(['true','false'].includes(t.value)) node={kind:'number',value:t.value==='true'?1:0,line:t.line};
      else if(t.kind==='id') node={kind:'var',name:t.value,line:t.line};
      else throw new ProgramError(`无法解析表达式「${t.value}」`,t.line);
      while(true) {
        const op=this.t[this.i].value;if(stop.has(op)) break;
        if(op==='('&&node.kind==='var') {this.i++;const args=[];if(!this.peek(')')) do{args.push(this.expr());}while(this.take(','));this.expect(')');node={kind:'call',name:node.name,args,line:node.line};continue;}
        if(op==='[') {this.i++;const index=this.expr();this.expect(']');node={kind:'index',base:node,index,line:node.line};continue;}
        if(op==='++'||op==='--') {this.i++;node={kind:'post',op,expr:node,line:node.line};continue;}
        const prec=precedence[op];if(!prec||prec<min) break;
        this.i++;node={kind:prec===1?'assign':'binary',op,left:node,right:this.expr(prec===1?prec:prec+1,stop),line:node.line};
      }
      return node;
    } finally {this.depth--;}
  }
}
export function compile(source) {
  const ast=new Parser(source).parse(),functions=Object.create(null),code=[];
  const emit=(op,args={},line=1)=>{code.push({op,...args,line});return code.length-1;};
  for(const fn of ast) {if(Object.hasOwn(functions,fn.name)||fn.name==='assert') throw new ProgramError('函数重复或保留名称：'+fn.name,fn.line);functions[fn.name]={...fn,slots:[],entry:0};}
  if(!Object.hasOwn(functions,'main')||functions.main.type!=='int'||functions.main.params.length) throw new ProgramError('程序需要 int main()');
  for(const fn of Object.values(functions)) {
    fn.entry=code.length;let scopes=[new Map()],loops=[];
    const allocate=(name,type,size,line)=>{if(scopes.at(-1).has(name)) throw new ProgramError('变量重复定义：'+name,line);const slot={id:fn.slots.length,name,type,size:size||1,array:size!==null};fn.slots.push(slot);scopes.at(-1).set(name,slot);return slot;};
    fn.paramSlots=fn.params.map(p=>allocate(p.name,p.type,null,fn.line));
    const lookup=(name,line)=>{for(let i=scopes.length-1;i>=0;i--) if(scopes[i].has(name)) return scopes[i].get(name);throw new ProgramError('未定义的变量：'+name,line);};
    const addr=node=>{
      if(node.kind==='var') {const slot=lookup(node.name,node.line);if(slot.array) throw new ProgramError('数组必须指定下标',node.line);emit('ADDR',{slot:slot.id,name:slot.name},node.line);return slot;}
      if(node.kind==='index'&&node.base.kind==='var') {const slot=lookup(node.base.name,node.line);if(!slot.array) throw new ProgramError('仅数组可以使用下标',node.line);expression(node.index);emit('INDEX',{slot:slot.id,name:slot.name,size:slot.size},node.line);return slot;}
      throw new ProgramError('赋值目标必须是变量或数组元素',node.line);
    };
    const expression=node=>{
      const line=node.line;
      if(node.kind==='number') {int32(node.value,line);emit('CONST',{value:node.value},line);return;}
      if(node.kind==='string') throw new ProgramError('字符串仅用于 cout 输出',line);
      if(node.kind==='var'||node.kind==='index') {addr(node);emit('LOAD',{},line);return;}
      if(node.kind==='assign') {addr(node.left);if(node.op!=='='){emit('DUP',{},line);emit('LOAD',{},line);}expression(node.right);if(node.op!=='=') emit('BINARY',{operator:node.op.slice(0,-1)},line);emit('STORE',{},line);return;}
      if(node.kind==='unary'||node.kind==='post') {
        if(node.op==='-'&&node.expr.kind==='number'&&node.expr.value===2147483648){emit('CONST',{value:-2147483648},line);return;}
        if(node.op==='++'||node.op==='--') {addr(node.expr);emit('INC',{delta:node.op==='++'?1:-1,post:node.kind==='post'},line);}
        else {expression(node.expr);emit('UNARY',{operator:node.op},line);}return;
      }
      if(node.kind==='binary') {
        expression(node.left);
        if(node.op==='&&'||node.op==='||') {emit('BOOL',{},line);emit('DUP',{},line);const jump=emit(node.op==='&&'?'JZ':'JNZ',{target:0},line);emit('POP',{},line);expression(node.right);emit('BOOL',{},line);code[jump].target=code.length;}
        else {expression(node.right);emit('BINARY',{operator:node.op},line);}return;
      }
      if(node.kind==='call') {
        if(node.name==='assert') {if(node.args.length!==1) throw new ProgramError('assert 需要 1 个参数',line);expression(node.args[0]);emit('ASSERT',{},line);emit('CONST',{value:0},line);return;}
        const target=Object.hasOwn(functions,node.name)?functions[node.name]:null;
        if(!target) throw new ProgramError('未定义的函数：'+node.name,line);
        if(target.params.length!==node.args.length) throw new ProgramError('函数参数数量不匹配',line);
        if(target.type==='void') throw new ProgramError('当前教学子集不支持调用 void 函数',line);
        node.args.forEach(expression);emit('CALL',{name:node.name,count:node.args.length},line);return;
      }
      throw new ProgramError('不支持的表达式',line);
    };
    const statement=node=>{
      const line=node.line;
      switch(node.kind) {
        case 'block':scopes.push(new Map());node.items.forEach(statement);scopes.pop();break;
        case 'empty':break;
        case 'decl': {
          const slot=allocate(node.name,node.type,node.size,line);emit('ALLOC',{slot:slot.id,name:slot.name},line);
          if(node.size&&Array.isArray(node.init)) for(let i=0;i<node.size;i++) {emit('CONST',{value:i},line);emit('INDEX',{slot:slot.id,name:slot.name,size:slot.size},line);expression(node.init[i]||{kind:'number',value:0,line});emit('STORE',{},line);emit('POP',{},line);}
          else if(node.init) {emit('ADDR',{slot:slot.id,name:slot.name},line);expression(node.init);emit('STORE',{},line);emit('POP',{},line);}break;
        }
        case 'expr':expression(node.expr);emit('POP',{},line);break;
        case 'print':for(const value of node.values) {if(value.kind==='string') emit('PRINT_TEXT',{value:value.value},line);else {expression(value);emit('PRINT',{},line);}}break;
        case 'return':if(node.expr)expression(node.expr);else if(fn.type!=='void')throw new ProgramError('int/bool 函数必须返回数值',line);else emit('CONST',{value:0},line);emit('RETURN',{},line);break;
        case 'if':{expression(node.cond);const j=emit('JZ',{target:0},line);scopes.push(new Map());statement(node.yes);scopes.pop();if(node.no){const end=emit('JMP',{target:0},line);code[j].target=code.length;scopes.push(new Map());statement(node.no);scopes.pop();code[end].target=code.length;}else code[j].target=code.length;break;}
        case 'while':case 'for': {
          scopes.push(new Map());if(node.init)statement(node.init);const start=code.length;expression(node.cond);const end=emit('JZ',{target:0},line),loop={breaks:[],continues:[]};loops.push(loop);scopes.push(new Map());statement(node.body);scopes.pop();const update=code.length;if(node.update){expression(node.update);emit('POP',{},line);}emit('JMP',{target:start},line);code[end].target=code.length;loop.breaks.forEach(i=>code[i].target=code.length);loop.continues.forEach(i=>code[i].target=node.kind==='for'?update:start);loops.pop();scopes.pop();break;
        }
        case 'break':case 'continue':if(!loops.length)throw new ProgramError(node.kind+' 必须在循环内',line);loops.at(-1)[node.kind==='break'?'breaks':'continues'].push(emit('JMP',{target:0},line));break;
      }
    };
    // Keep parameters and the outer function body in one lexical scope.
    fn.body.items.forEach(statement);
    if(fn.name==='main'||fn.type==='void'){emit('CONST',{value:0},fn.line);emit('RETURN',{},fn.line);}
    else emit('TRAP',{message:'非 void 函数执行到末尾但未返回'},fn.line);
  }
  if(code.length>10000) throw new ProgramError('编译结果超过 10,000 条教学指令');
  return {source,code,functions};
}
function int32(value,line) {if(!Number.isInteger(value)||value < -2147483648 || value > 2147483647) throw new ProgramError('有符号 int32 溢出',line);return value;}
export function address(index,arch='x64') {return '0x'+(0x400000+index*4).toString(16).padStart(ARCHITECTURES[arch].bits===64?16:8,'0');}
export function formatNumber(value,arch='x64',hex=true) {if(!hex)return String(value);return '0x'+BigInt.asUintN(ARCHITECTURES[arch].bits,BigInt(value)).toString(16).toUpperCase().padStart(ARCHITECTURES[arch].bits/4,'0');}
export function assembly(ins,arch='x64') {
  const a=ARCHITECTURES[arch],r=a.regs[0],b=a.regs[1],arm=a.family==='arm',im=v=>arm?'#'+v:String(v);
  const bin={'+':'ADD','-':'SUB','*':arm?'MUL':'IMUL','/':arm?'SDIV':'IDIV','%':'REM','&':'AND','|':arm?'ORR':'OR','^':arm?'EOR':'XOR','<<':arm?'LSL':'SHL','>>':arm?'ASR':'SAR'};
  switch(ins.op) {
    case 'CONST':return `MOV ${r}, ${im(ins.value)}`;
    case 'ALLOC':return `LOCAL ${ins.name}`;
    case 'ADDR':return `${arm?'ADR':'LEA'} ${r}, [${ins.name}]`;
    case 'INDEX':return `INDEX ${r}, ${ins.name}[${r}]`;
    case 'LOAD':return `${arm?'LDR':'MOV'} ${r}, [${r}]`;
    case 'STORE':return `${arm?'STR':'MOV'} [${b}], ${r}`;
    case 'BINARY':return `${bin[ins.operator]||'CMP.SET '+ins.operator} ${r}, ${b}`;
    case 'UNARY':return `${{'-':'NEG','+':'POS','!':'NOT.BOOL','~':'NOT'}[ins.operator]} ${r}`;
    case 'BOOL':return `BOOL ${r}`;
    case 'INC':return `${ins.delta>0?'INC':'DEC'} [${r}]${ins.post?' ; post':''}`;
    case 'JMP':return `${arm?'B':'JMP'} ${address(ins.target,arch)}`;
    case 'JZ':return `${arm?'CBZ':'JZ'} ${address(ins.target,arch)}`;
    case 'JNZ':return `${arm?'CBNZ':'JNZ'} ${address(ins.target,arch)}`;
    case 'CALL':return `${arm?'BL':'CALL'} ${ins.name}`;
    case 'RETURN':return 'RET';
    case 'PRINT_TEXT':return `OUT ${JSON.stringify(ins.value)}`;
    case 'PRINT':return `OUT ${r}`;
    case 'ASSERT':return `ASSERT ${r}`;
    default:return ins.op;
  }
}
export class Machine {
  constructor(program,arch='x64') {
    if(!Object.hasOwn(ARCHITECTURES,arch)) throw new Error('未知架构');
    this.program=program;this.arch=arch;this.model=ARCHITECTURES[arch];this.history=[];
    this.s={pc:program.functions.main.entry,steps:0,stack:[],frames:[],memory:{},registers:Object.fromEntries([...this.model.regs,this.model.pc].map(r=>[r,0])),flags:[0,0,0,0],output:'',halted:false,error:null,result:null,last:null,changed:[],changedMemory:[],operation:'程序已编译，等待执行。',activity:[]};
    this.enter('main',[],-1);this.sync();
  }
  enter(name,args,returnPc) {
    if(this.s.frames.length>=64) throw new ProgramError('调用深度超过 64 层',this.currentLine());
    const fn=this.program.functions[name],parent=this.s.frames.at(-1),top=parent?parent.bottom:0x100000;
    const frame={name,returnPc,stackBase:this.s.stack.length,top,bottom:top,addresses:{}};
    for(const slot of fn.slots){frame.bottom-=slot.size*4;frame.addresses[slot.id]=frame.bottom;}
    if(frame.bottom<0x80000)throw new ProgramError('教学栈空间已耗尽',this.currentLine());
    this.s.frames.push(frame);
    fn.paramSlots.forEach((slot,i)=>this.allocate(slot.id,args[i]));
    this.s.pc=fn.entry;
    if(this.arch==='arm32')this.s.registers.LR=returnPc<0?0:0x400000+returnPc*4;
    if(this.arch==='arm64')this.s.registers.X30=returnPc<0?0:0x400000+returnPc*4;
  }
  currentLine(){return this.program.code[this.s.pc]?.line||1;}
  allocate(id,value=null) {
    const f=this.s.frames.at(-1),slot=this.program.functions[f.name].slots[id],base=f.addresses[id];
    for(let i=0;i<slot.size;i++)this.s.memory[base+i*4]={name:slot.name+(slot.array?`[${i}]`:''),type:slot.type,value:value===null?null:slot.type==='bool'?Number(!!value):int32(value,this.currentLine()),frame:this.s.frames.length};
    this.s.changedMemory.push(...Array.from({length:slot.size},(_,i)=>base+i*4));
  }
  sync() {const f=this.s.frames.at(-1);this.s.registers[this.model.pc]=0x400000+this.s.pc*4;this.s.registers[this.model.sp]=f?.bottom||0x100000;this.s.registers[this.model.bp]=f?.top||0x100000;}
  pop() {if(!this.s.stack.length)throw new Error('内部操作数栈为空');return this.s.stack.pop();}
  push(value){this.s.stack.push(value);this.s.registers[this.model.regs[0]]=value;}
  read(addr){const cell=this.s.memory[addr];if(!cell)throw new ProgramError('非法内存读取',this.currentLine());if(cell.value===null)throw new ProgramError('读取了未初始化的变量 '+cell.name,this.currentLine());return cell.value;}
  write(addr,value) {const cell=this.s.memory[addr];if(!cell)throw new ProgramError('非法内存写入',this.currentLine());cell.value=cell.type==='bool'?Number(!!value):int32(value,this.currentLine());this.s.changedMemory.push(addr);return cell.value;}
  back(){const prev=this.history.pop();if(prev){this.s=prev;return true;}return false;}
  step({record=true}={}) {
    if(this.s.halted)return this.s;
    const before=structuredClone(this.s);
    if(record){this.history.push(before);if(this.history.length>600)this.history.shift();}
    const s=this.s,ins=this.program.code[s.pc];
    s.changedMemory=[];s.activity=['fetch','decode'];s.last=s.pc;
    try {
      if(!ins)throw new ProgramError('指令地址无效',this.currentLine());
      if(s.steps>=50000)throw new ProgramError('执行超过 50,000 步，请检查循环或减少输入',ins.line);
      let next=s.pc+1;const r=this.model.regs;
      const flags=(result,carry=0,overflow=0)=>{s.flags=[Number(result===0),Number(result<0),carry,overflow];};
      const binary=(op,left,right)=>{
        let v; const max=2147483647,min=-2147483648;
        switch(op){
          case '+':v=left+right;flags(v,Number((left>>>0)+(right>>>0)>0xffffffff),Number(v>max||v<min));return int32(v,ins.line);
          case '-':v=left-right;flags(v,this.model.family==='arm'?Number((left>>>0)>=(right>>>0)):Number((left>>>0)<(right>>>0)),Number(v>max||v<min));return int32(v,ins.line);
          case '*':v=left*right;flags(v,0,Number(v>max||v<min));return int32(v,ins.line);
          case '/':case '%':if(!right)throw new ProgramError('除数不能为 0',ins.line);if(left===min&&right===-1)throw new ProgramError('有符号 int32 除法溢出',ins.line);v=op==='/'?Math.trunc(left/right):left%right;break;
          case '&':v=left&right;break;case '|':v=left|right;break;case '^':v=left^right;break;
          case '<<':case '>>':if(right<0||right>=32)throw new ProgramError('移位数量必须为 0–31',ins.line);if(op==='<<'&&(left<0||left*2**right>max))throw new ProgramError('左移超出教学有符号 int32 范围',ins.line);v=op==='<<'?left<<right:left>>right;break;
          case '==':v=Number(left===right);break;case '!=':v=Number(left!==right);break;case '<':v=Number(left<right);break;case '<=':v=Number(left<=right);break;case '>':v=Number(left>right);break;case '>=':v=Number(left>=right);break;
          default:throw new ProgramError('未知运算符 '+op,ins.line);
        }
        flags(v);return v;
      };
      switch(ins.op){
        case 'CONST':this.push(ins.value);s.operation=`载入立即数 ${ins.value}`;s.activity.push('register');break;
        case 'ALLOC':this.allocate(ins.slot);s.operation=`为 ${ins.name} 分配栈空间`;s.activity.push('memory');break;
        case 'ADDR':this.push(s.frames.at(-1).addresses[ins.slot]);s.operation=`获取变量 ${ins.name} 的地址`;s.activity.push('register');break;
        case 'INDEX':{const i=this.pop();if(i<0||i>=ins.size)throw new ProgramError(`数组 ${ins.name} 下标 ${i} 越界（长度 ${ins.size}）`,ins.line);this.push(s.frames.at(-1).addresses[ins.slot]+i*4);s.operation=`计算 ${ins.name}[${i}] 的地址`;s.activity.push('alu');break;}
        case 'LOAD':{const addr=this.pop(),value=this.read(addr);this.push(value);s.operation=`读取 ${s.memory[addr].name} → ${value}`;s.activity.push('memory','register');break;}
        case 'STORE':{const value=this.pop(),addr=this.pop();s.registers[r[1]]=addr;this.push(this.write(addr,value));s.operation=`写回 ${s.memory[addr].name} = ${s.memory[addr].value}`;s.activity.push('register','memory');break;}
        case 'DUP':this.push(s.stack.at(-1));s.operation='暂存操作数（教学操作数栈）';break;
        case 'POP':this.pop();s.operation='结束表达式，释放临时结果';break;
        case 'BINARY':{const right=this.pop(),left=this.pop();s.registers[r[1]]=right;const value=binary(ins.operator,left,right);this.push(value);s.operation=`${left} ${ins.operator} ${right} → ${value}`;s.activity.push('alu','register');break;}
        case 'UNARY':{const value=this.pop(),result=ins.operator==='-'?-value:ins.operator==='!'?Number(!value):ins.operator==='~'?~value:value;this.push(int32(result,ins.line));flags(result);s.operation=`${ins.operator}${value} → ${result}`;s.activity.push('alu','register');break;}
        case 'BOOL':{const value=Number(!!this.pop());this.push(value);flags(value);s.operation=`逻辑结果 → ${value}`;s.activity.push('alu');break;}
        case 'INC':{const addr=this.pop(),old=this.read(addr),value=binary('+',old,ins.delta),written=this.write(addr,value);this.push(ins.post?old:written);s.operation=`${s.memory[addr].name}: ${old} → ${written}`;s.activity.push('memory','alu','register');break;}
        case 'JZ':case 'JNZ':{const value=this.pop(),jump=ins.op==='JZ'?!value:!!value;flags(value);if(jump)next=ins.target;s.operation=`条件 ${value}：${jump?'跳转到指令 '+ins.target:'顺序执行'}`;break;}
        case 'JMP':next=ins.target;s.operation=`跳转到指令 ${ins.target}`;break;
        case 'CALL':{const args=s.stack.splice(s.stack.length-ins.count,ins.count);this.enter(ins.name,args,next);next=s.pc;s.operation=`调用 ${ins.name}(${args.join(', ')})`;s.activity.push('memory','register');break;}
        case 'RETURN':{let value=int32(this.pop(),ins.line);const f=s.frames.at(-1);if(this.program.functions[f.name].type==='bool')value=Number(!!value);s.stack.length=f.stackBase;if(s.frames.length===1){s.result=value;s.halted=true;next=s.pc;s.registers[r[0]]=value;}else{s.frames.pop();for(const [addr,cell]of Object.entries(s.memory))if(cell.frame>s.frames.length)delete s.memory[addr];this.push(value);next=f.returnPc;}s.operation=`${f.name} 返回 ${value}${s.halted?' · 保留最终内存快照':''}`;s.activity.push('memory','register');break;}
        case 'PRINT':{const value=int32(this.pop(),ins.line);s.output+=String(value);s.operation=`输出 ${value}`;break;}
        case 'PRINT_TEXT':s.output+=ins.value;s.operation=`输出 ${JSON.stringify(ins.value)}`;break;
        case 'ASSERT':if(!this.pop())throw new ProgramError('assert 断言失败',ins.line);s.operation='assert 断言通过';break;
        case 'TRAP':throw new ProgramError(ins.message,ins.line);
        default:throw new ProgramError('未知教学指令',ins.line);
      }
      if(s.output.length>20000)throw new ProgramError('输出超过 20,000 字符限制',ins.line);
      s.pc=next;s.steps++;this.sync();s.changed=Object.keys(s.registers).filter(k=>s.registers[k]!==before.registers[k]);
    }catch(error){this.s=structuredClone(before);this.s.halted=true;this.s.error=error.message;this.s.last=before.pc;this.s.operation=error.message;this.s.activity=[];this.s.changed=[];this.s.changedMemory=[];}
    return this.s;
  }
  run(){while(!this.s.halted)this.step({record:false});return this.s;}
}

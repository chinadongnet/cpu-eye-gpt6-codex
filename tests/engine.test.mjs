import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,Machine,ARCHITECTURES,assembly,formatNumber} from '../dist/engine.js';
import {EXAMPLES} from '../dist/examples.js';
const run=source=>new Machine(compile(source)).run();
for(const arch of Object.keys(ARCHITECTURES))for(const example of EXAMPLES)test(`${arch}: ${example.name}`,()=>{const s=new Machine(compile(example.source),arch).run();assert.equal(s.error,null);assert.equal(s.output,example.expected);assert.equal(s.result,example.result);});
test('custom source, scopes, break, continue and short-circuit',()=>{const s=run(`int main(){int sum=0;for(int i=0;i<10;i++){if(i==2)continue;if(i==5)break;sum+=i;}int x=0;if(0 && (1/0)) x=1;if(1 || (1/0)) x+=2;{int sum=99;x+=sum;}return sum+x;}`);assert.equal(s.error,null);assert.equal(s.result,109);});
test('while continue, nested calls, unary and prefix/postfix',()=>{const s=run(`int add(int a,int b){return a+b;}int main(){int i=0;int x=0;while(i<5){++i;if(i==3)continue;x+=i;}int y=x++;return add(x,add(y,~0));}`);assert.equal(s.error,null);assert.equal(s.result,24);});
test('recursive calls restore the caller and operand stack',()=>{const s=run(`int fib(int n){if(n<2)return n;return fib(n-1)+fib(n-2);}int main(){return fib(8);}`);assert.equal(s.error,null);assert.equal(s.result,21);assert.equal(s.stack.length,0);assert.equal(s.frames.length,1);});
test('array partial initialization and bool conversion',()=>{const s=run(`int main(){int a[3]={7};bool b=42;b=0;return a[0]+a[1]+a[2]+b;}`);assert.equal(s.error,null);assert.equal(s.result,7);});
test('reverse execution restores full state and deterministic replay',()=>{const m=new Machine(compile(EXAMPLES[1].source));for(let i=0;i<40;i++)m.step();const snapshot=structuredClone(m.s);m.step();assert.equal(m.back(),true);assert.deepEqual(m.s,snapshot);const a=structuredClone(m.step());m.back();assert.deepEqual(m.step(),a);});
test('all examples survive instruction-by-instruction backtracking',()=>{for(const e of EXAMPLES){const m=new Machine(compile(e.source));while(!m.s.halted){const before=structuredClone(m.s);const after=structuredClone(m.step());m.back();assert.deepEqual(m.s,before);assert.deepEqual(m.step(),after);}assert.equal(m.s.result,e.result);}});
for(const [name,source,pattern]of [
  ['division by zero','int main(){return 8/0;}',/除数/],
  ['uninitialized value','int main(){int x;return x;}',/未初始化/],
  ['out of bounds','int main(){int a[2]={1,2};return a[2];}',/越界/],
  ['negative index','int main(){int a[2]={1,2};return a[-1];}',/越界/],
  ['overflow','int main(){int x=2147483647;return x+1;}',/溢出/],
  ['division overflow','int main(){int x=-2147483648;return x/-1;}',/溢出/],
  ['assert failure','int main(){assert(0);return 0;}',/断言失败/],
  ['shift count','int main(){return 1<<32;}',/移位数量/],
  ['missing return','int f(){int a=1;}int main(){return f();}',/未返回/],
  ['recursion cap','int f(int n){return f(n+1);}int main(){return f(0);}',/64 层/],
  ['instruction budget','int main(){while(1){}return 0;}',/50,000/],
])test(name,()=>{assert.match(run(source).error,pattern);});
for(const source of ['int main(){return missing;}','int main(){float x=1;return 0;}','int main(){int a=1;int a=2;}','int main(){break;}','int main(){return unknown(1);}','#include <vector>\nint main(){return 0;}','int main(){return 2147483648;}','int main(){int a[2]={1,2,3};}','int main(){return (1;}'])test('reject invalid/unsupported: '+source,()=>assert.throws(()=>compile(source)));
test('register widths and instruction dialects differ',()=>{assert.equal(formatNumber(-1,'x86'),'0xFFFFFFFF');assert.equal(formatNumber(-1,'x64'),'0xFFFFFFFFFFFFFFFF');assert.match(assembly({op:'LOAD'},'x64'),/MOV RAX/);assert.match(assembly({op:'LOAD'},'arm64'),/LDR X0/);});
test('error is atomic and rewindable',()=>{const m=new Machine(compile('int main(){int a=1;return a/0;}'));while(!m.s.halted)m.step();assert.ok(m.s.error);m.back();assert.equal(m.s.error,null);assert.equal(m.s.halted,false);m.step();assert.match(m.s.error,/除数/);});

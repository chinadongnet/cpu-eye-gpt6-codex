import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCHITECTURES, Machine, ProgramError, assembly, compile } from '../dist/engine.js';
import { EXAMPLES, matchesExample } from '../dist/examples.js';

const source = `class A{
public:
    int x;
    int y;
};

int main()
{
    A a;
    a.x = 1;
    a.y = 2;
    return 0;
}`;
const definition = 'class A { public: int x; int y; };';
const execute = source => new Machine(compile(source)).run();
const member = (state, name) => Object.entries(state.memory).find(([, cell]) => cell.name === name);

for (const arch of Object.keys(ARCHITECTURES)) {
  test(`${arch}: exact requested class program allocates and writes separate members`, () => {
    const m = new Machine(compile(source), arch);
    m.step();
    const [xAddress, x] = member(m.s, 'a.x');
    const [yAddress, y] = member(m.s, 'a.y');
    assert.equal(x.value, null);
    assert.equal(y.value, null);
    assert.equal(Number(yAddress) - Number(xAddress), 4);
    assert.equal(Object.keys(m.s.memory).length, 2);
    const state = m.run();
    assert.equal(state.error, null);
    assert.equal(state.result, 0);
    assert.equal(state.output, '');
    assert.equal(member(state, 'a.x')[1].value, 1);
    assert.equal(member(state, 'a.y')[1].value, 2);
  });

  test(`${arch}: member writes highlight the correct cell and survive rewind`, () => {
    const m = new Machine(compile(source), arch);
    const writes = [];
    while (!m.s.halted) {
      const before = structuredClone(m.s);
      const op = m.program.code[m.s.pc];
      const after = structuredClone(m.step());
      if (op.op === 'STORE') {
        assert.equal(after.changedMemory.length, 1);
        writes.push(after.memory[after.changedMemory[0]].name);
        assert.ok(after.activity.includes('memory'));
      }
      m.back();
      assert.deepEqual(m.s, before);
      assert.deepEqual(m.step(), after);
    }
    assert.deepEqual(writes, ['a.x', 'a.y']);
  });
}

test('member reads work in expressions, calls, cout and compound assignments', () => {
  const state = execute(`${definition}
int twice(int n) { return n * 2; }
int main() {
  A a;
  a.x = 1;
  a.y = twice(a.x) + 3;
  a.x += a.y;
  int old = a.x++;
  ++a.y;
  cout << a.x << "," << a.y << endl;
  assert(a.x == 7 && a.y == 6);
  return old + a.y;
}`);
  assert.equal(state.error, null);
  assert.equal(state.result, 12);
  assert.equal(state.output, '7,6\n');
});

test('objects, lexical scopes and recursive frames have independent storage', () => {
  const state = execute(`${definition}
int recursive(int n) { A a; a.x = n; if (n == 0) return a.x; return recursive(n - 1) + a.x; }
int main() { A a; A b; a.x = 1; b.x = 8; { A a; a.x = 99; b.y = a.x; } return a.x + b.x + b.y + recursive(3); }`);
  assert.equal(state.error, null);
  assert.equal(state.result, 114);
  assert.ok(Object.values(state.memory).every(cell => cell.frame === 1));
});

test('object declarations work in loop initializers and reset on each declaration', () => {
  const state = execute(`${definition} int main() { int total = 0; for (A a; total < 3; total++) { a.x = total; } return total; }`);
  assert.equal(state.error, null);
  assert.equal(state.result, 3);
  const reset = execute(`${definition} int main() { for (int i = 0; i < 2; i++) { A a; if (i == 0) a.x = 7; else return a.x; } return 0; }`);
  assert.match(reset.error, /未初始化.*a.x/);
});

test('int and bool members preserve their own scalar conversion rules', () => {
  const state = execute('class Flags { public: bool active; int count; }; int main() { Flags f; f.active = 42; f.count = -3; return f.active + f.count; }');
  assert.equal(state.error, null);
  assert.equal(state.result, -2);
  assert.equal(member(state, 'f.active')[1].type, 'bool');
  assert.equal(member(state, 'f.active')[1].value, 1);
});

test('member instruction shows architecture dialect, object base and byte offset', () => {
  const instruction = compile(source).code.find(i => i.op === 'MEMBER' && i.name === 'a.y');
  assert.equal(instruction.line, 11);
  assert.match(assembly(instruction, 'x86'), /LEA EAX, \[a \+ 4\] ; a.y/);
  assert.match(assembly(instruction, 'arm64'), /ADR X0, \[a \+ 4\] ; a.y/);
});

test('uninitialized member read reports the original source line and can rewind', () => {
  const m = new Machine(compile(`${definition}\nint main() {\n  A a;\n  return a.y;\n}`));
  while (!m.s.halted) m.step();
  assert.match(m.s.error, /第 4 行.*未初始化.*a.y/);
  m.back();
  assert.equal(m.s.error, null);
  assert.equal(m.s.halted, false);
  assert.equal(member(m.s, 'a.y')[1].value, null);
});

test('new built-in example validates member values, not just return code', () => {
  const example = EXAMPLES.find(e => e.id === 'class-members');
  const state = execute(example.source);
  assert.equal(matchesExample(state, example), true);
  member(state, 'a.x')[1].value = 99;
  assert.equal(matchesExample(state, example), false);
});

for (const [name, program, message] of [
  ['unknown member', `${definition} int main() { A a; a.z = 1; return 0; }`, /没有成员 z/],
  ['scalar member access', 'int main() { int a = 0; a.x = 1; return 0; }', /只有类对象/],
  ['array member access', 'int main() { int a[2]; a.x = 1; return 0; }', /只有类对象/],
  ['default private', 'class A { int x; }; int main() { A a; return a.x; }', /private 成员/],
  ['explicit private', 'class A { public: int x; private: int y; }; int main() { A a; a.y = 1; return 0; }', /private 成员/],
  ['protected', 'class A { protected: int x; }; int main() { A a; return a.x; }', /protected 成员/],
  ['duplicate member', 'class A { public: int x; int x; }; int main() { return 0; }', /成员名重复/],
  ['duplicate class', `${definition} ${definition} int main() { return 0; }`, /类名重复/],
  ['object as scalar', `${definition} int main() { A a; return a; }`, /对象必须/],
  ['object copy assignment', `${definition} int main() { A a; A b; a = b; return 0; }`, /对象必须/],
  ['object initializer', `${definition} int main() { A a = 1; return 0; }`, /对象仅支持/],
  ['object array', `${definition} int main() { A a[2]; return 0; }`, /对象仅支持/],
  ['member initializer', 'class A { public: int x = 1; }; int main() { return 0; }', /默认初始化/],
  ['member array', 'class A { public: int x[2]; }; int main() { return 0; }', /数组/],
  ['method', 'class A { public: int f() { return 1; } }; int main() { return 0; }', /成员函数/],
  ['constructor', 'class A { public: A() {} int x; }; int main() { return 0; }', /构造函数/],
  ['empty class', 'class A {}; int main() { return 0; }', /至少包含/],
  ['inheritance', 'class A : B {}; int main() { return 0; }', /继承/],
  ['missing semicolon', 'class A { public: int x; } int main() { return 0; }', /需要「;」/],
]) test(`reject unsupported class usage: ${name}`, () => {
  assert.throws(() => compile(program), error => error instanceof ProgramError && message.test(error.message));
});

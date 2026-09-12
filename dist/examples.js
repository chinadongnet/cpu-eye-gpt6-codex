export const EXAMPLES = [
  { id: 'sum', name: '01 · 循环累加', description: '观察循环分支、累加运算与变量写回。', expected: 'sum = 55\n', result: 55, source: `#include <iostream>
using namespace std;

int main() {
  int sum = 0;
  for (int i = 1; i <= 10; i++) {
    sum += i;
  }
  cout << "sum = " << sum << endl;
  return sum;
}` },
  { id: 'factorial', name: '02 · 递归阶乘', description: '跟踪函数调用、栈帧分配与返回值。', expected: 'factorial = 120\n', result: 120, source: `#include <iostream>
using namespace std;

int factorial(int n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

int main() {
  int result = factorial(5);
  cout << "factorial = " << result << endl;
  return result;
}` },
  { id: 'sort', name: '03 · 数组冒泡排序', description: '查看数组的内存布局、比较与交换。', expected: '1 2 4 5 8 \n', result: 1, source: `#include <iostream>
using namespace std;

int main() {
  int a[5] = {5, 1, 4, 2, 8};
  for (int i = 0; i < 4; i++) {
    for (int j = 0; j < 4 - i; j++) {
      if (a[j] > a[j + 1]) {
        int temp = a[j];
        a[j] = a[j + 1];
        a[j + 1] = temp;
      }
    }
  }
  for (int k = 0; k < 5; k++) {
    cout << a[k] << " ";
  }
  cout << endl;
  return a[0];
}` },
  { id: 'fibonacci', name: '04 · 斐波那契数列', description: '用迭代计算数列，观察数据依赖。', expected: '0 1 1 2 3 5 8 13 \n', result: 21, source: `#include <iostream>
using namespace std;

int main() {
  int a = 0;
  int b = 1;
  for (int i = 0; i < 8; i++) {
    cout << a << " ";
    int next = a + b;
    a = b;
    b = next;
  }
  cout << endl;
  return a;
}` },
  { id: 'bits', name: '05 · 位运算与条件', description: '观察移位、按位与和逻辑判断。', expected: 'flags = 10\nbit 1 is set\n', result: 10, source: `#include <iostream>
#include <cassert>
using namespace std;

int main() {
  int flags = 0;
  flags = flags | (1 << 1);
  flags = flags | (1 << 3);
  cout << "flags = " << flags << endl;
  if ((flags & 2) != 0) {
    cout << "bit 1 is set" << endl;
  }
  assert(flags == 10);
  return flags;
}` },
  { id: 'gcd', name: '06 · 最大公约数', description: '用 while 与取模观察欧几里得算法。', expected: 'gcd = 6\n', result: 6, source: `#include <iostream>
using namespace std;

int main() {
  int a = 48;
  int b = 18;
  while (b != 0) {
    int remainder = a % b;
    a = b;
    b = remainder;
  }
  cout << "gcd = " << a << endl;
  return a;
}` }
];

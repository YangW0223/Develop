# 深入理解 JavaScript 面向对象：ES5 与 ES6+ 机制对比

<a id="reading-guide"></a>
## 0. 阅读说明

这是一篇从对象模型出发，逐步解释 ES5 构造函数、原型继承、ES2015 `class`、ES2022 私有字段以及 TypeScript/Babel 降级策略的教程。重点不是背诵语法，而是能够预测一个实例如何被创建、方法如何被查找、字段何时初始化，以及某个“继承”方案到底保留了哪些语义。

### 0.1 适用读者与前置知识

- 适用读者：已经会写基本 JavaScript，正在学习原型、`class`、继承或需要阅读 TypeScript/Babel 输出的前端开发者。
- 前置知识：变量、函数、对象、函数参数、条件语句，以及 `Object.create`、`Object.getPrototypeOf` 的基本用法。
- 本文不把“类”当作传统语言中的独立运行时实体。JavaScript 的 `class` 是一种具有额外语义的对象和构造器声明形式。

### 0.2 学习目标

读完后应该可以：

1. 区分对象的 `prototype` 属性和对象内部的 `[[Prototype]]` 链。
2. 手写并评价原型链、借用构造函数、经典组合、寄生组合四种 ES5 方案。
3. 解释普通函数被 `new` 调用时的概念步骤，以及返回对象的特殊规则。
4. 解释派生 `class` 中 `super()` 初始化 `this` 的准确原因。
5. 画出实例链和静态链，并判断静态方法、实例方法和私有字段的查找结果。
6. 识别字段初始化顺序、原生内置类继承、私有字段和降级输出的边界。

### 0.3 版本边界与学习优先级

- **ES5 基线**：本文把函数构造器、`Object.create` 和 `Object.defineProperty` 作为 ES5 继承讨论的主要工具。
- **ES2015（ES6）**：`class`、`extends`、`super`、静态方法、`Object.setPrototypeOf` 等语义从 ES2015 开始讨论。
- **ES2022**：`#name` 私有字段属于 ECMAScript 2022 的原生私有元素，不是 ES6 的功能。不同引擎的可用性应以目标运行环境为准。
- **TypeScript/Babel**：降级结果受编译器版本、目标版本和插件配置影响，不能从某一次输出推断所有项目的输出。
- 建议优先级：先掌握第 1～4 节的对象模型和 ES5 方案，再学习第 5～8 节的 `class`、字段、内置类和私有元素，最后阅读第 9～13 节的工程取舍与综合案例。

### 0.4 运行与检查命令

下面的命令适用于 Node.js 18+；示例只依赖 JavaScript 内置能力。

~~~bash
node --version
node --check oop-demo.js
node oop-demo.js
~~~

先把一个完整且正确的 JavaScript 代码块（包括它依赖的定义）保存为当前目录的 `oop-demo.js`，再运行上面的两个检查命令。预期结果是：`node --check oop-demo.js` 成功且无输出（退出码为 0）；`node oop-demo.js` 的输出应与该代码块下标注的“预期输出”一致，或者只执行断言并且不报错。标有“❌”的代码是故意展示错误边界的片段，不要与正确示例拼接后运行。若要验证 TypeScript 专属代码，应在项目有 TypeScript 依赖的前提下使用：

~~~bash
npx --yes --package typescript tsc --noEmit --strict --target ES2022 example.ts
~~~

这个命令只用于检查示例；它不会改变本文档或项目源文件。

<a id="toc"></a>
## 目录

- [阅读说明](#reading-guide)
- [对象模型与心智模型](#mental-model)
  - [构造函数也是对象](#constructor-is-object)
  - [`prototype` 与内部 [[Prototype]]](#prototype-vs-internal)
  - [`new` 的概念步骤](#new-steps)
- [ES5 的四种继承方案](#es5-inheritance)
  - [原型链继承](#es5-prototype-chain)
  - [借用构造函数](#es5-borrowed-constructor)
  - [经典组合继承](#es5-combination)
  - [寄生组合继承](#es5-parasitic-combination)
- [ES2015 `class` 的真实语义](#class-semantics)
  - [`class` 不是简单的语法替换](#class-not-substitution)
  - [双原型链](#dual-prototype-chain)
- [派生构造器与 `super`](#derived-constructors)
- [字段初始化顺序](#field-order)
- [原生内置类继承](#builtin-subclassing)
- [ES2022 私有字段](#private-elements)
- [TypeScript/Babel 降级](#downlevel)
- [完整对比与选型](#comparison-and-choice)
- [常见错误、边界与性能安全](#pitfalls)
- [综合案例](#integrated-case)
- [递进练习与自检](#practice-and-checklist)
- [总结与延伸阅读](#summary-and-reading)

<a id="mental-model"></a>
## 1. 对象模型与心智模型

### 1.1 对象、属性和委托

JavaScript 对象是一组属性的集合。读取属性时，如果对象自身没有这个名字，运行时会沿着对象的内部 `[[Prototype]]` 链继续查找。这种行为更适合称为**委托（delegation）**：对象把自己没有处理的属性请求委托给原型对象，而不是把父对象的属性逐个复制进来。

~~~javascript
const animal = {
  eat() {
    return 'eat';
  }
};

const dog = Object.create(animal);
dog.name = 'Milo';

console.assert(dog.name === 'Milo');
console.assert(dog.eat() === 'eat'); // dog 自身没有 eat，委托给 animal
console.assert(Object.hasOwn(dog, 'eat') === false);
~~~

原型上的方法通常是共享的一个函数值；实例上的数据属性通常是每个实例独有的。这解释了为什么“把所有可变数据放在原型上”容易让多个实例意外共享状态。

### 1.2 构造函数也是对象

函数本身也是对象，因此一个名为 `Animal` 的构造函数同时具有两组容易混淆的关系：

- `Animal.prototype` 是函数对象上的普通属性，通常指向一个供实例委托的对象。
- `Object.getPrototypeOf(Animal)` 才是在查函数对象本身的 `[[Prototype]]`，它通常来自 `Function.prototype`。
- `Animal` 还可以拥有自己的静态属性，例如 `Animal.create` 或 `Animal.category`。

因此，“实例继承实例方法”和“子类构造函数继承静态方法”是两条不同的关系。`class` 的 `extends` 会同时建立这两条关系；手写 ES5 代码需要分别处理。

<a id="constructor-is-object"></a>
### 1.3 普通函数、构造函数与 `this`

ES5 没有独立的 `class` 类型。普通函数在被 `new` 调用时表现为构造器；同一个函数也可以被普通调用、`call`、`apply`，这些调用方式的 `this` 规则不同。

“`new` 先把 `this` 设成字面量 `{}`”是一个有用但不精确的入门比喻。准确说法是：运行时根据当前构造目标（可在构造器内通过 `new.target` 观察）所对应的 `.prototype` 准备一个对象，并让它的内部 `[[Prototype]]` 指向合适的原型；它不一定是普通空对象，例如 `new Array()` 必须具备数组的特殊索引和 `length` 行为。

<a id="prototype-vs-internal"></a>
### 1.4 `prototype` 与内部 [[Prototype]]

下表区分两个名字相近、用途不同的概念：

| 概念 | 所属 | 作用 | 常用观察方式 |
| --- | --- | --- | --- |
| `F.prototype` | 构造器函数的普通属性 | 作为 `new F()` 实例的候选原型；也可被手动读取或替换 | `F.prototype` |
| 对象的 `[[Prototype]]` | 每个普通对象内部的规范关系 | 属性查找、方法委托和 `instanceof` 的基础 | `Object.getPrototypeOf(obj)` |
| `constructor` | 原型对象上的普通属性（约定）| 常被用来指回构造器，不是引擎的“真实父类指针”| `obj.constructor` |

创建实例时，运行时会读取当前构造目标（可通过构造器内的 `new.target` 观察）所对应的 `.prototype`。如果该值不是对象，则回退到相应的内置原型；这也是“事后替换构造器的 `prototype`”不会改变已有实例原型的原因。

生产代码优先使用 `Object.getPrototypeOf`、`Object.setPrototypeOf` 和 `Object.create` 等标准 API。`__proto__` 是历史访问器和兼容接口，不应该作为生产代码建立继承关系的主要 API；对象字面量中的特殊语法与它也不是同一个推荐层级。

<a id="new-steps"></a>
### 1.5 `new` 的概念步骤

以普通函数 `Point` 为例，下面是省略规范细节后的心智模型：

~~~javascript
function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype.toString = function () {
  return '(' + this.x + ', ' + this.y + ')';
};

const point = new Point(2, 3);
console.log(point.toString()); // (2, 3)
~~~

可以把这次调用理解为：

1. 确定当前构造目标；在构造器内可通过 `new.target` 观察，直接 `new Point()` 时通常是 `Point`。
2. 根据当前构造目标所对应的 `.prototype`（直接 `new Point()` 时就是 `Point.prototype`）创建实例对象的原型关系。
3. 以这个实例作为 `this`，调用 `Point` 并传入参数。
4. 如果构造器返回一个对象或函数，`new` 返回这个显式对象；否则返回步骤 2 准备的实例。构造器返回原始值时，该原始值不会替代实例。

~~~javascript
function Factory(value) {
  this.value = value;
  return { value: 'explicit object' };
}

const result = new Factory('ignored by replacement');
console.assert(result.value === 'explicit object');
console.assert(result instanceof Factory === false);
~~~

这里的“创建”不是把 `this` 写成固定的 `{}`。内置构造器、派生构造器和返回对象的构造器都可能改变最终结果，这正是需要精确心智模型的原因。规范算法可能把当前构造目标记作 `NewTarget`；它不是 JavaScript 源码变量。

<a id="es5-inheritance"></a>
## 2. ES5 的四种继承方案

ES5 方案可以拆成两个问题：

1. 构造函数怎样把父类属性初始化到子类实例上？
2. 子类原型怎样委托给父类原型，静态成员又怎样处理？

没有任何一个单独的赋值语句会自动解决全部问题。下面用同一个 `Animal`/`Dog` 主题区分四种常见方案。

<a id="es5-prototype-chain"></a>
### 2.1 原型链继承

最小形式是让子类原型对象委托给父类原型：

~~~javascript
function Animal() {}
Animal.prototype.eat = function () {
  return 'eat';
};

function Dog() {}
Dog.prototype = Object.create(Animal.prototype);
Object.defineProperty(Dog.prototype, 'constructor', {
  value: Dog,
  writable: true,
  configurable: true
});
Dog.prototype.bark = function () {
  return 'bark';
};

var dog = new Dog();
console.assert(dog.eat() === 'eat');
console.assert(dog.bark() === 'bark');
console.assert(dog instanceof Dog);
console.assert(dog instanceof Animal);
~~~

它主要继承的是方法委托关系，不会自动运行 `Animal` 构造器。如果把可变数据直接放在 `Animal.prototype`，所有实例还会共享同一份数据，因此通常不把它单独当作完整的业务继承方案。

直接写 `Dog.prototype = Animal.prototype` 更危险：两个构造器会共享同一个原型对象，给 Dog 增加方法会污染 Animal。`Object.create` 只建立委托关系，并没有复制父类原型的属性。

<a id="es5-borrowed-constructor"></a>
### 2.2 借用构造函数

借用构造函数只解决实例属性初始化：

~~~javascript
function Animal(name) {
  this.name = name;
}
Animal.prototype.eat = function () {
  return this.name + ' eats';
};

function Dog(name, breed) {
  Animal.call(this, name); // 在 Dog 实例上执行 Animal
  this.breed = breed;
}

var dog = new Dog('Milo', 'beagle');
console.assert(dog.name === 'Milo');
console.assert(dog.breed === 'beagle');
console.assert(typeof dog.eat === 'undefined'); // 没有接通原型链
~~~

优点是每个实例都得到独立的构造属性，也能向父构造器传不同参数；缺点是父类原型方法、静态成员和原型上的访问器都没有因此自动继承。它常作为组合方案的 “属性初始化”部分。

<a id="es5-combination"></a>
### 2.3 经典组合继承

经典组合把两件事放到一起：

~~~javascript
var parentConstructorRuns = 0;

function Parent(name) {
  parentConstructorRuns += 1;
  this.name = name;
}
Parent.prototype.say = function () {
  return 'hello ' + this.name;
};

function Child(name, level) {
  Parent.call(this, name); // 每次创建 Child 实例时运行一次
  this.level = level;
}

// 这一步为了取得 Parent.prototype，会在定义阶段再运行一次 Parent。
// 因而 Parent 构造器总共会执行两次：一次设置原型，一次设置实例。
Child.prototype = new Parent('prototype setup');
Object.defineProperty(Child.prototype, 'constructor', {
  value: Child,
  writable: true,
  configurable: true
});

var child = new Child('Ada', 2);
console.assert(child.say() === 'hello Ada');
console.assert(child.level === 2);
console.assert(parentConstructorRuns === 2);
~~~

这里的重复执行会把父构造器产生的数据属性放到 `Child.prototype` 上，同时又放到每个实例上；实例上的同名属性会遮蔽原型属性。若父构造器有副作用、需要参数或执行昂贵操作，这种重复就是明显的维护成本。

<a id="es5-parasitic-combination"></a>
### 2.4 寄生组合继承：原文代码属于这一类

更少重复执行父构造器的 ES5 写法是：

~~~javascript
function Animal(name) {
  this.name = name;
}
Animal.prototype.eat = function () {
  return this.name + ' eats';
};
Animal.describe = function () {
  return 'Animal constructor';
};

function Dog(name, breed) {
  Animal.call(this, name); // 借用构造函数：初始化实例属性
  this.breed = breed;
}

Dog.prototype = Object.create(Animal.prototype); // 寄生式创建原型
Object.defineProperty(Dog.prototype, 'constructor', {
  value: Dog,
  writable: true,
  configurable: true
});
Dog.prototype.bark = function () {
  return this.name + ' barks';
};

// 静态成员不会因为上面的实例原型链自动出现。
// ES5 中可以明确复制需要的静态成员：
Dog.describe = Animal.describe;

var dog = new Dog('Milo', 'beagle');
console.assert(dog.eat() === 'Milo eats');
console.assert(dog.bark() === 'Milo barks');
console.assert(dog.constructor === Dog);
console.assert(Dog.describe() === 'Animal constructor');
console.assert(Object.getPrototypeOf(Dog) !== Animal);
~~~

“`Parent.call(this)` + `Object.create(Parent.prototype)`”就是寄生组合继承的核心结构。它不会像 `new Parent()` 那样为了设置原型而再次执行父构造器，因此通常比经典组合更干净。

静态成员是否自动连接是另一个问题：上述 ES5 写法没有连接 `Dog` 和 `Animal` 这两个函数对象。可以显式复制特定静态成员，或者在支持 ES2015 API 的环境中使用 `Object.setPrototypeOf(Dog, Animal)`。后一种做法是建立静态委托，不是 ES5 原始语言本身自动完成的行为。不能笼统地说 ES5 “无法继承静态成员”。

<a id="class-semantics"></a>
## 3. ES2015 `class` 的真实语义

`class` 仍然以对象和原型委托为基础，但它增加了构造器调用限制、方法描述符、`super`、静态链、字段和私有元素等语义。因此“`class` 只是把 ES5 代码换一套写法”会漏掉重要边界。

~~~javascript
class Animal {
  constructor(name) {
    this.name = name;
  }

  eat() {
    return this.name + ' eats';
  }

  static category() {
    return 'animal';
  }
}

class Dog extends Animal {
  constructor(name, breed) {
    super(name);
    this.breed = breed;
  }

  bark() {
    return this.name + ' barks';
  }
}

const dog = new Dog('Milo', 'beagle');
console.assert(dog.eat() === 'Milo eats');
console.assert(dog.bark() === 'Milo barks');
console.assert(Dog.category() === 'animal');
~~~

<a id="class-not-substitution"></a>
### 3.1 `class` 与 ES5 不是逐字替换

`class` 至少有以下原生语义差异：

- `class` 构造器必须用 `new` 调用；直接 `Animal('Milo')` 会抛出 `TypeError`。
- `class` 方法体在严格模式语义下运行，即使源码没有写 `'use strict'`。普通函数是否严格取决于其代码上下文。
- 原型方法默认是不可枚举的。ES5 直接赋值 `Dog.prototype.bark = fn` 通常会创建可枚举属性。
- `class` 声明有类似词法声明的暂时性死区（TDZ）：执行到声明前访问会抛出 `ReferenceError`，不会得到 `undefined`。
- `extends` 会建立实例原型链和构造器静态链；只写 `Sub.prototype = Object.create(Base.prototype)` 只处理了前者。
- 派生构造器的 `this` 在 `super()` 前尚未初始化；普通 ES5 函数没有这条派生构造器规则。

这些差异意味着 Babel 或 TypeScript 的输出只能近似模拟目标版本的某些语义。应区分原生 `class` 的行为与编译器为旧目标生成的兼容代码。

### 3.2 方法、构造器和静态成员的描述符

~~~javascript
class Sample {
  method() {}
  static make() {}
}

const methodDescriptor =
  Object.getOwnPropertyDescriptor(Sample.prototype, 'method');
const staticDescriptor =
  Object.getOwnPropertyDescriptor(Sample, 'make');

console.assert(methodDescriptor.enumerable === false);
console.assert(staticDescriptor.enumerable === false);
console.assert(typeof Sample.prototype.constructor === 'function');
~~~

`constructor` 通常是原型对象上的不可枚举属性。用 `Object.defineProperty` 修复 ES5 子类的 `constructor`，可以让手写代码更接近 `class` 的默认属性描述符；这不改变方法查找本身。

<a id="dual-prototype-chain"></a>
### 3.3 双原型链：实例链与静态链

对于：

~~~javascript
class Base {}
class Sub extends Base {}
const instance = new Sub();
~~~

应同时画出两条链：

~~~text
实例链（实例方法查找）：
instance
  └─ [[Prototype]] → Sub.prototype
                         └─ [[Prototype]] → Base.prototype
                                                └─ [[Prototype]] → Object.prototype

静态链（构造器/静态成员查找）：
Sub
  └─ [[Prototype]] → Base
                       └─ [[Prototype]] → Function.prototype
~~~

实例读取 `instance.method` 时，从实例自身开始，再查 `Sub.prototype`、`Base.prototype`。静态读取 `Sub.create` 时，从函数对象 `Sub` 开始，再查 `Base`。静态链不是实例链的延长，`Sub.prototype` 上的方法也不会因为存在静态链而变成 `Sub` 的静态方法。

下面的断言把两条链都验证出来：

~~~javascript
class Base {
  static kind() {
    return 'base';
  }

  describe() {
    return 'base instance';
  }
}

class Sub extends Base {
  static ownKind() {
    return 'sub';
  }

  describe() {
    return 'sub instance';
  }
}

const instance = new Sub();

console.assert(Object.getPrototypeOf(instance) === Sub.prototype);
console.assert(Object.getPrototypeOf(Sub.prototype) === Base.prototype);
console.assert(Object.getPrototypeOf(Sub) === Base);
console.assert(instance.describe() === 'sub instance');
console.assert(Sub.kind() === 'base');
console.assert(Sub.ownKind() === 'sub');
~~~

`Object.getPrototypeOf` 用于观察原型链，`Object.setPrototypeOf` 用于建立或修改静态链；运行中频繁修改原型可能让引擎优化失效。声明 `class` 时由 `extends` 一次建立关系，是更清晰的设计；不要把 `Object.setPrototypeOf` 当成日常修补手段。

<a id="derived-constructors"></a>
## 4. 派生构造器与 `super`

### 4.1 `this` 为什么在 `super` 前未初始化

派生 `class` 的构造器进入时，规范语义上还没有可供它使用的 `this` 绑定。执行 `super(args)` 会调用基类构造器，并把当前的 `new.target` 传递给这次构造过程。基类构造器据此创建或接收最终实例，基类返回后，派生构造器才得到可以使用的 `this`。

这条规则的主要目的不是“防止父类覆盖子类属性”，也不是一个泛化的“内存安全开关”。更准确的原因是：派生构造器的实例创建责任由基类构造语义承接，而 `super()` 是取得该实例并完成基类初始化的规范步骤。它也能正确处理继承 `Array` 等需要特殊实例创建行为的内置构造器。

### 4.2 派生构造器的返回边界

如果派生构造器不调用 `super()`，但显式返回一个对象，这个对象可以成为构造结果：

~~~javascript
class Base {}
class FactoryChild extends Base {
  constructor(value) {
    return { value: value };
  }
}

const created = new FactoryChild(7);
console.assert(created.value === 7);
console.assert(created instanceof FactoryChild === false);
~~~

下面是故意错误的边界示例：

~~~javascript
// ❌ 错误：在 super 前读取或写入 this。
class ErrorBase {}

class BadBeforeSuper extends ErrorBase {
  constructor() {
    this.value = 1;
    super();
  }
}
// new BadBeforeSuper(); // ❌ 预期 ReferenceError

// ❌ 错误：派生构造器结束时 this 仍未初始化。
class BadWithoutSuper extends ErrorBase {
  constructor() {}
}
// new BadWithoutSuper(); // ❌ 预期 ReferenceError

// ❌ 错误：显式返回原始值不能替代未初始化的 this。
class BadPrimitiveReturn extends ErrorBase {
  constructor() {
    return 1;
  }
}
// new BadPrimitiveReturn(); // ❌ 预期 TypeError
~~~

在现代 Node.js 中，这些示例分别会在构造时报告 `ReferenceError` 或 `TypeError`；显式返回 `undefined` 也不能绕过未初始化的 `this`。具体错误文本由引擎版本决定。错误片段只用于定位边界，不能直接并入正常示例。

### 4.3 `super` 与当前 `new.target`

当执行 `new FactoryChild()` 或普通的 `new Sub()` 时，派生构造器调用的 `super()` 使用当前构造过程的 `new.target`。因此基类不只是“返回一个普通 Base 实例”：它可以依据构造目标创建适合子类的实例。这是内置类继承能够保留数组行为的重要基础。

<a id="field-order"></a>
## 5. 字段初始化顺序

公有实例字段也有明确的初始化时机，不能简单理解为“编译器把赋值都放到构造函数体的最后一行”。

- 基类实例字段：在基类构造函数体开始执行前初始化。
- 派生实例字段：在 `super()` 返回、派生构造器继续执行前初始化。
- 同一个类的字段按声明顺序初始化；字段初始化表达式可以读取此前已经初始化的字段，但不要依赖后声明字段。
- 父构造器调用一个可被子类覆写的方法时，动态分派已经能看到子类原型方法，但派生实例字段尚未初始化。这是“父构造器调用虚方法”的常见陷阱。

~~~javascript
class Base {
  baseField = 'base field';

  constructor() {
    console.log('base field:', this.baseField);
    console.log('virtual call:', this.describe());
  }

  describe() {
    return 'base description';
  }
}

class Derived extends Base {
  childField = 'child field';

  constructor() {
    super();
    console.log('after super:', this.childField);
  }

  describe() {
    return this.childField || 'child field is not initialized';
  }
}

new Derived();
~~~

预期输出：

~~~text
base field: base field
virtual call: child field is not initialized
after super: child field
~~~

因此，构造器中调用可覆写方法时，不应假定子类字段已经可用。常见做法是只在基类构造阶段使用基类自己的状态，或者改为显式的初始化方法，在整个对象创建完成后再调用。

### 5.1 字段与原型方法的区别

~~~javascript
class Counter {
  count = 0;                 // 每个实例一份自己的数据属性

  increment() {              // 一个共享的原型方法
    this.count += 1;
  }
}

const first = new Counter();
const second = new Counter();
first.increment();

console.assert(first.count === 1);
console.assert(second.count === 0);
console.assert(
  Object.hasOwn(first, 'increment') === false
);
~~~

字段初始化通常产生实例自有属性；方法仍位于原型上。把箭头函数写成字段会让每个实例创建一个函数，例如 `handle = () => ...`，这可能方便绑定 `this`，但会增加每实例的函数和闭包成本，应按场景取舍。

<a id="builtin-subclassing"></a>
## 6. 原生内置类继承

### 6.1 ES5 Array.call 的局限

ES5 中常见的尝试是：

~~~javascript
function LegacyList() {
  Array.apply(this, arguments);
}
LegacyList.prototype = Object.create(Array.prototype);
Object.defineProperty(LegacyList.prototype, 'constructor', {
  value: LegacyList,
  writable: true,
  configurable: true
});

const legacy = new LegacyList('a');
legacy[0] = 'first';

console.log(Array.isArray(legacy)); // false
console.log(legacy.length);         // 0，不会因普通索引自动关联
~~~

`Array.apply` 会产生一个真正的数组返回值，但 `LegacyList` 没有返回它；原本由 `new` 准备的对象仍是普通对象。即使把 `Array.prototype` 接到原型链上，也不能补上数组对索引和 `length` 的特殊关联行为。具体内部机制由规范定义为数组的特殊对象行为，本文不依赖容易误记的内部槽名称。

### 6.2 ES2015 `class` `extends` Array

~~~javascript
class ModernList extends Array {}

const modern = new ModernList('a', 'b');
modern[2] = 'c';

console.log(Array.isArray(modern)); // true
console.log(modern.length);         // 3
console.assert(modern instanceof ModernList);
console.assert(modern instanceof Array);
~~~

原生 `Array` 参与了实例创建，因而保留了数组的索引和 `length` 语义。`Map`、`Set`、`Error` 等内置类也有各自的初始化要求；不能仅凭 `Sub.prototype = Object.create(Base.prototype)` 就推断所有内置类都能在 ES5 中被完整模拟。

<a id="private-elements"></a>
## 7. ES2022 私有字段与 TypeScript `private`

### 7.1 `#name` 私有字段是原生私有元素

`#name` 私有字段属于 ECMAScript 2022 的私有元素机制。它不是 ES6 `class` 的功能，也不是把字符串 `'#name'` 作为属性名。

~~~javascript
class Vault {
  #token;

  constructor(token) {
    this.#token = token;
  }

  read() {
    return this.#token;
  }
}

const vault = new Vault('secret');
console.assert(vault.read() === 'secret');
console.assert(vault['#token'] === undefined);
console.assert(Object.keys(vault).length === 0);
console.assert(Object.getOwnPropertyNames(vault).includes('#token') === false);
console.assert(Object.getOwnPropertySymbols(vault).length === 0);
~~~

私有字段具有品牌（brand）语义：只有由声明该私有名字的 `class` 初始化过的对象，才能通过该 `class` 的私有访问语法读取它。私有元素不会出现在普通属性反射结果中，不能用字符串或 Symbol API 取得。

每个 `class` 的私有名字都是独立的。子类不能直接访问基类声明的同名私有字段；子类如果也声明 `#token`，那是另一个私有名字。子类可以调用基类的公开或受保护式接口（JavaScript 没有原生 protected 关键字）来间接使用能力。

~~~javascript
class ParentVault {
  #token = 'parent';

  readParentToken() {
    return this.#token;
  }
}

class ChildVault extends ParentVault {
  #token = 'child';

  readChildToken() {
    return this.#token;
  }
}

const child = new ChildVault();
console.assert(child.readParentToken() === 'parent');
console.assert(child.readChildToken() === 'child');
~~~

故意错误的访问应独立看待：

~~~javascript
// ❌ 错误：#token 对 ChildVault 来说不是 ParentVault 的私有名字。
// class BadChild extends ParentVault {
//   read() { return this.#token; }
// }
~~~

### 7.2 品牌检查的失败路径

即使对象长得像正确实例，也没有对应私有品牌：

~~~javascript
class User {
  #id = 1;

  getId() {
    return this.#id;
  }
}

try {
  User.prototype.getId.call({ id: 1 });
} catch (error) {
  console.log(error.constructor.name); // TypeError
}
~~~

这是一种运行时访问检查，不等同于把字段名称“藏起来”。拿到对象引用的人仍然可以调用公开方法；公开方法本身如何验证输入、暴露哪些能力，仍然是 API 设计问题。

### 7.3 与 TypeScript `private` 的区别

TypeScript 的 `private` 默认主要是编译期可见性约束：TypeScript 检查器会阻止类外源码直接访问，但 JavaScript 输出是否保留真正的 `#name` 私有字段，取决于源码写法、编译目标和配置。传统的 TypeScript `private value` 通常仍是一个运行时属性，能够被 JavaScript 反射或通过计算属性名访问；它不能自动等同于 ECMAScript 的品牌私有字段。

关于 TypeScript 类成员、访问修饰符和原生私有字段，请结合 [TypeScript Classes](ts/docs/06-类与接口.md) 阅读。该链接解释的是本项目中的 TypeScript 语境；本文只比较运行时边界，不替代 TypeScript 类型检查文档。

<a id="downlevel"></a>
## 8. TypeScript/Babel 降级：语法转换不等于 polyfill

### 8.1 先区分两件事

- **语法转换**：把 `class`、字段或私有方法改写成目标版本能解析的语法。
- **运行时补丁（polyfill）**：给目标环境补上缺失的 API，例如 `WeakMap`、`Object.setPrototypeOf` 或 Promise。

编译器可以把语法改写成 ES5，却不能凭空让 ES5 引擎拥有数组内置类继承、弱引用或所有新的标准 API。目标环境仍缺少运行时能力时，要按项目的兼容策略提供 polyfill，且应确认 polyfill 的语义边界。

### 8.2 私有元素的常见降级策略

TypeScript/Babel 的规范式转换常见做法包括：

- 用闭包外部的 `WeakMap` 保存实例到私有值的映射；
- 用 `WeakSet` 或辅助函数记录私有方法/品牌；
- 生成 helper，处理父构造器调用、字段初始化或静态继承；
- 按编译器版本和选项选择不同的属性描述符、辅助函数和模块包装方式。

这些只是常见策略，不是所有版本的固定输出。若目标环境本身没有 `WeakMap`，输出中出现 `WeakMap` 仍然需要相应 polyfill；把语法转换误称为“自动提供弱引用”是不准确的。

也不要把 polyfill 描述成“必定用 `Object.defineProperty` 模拟弱引用”。普通属性无法完整提供弱引用和垃圾回收可观察性；没有真正弱引用时，实现可能改变隐私、可回收性或其他语义，具体应查所用 polyfill 的文档和测试。

### 8.3 Babel loose 与原生私有语义

Babel 的 loose 选项以及与 `privateFieldsAsProperties` 相关的配置，可能把私有字段转换成带有生成键的普通自有属性（通常会尽量保持不可枚举）。这类输出更接近“难以意外碰撞的属性”，而不是原生 `#name` 私有字段的品牌检查：

- 反射、调试器或意外获得生成键时，暴露面不同；
- 子类和非声明 `class` 的访问限制可能不同；
- 不应从 loose 输出推断原生私有字段的安全性或绝对不可见性。

规范式和宽松式转换还可能在包体积、兼容性和运行时行为上不同。没有统一基准时，不给它们排“性能星级”；需要性能结论时，固定引擎、版本、数据规模和工作负载后再测量。

<a id="comparison-and-choice"></a>
## 9. 完整对比与方案选型

### 9.1 机制对比表

| 维度 | ES5 原型/函数方案 | ES2015+ `class` | ES2022 `#` 私有元素 | 降级输出 |
| --- | --- | --- | --- | --- |
| 实例创建 | 普通函数配合 `new`；返回对象可替代实例 | 构造器只能 `new`；派生构造器需完成 `super` 或返回对象 | 依附 `class` 实例初始化品牌 | 由编译器 helper 尽量模拟 |
| 实例方法 | 手动接通 `prototype` 链 | 方法默认在 `prototype` 且不可枚举 | 私有方法不在普通属性查找中 | 可能变成 WeakSet/helper 或生成属性 |
| 实例数据 | 构造器中 `this` 属性；原型数据会共享 | 构造器或公有字段；字段有明确时机 | 私有值不参与普通反射 | WeakMap 或配置相关的生成属性 |
| 静态成员 | 不会因实例链自动继承，需复制或手动连接 | `extends` 建立 Sub → Base 静态链 | 私有静态成员有独立品牌/名字 | 由输出策略模拟，细节随版本变化 |
| 原生内置类 | Array.call 无法补上数组特殊行为 | `extends` Array 等可保留内置行为 | 仍受基类创建流程约束 | 取决于目标环境和 helper 能力 |
| 调用限制 | 同一函数可普通调用或 `new`，需自行约定 | `class` 直接调用抛 TypeError | 同样依附 `class` 语义 | 可能通过 helper 近似实现 |
| 可见性 | 约定、闭包、Symbol 或 WeakMap | public 默认可见；`#` 私有元素原生隐藏 | brand 检查，反射看不到 | loose 和规范式语义不同 |
| 失败方式 | `this`、`constructor`、共享状态问题多由代码负责 | `super`、TDZ、返回值有运行时限制 | 私有品牌不匹配抛 TypeError | 错误文本和细节随编译器/引擎 |
| 验证方式 | node --check、断言和属性描述符 | 同上，另检查原型双链 | 正常访问、反射和失败路径 | 检查编译产物并在目标环境运行 |

### 9.2 继承还是组合

选择继承前先问：子类型是否能在调用者期待父类型的地方成立？如果只是复用几个能力，组合通常更容易维护。

| 场景 | 倾向 | 原因 |
| --- | --- | --- |
| 稳定的“是一种”关系，且需要共享协议 | 继承 | 原型方法和多态查找表达清楚 |
| 多个不相关对象都需要同一行为 | 组合/委托 | 避免多重继承式的层级耦合 |
| 行为经常变化、需要按配置装配 | 组合 | 可以替换策略对象，不必改原型链 |
| 需要继承 Array/Map 等内置语义 | 原生 `class` `extends` | 让内置构造器参与创建 |
| 只想复用初始化逻辑 | 工厂函数或组合 | 避免脆弱基类和父构造器副作用 |
| 需要模块边界内的真正私有状态 | `#` 私有元素或闭包 | 明确品牌/闭包边界，再设计公开接口 |

继承并不会自动解决可变状态、资源释放或输入校验。组合也不是“没有类型”；可以用明确的接口、工厂函数和测试表达契约。

<a id="pitfalls"></a>
## 10. 常见错误、边界与性能安全

### 10.1 原型与构造器错误

- ❌ `Sub.prototype = Base.prototype`：共享同一个对象，子类改方法会污染父类。
- ❌ 重写 `Sub.prototype` 后忘记 `constructor`：继承链可能仍能工作，但 `instance.constructor` 会沿链得到错误或不稳定的结果。
- ❌ 只写 `Parent.call(this)`：有实例属性，没有父类原型方法。
- ❌ 只写 `Object.create(Parent.prototype)`：有方法委托，却没有运行父构造器初始化实例属性。
- ❌ 把 `__proto__` 当作生产继承 API：可读性、兼容性和优化都不如标准 API 或 `class` `extends`。
- ❌ 认为 ES5 寄生组合自动继承静态成员：实例链和静态链必须分开处理。

### 10.2 `class` 与字段错误

- ❌ 在派生构造器的 `super()` 前访问 `this`。
- ❌ 认为调用 `super()` 只是为了防止父构造器覆盖属性；真正重点是派生实例初始化和当前 `new.target` 的构造语义。
- ❌ 在父构造器中调用可覆写方法，并假设子类字段已初始化。
- ❌ 把 `class` 方法当作实例自有函数；默认方法在原型上共享。
- ❌ 把 TypeScript `private` 当作运行时的 `#name` 私有字段。
- ❌ 把编译器一次输出、某个 loose 选项或某个 polyfill 的实现当成 ECMAScript 规范本身。

### 10.3 性能与安全的定性说明

- 稳定的原型链和共享原型方法通常有利于减少每实例函数数量；但真实性能受引擎、对象形状、访问模式和数据规模影响，不能用固定星级概括。
- 实例字段、箭头函数字段和闭包都会增加每实例状态或函数；只有在确实需要独立闭包/绑定时才使用。
- 创建实例后频繁使用 `Object.setPrototypeOf` 可能让引擎失去优化；优先在定义阶段建立结构。
- `#name` 私有字段能限制 JavaScript 代码按名称访问字段，但不是网络隔离、权限系统或输入校验。公开方法仍应校验外部数据，不能因为字段私有就信任调用者。
- `WeakMap` 的弱键关系有助于避免外部实例被回收后仍被映射强持有；这不代表所有 polyfill 都能保持相同的垃圾回收语义。
- 构造器应尽量少做外部副作用。尤其不要在原型设置阶段为了“取得 `prototype`”运行一个会发请求、注册全局监听或修改共享状态的父构造器。

<a id="integrated-case"></a>
## 11. 综合案例：实体、静态工厂与私有状态

下面的案例把前面的四条线放在一起：

1. `Entity` 构造器初始化公开 id；
2. 实例方法通过原型查找，子类用 `super.label()` 复用父实现；
3. 静态 `from` 沿静态链继承，并通过当前构造目标创建正确子类；
4. `#role` 只有 `UserEntity` 的方法能访问。

~~~javascript
class Entity {
  static category = 'entity';
  #prefix = 'entity:';

  constructor(id) {
    this.id = id;
  }

  label() {
    return this.#prefix + this.id;
  }

  static from(id) {
    return new this(id);
  }
}

class UserEntity extends Entity {
  static category = 'user';
  #role;

  constructor(id, role) {
    super(id);
    this.#role = role || 'reader';
  }

  label() {
    return super.label() + ':' + this.#role;
  }

  role() {
    return this.#role;
  }
}

const user = UserEntity.from(42);
console.log(user.label());                    // entity:42:reader
console.log(user.role());                     // reader
console.log(UserEntity.category);             // user
console.log(Entity.category);                 // entity
console.log(user instanceof UserEntity);      // true
console.log(user instanceof Entity);          // true
console.log(Object.getPrototypeOf(UserEntity) === Entity); // true
console.log(
  Object.getPrototypeOf(UserEntity.prototype) === Entity.prototype
); // true
console.log(Object.keys(user));               // [ 'id' ]

console.assert(user.label() === 'entity:42:reader');
console.assert(UserEntity.from(7) instanceof UserEntity);
console.assert(Entity.from(7) instanceof Entity);
~~~

上面第一条 `console.log` 的注释同时提醒了一个容易忽略的点：传入 `42` 但没有角色时，默认值是 `reader`。真实输出是：

~~~text
entity:42:reader
reader
user
entity
true
true
true
true
[ 'id' ]
~~~

私有品牌失败路径：

> 这是一个片段，需紧接上一个完整案例在同一作用域运行；它依赖上一段定义的 `Entity` 和 `user`。

~~~javascript
try {
  Entity.prototype.label.call({ id: 42 });
} catch (error) {
  console.log(error.constructor.name); // TypeError
}

console.assert(user['#role'] === undefined);
~~~

故意的静态/私有访问错误：

~~~javascript
// ❌ 错误：静态链不能让实例直接拥有静态成员。
// console.log(user.from(1));

// ❌ 错误：UserEntity 不能用源码语法访问 Entity.#prefix。
// class InvalidUser extends Entity {
//   read() { return this.#prefix; }
// }
~~~

### 11.1 综合案例的查找路径

- `user.label`：实例没有自有 label，先到 `UserEntity.prototype` 找到覆写方法。
- `super.label()`：在该方法的“方法所属对象”（`home object`）语义下调用 `Entity.prototype.label`，`this` 仍是 user，因此 Entity 的私有品牌检查成功。
- `UserEntity.from`：UserEntity 自身没有 from，于是沿静态链找到 Entity.from；其中的 `this` 是 UserEntity，所以 `new this(id)` 产生 UserEntity。
- `user['#role']`：这是普通字符串属性查找，不是私有字段访问，因而得到 undefined；私有访问必须在声明该名字的 `class` 语法中完成。

<a id="practice-and-checklist"></a>
## 12. 递进练习与提交前自检

### 12.1 练习一：画出 `new`

写一个 `Point` 构造函数，并分别测试：

- 直接调用、`new` 调用、`call` 调用的 `this` 差异；
- 替换 `Point.prototype` 前后创建的实例；
- 构造器返回普通对象、函数和原始值时的结果。

先写出四步心智模型，再用 `Object.getPrototypeOf` 和断言验证。

### 12.2 练习二：实现并比较 ES5 方案

实现原型链、借用构造函数、经典组合和寄生组合四个版本，记录：

- 父构造器执行次数；
- 实例自身有哪些属性；
- `instanceof` 的结果；
- 父类实例方法和静态方法是否可用；
- 两个实例修改可变字段时是否互相影响。

先写验收点，再运行代码；不要只比较代码行数。

### 12.3 练习三：字段顺序实验

复制第 5 节的 `Base`/`Derived`，增加第二个子类字段，让父构造器调用两个方法，记录每个时点能看到哪些字段。把预期输出写在代码旁边，再验证是否一致。

### 12.4 练习四：私有字段与降级

分别测试原生 `#id`、TypeScript `private` 和 WeakMap 映射：

- 公开反射能看到什么；
- 把方法借给普通对象调用时如何失败；
- 子类是否能直接访问；
- 编译到 ES5 后目标环境是否仍提供 WeakMap。

结论必须标注“语言原生语义”“编译器输出”或“运行时 polyfill”，不要混为一谈。

### 12.5 自检清单

- [ ] 标题、文件名、章节术语一致。
- [ ] 已说明读者、前置知识、目标、版本边界和运行命令。
- [ ] 能解释 `prototype`、`[[Prototype]]`、`constructor`、`new.target` 的区别。
- [ ] 已准确区分四种 ES5 方案，指出寄生组合不自动连接静态成员。
- [ ] 已解释 `class` 的严格模式、不可枚举方法、TDZ、只能 `new` 和双原型链。
- [ ] 已说明派生构造器的 `this` 初始化、`super`/`new.target` 和显式返回边界。
- [ ] 已验证基类字段、派生字段和父构造器虚调用的顺序。
- [ ] 已说明 Array 等内置类不能靠 Array.call 模拟完整行为。
- [ ] 已把 `#name` 私有字段标为 ES2022，并与 TypeScript `private` 区分。
- [ ] 已说明降级策略随版本配置变化，语法转换不等于 polyfill。
- [ ] 错误示例有“❌”并与可运行示例隔离。
- [ ] 关键代码可用 node --check 和 node 断言验证。
- [ ] 重要结论有规范或官方文档链接。

<a id="summary-and-reading"></a>
## 13. 总结与延伸阅读

### 13.1 一页总结

- 对象通过 `[[Prototype]]` 委托属性查找；构造器函数自身也是对象。
- `F.prototype` 是构造器的普通属性，不能和实例的 `[[Prototype]]` 混为一谈。
- 普通 `new` 会按当前构造目标所对应的 `.prototype` 准备实例（源码可在构造器内通过 `new.target` 观察），调用构造器，并允许对象返回值替代默认实例。
- ES5 继承要分别处理实例初始化、实例方法链和静态成员；原文的 `Parent.call(this)` 加 `Object.create` 是寄生组合。
- `class` 建立实例链和静态链，但不仅是 ES5 的文字缩写；它还改变调用、方法描述符、`super`、字段和私有元素语义。
- 派生构造器在 `super()` 前没有可用的 `this`；字段初始化发生在规定的构造阶段，而不是任意“编译器移动赋值”。
- ES2015 `class` 能正确参与 Array 等内置类的实例创建；ES5 的 `Array.call` 不能补齐数组特殊行为。
- `#name` 私有字段是 ES2022 的品牌私有元素；TypeScript `private` 和 loose 降级不可直接当成同一件事。
- 语法降级、polyfill 和性能结论必须分别验证，不能把某次编译产物当成规范。

### 13.2 官方与权威阅读

- [ECMA-262：Class Definitions](https://tc39.es/ecma262/multipage/ecmascript-language-functions-and-classes.html#sec-class-definitions)
- [ECMA-262：`super` 关键字](https://tc39.es/ecma262/multipage/ecmascript-language-functions-and-classes.html#sec-super-keyword)
- [ECMA-262：Private Elements](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-private-elements)
- [TypeScript Handbook：Classes](https://www.typescriptlang.org/docs/handbook/2/classes.html)
- [Babel：Transform Private Methods](https://babel.dev/docs/babel-plugin-transform-private-methods)
- [Babel：Transform Class Properties](https://babel.dev/docs/babel-plugin-transform-class-properties)
- [MDN：继承与原型链](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Inheritance_and_the_prototype_chain)

规范链接描述的是对应版本的语言语义；TypeScript、Babel 和 polyfill 文档描述的是工具实现。阅读时始终结合项目的目标环境和编译配置。

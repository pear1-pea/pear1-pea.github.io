---
title: 单例初始化
published: 2026-04-21
description: ""
category: C++
draft: false
---

## 单例初始化

### 总结

**从底层原理来看，静态局部变量初始化、std::once_flag、std::atomic + 双重检查锁定都实现了"线程安全、只初始化一次"这一目标，只是语法抽象层次不同，适用场景略有差异**

|     特性     |    局部静态变量    | std::once_flag+std::call_flag | std::atomic+双重检测 |
| :----------: | :----------------: | :---------------------------: | :-------------------: |
|   线程安全   |     C++11 保证     |        call_once 保证        |  自己实现，容易写错  |
| 只初始化一次 |      自动控制      |           自动控制           |       自己控制       |
|  写法简洁性  |        最简        |             稍复             |    代码复杂、易错    |
|     性能     | 最优（编译器优化） |     好（标准库层面实现）     | 较差（锁和原子操作） |
|   使用场景   | 推荐用于 Singleton |     多种用途，不限于单例     |      一般不推荐      |
|     依赖     |   编译器自动支持   |          标准库机制          | 手动管理锁和原子变量 |

这些逻辑只是你**显式写出来"还是语言/库帮你写好了**的区别。

### 古老的双重检测

双重检测（Double-Checked Locking） 是一种线程安全地创建单例对象的写法，它让我们在高并发下，只在必要时才加锁，提升性能。

```c++
//没锁的单例，多线程下会创建多个实例
class Singleton {
public:
    static Singleton* getInstance() {
        if (instance == nullptr) {
            instance = new Singleton();
        }
        return instance;
    }

private:
    Singleton() {} // 构造函数私有
    static Singleton* instance;
};
Singleton* Singleton::instance = nullptr;
//所以有了经典的双重检验锁
static Singleton* getInstance() {
    if (instance == nullptr) {                  // 第一次检查，大多数情况下 instance != nullptr，就能直接返回实例，不用加锁，性能高。
        std::lock_guard<std::mutex> lock(mtx);  //如果真为空才加锁
        if (instance == nullptr) {              // 第二次检查，可能多个线程都发现是空，只有第一个拿到锁的线程才会创建实例
            instance = new Singleton();
        }
    }
    return instance;
}
```

但这种经典双重检测在C++11以前是不安全的，因为编译器和CPU可能会对指令**乱序优化**，即`instance = new Singleton();`的三步（分配内存、调用构造函数和赋值）二三会调换顺序。
这样其他线程看到 instance != nullptr，但其实还没构造好，就会访问未初始化的对象。（所以要用原子指针）

### atomic+双重检测

```c++
#include <atomic>
#include <mutex>

class Singleton {
public:
    static Singleton* getInstance() {
        Singleton* tmp = instance.load(std::memory_order_acquire);// 内存屏障：让之后对内存的访问不会被乱序执行，确保我们拿到的是"构造完毕的实例"
        if (tmp == nullptr) {
            std::lock_guard<std::mutex> lock(mtx);
            tmp = instance.load(std::memory_order_relaxed);//因为锁已经保证了内存可见性
            if (tmp == nullptr) {
                tmp = new Singleton();
                instance.store(tmp, std::memory_order_release);//为了配对 load(std::memory_order_acquire)，保证所有写操作（构造）在指针存入前完成。
            }
        }
        return tmp;
    }
//再次重申一次三条注释的逻辑：确保看到构造完的对象->已有mutex保证同步，不必在强制顺序->保证构造完成后再发布到insatnce
private:
    Singleton() {}
    static std::atomic<Singleton*> instance;
    static std::mutex mtx;
};

std::atomic<Singleton*> Singleton::instance = nullptr;
std::mutex Singleton::mtx;
```

1. 为什么要用原子指针？
   如果多个线程几乎同时进入getinstance，普通指针情况下同时看到instance=nullptr会都创建对象，发生竞态条件。
   而在原子指针条件下，"读写instance这个变量是原子的"，即：不能被多个线程同时修改也不会指令乱序
   这种配对：

```c++
store(..., std::memory_order_release);
load(..., std::memory_order_acquire);
```

称为 acquire-release 语义，用来保证"先写后读" 的顺序性与可见性。下文将详解C++11的内存模型
2. 原子性、可见性、顺序性

|         性质         |              说明              |          重要性          |
| :------------------: | :----------------------------: | :----------------------: |
| 原子性（Atomicity） | 操作不可被中断，全部做完或不做 |  防止 "写一半" 的状态  |
| 可见性（Visibility） |  线程能看到别的线程修改后的值  |       防止读到旧值       |
|  顺序性（Ordering）  |   保证操作执行顺序不会被乱序   | 防止构造完成之前就被看到 |

### C++11静态局部变量

```c++
class Singleton {
public:
    static Singleton& getInstance() {
        static Singleton instance; //由于static所以只会初始化一次
        return instance;
    }

private:
    Singleton() {}
};
```

为什么局部静态变量`static Singleton instance;`没有使用原子指针、也没有显示加锁，却能做到线程安全、可见性保障、并让其他线程"在那等着"？
因为C++11 标准明确规定局部静态变量的初始化必须是线程安全的，并且由编译器自动插入"同步机制"（通常是锁或更轻量的方式）来实现这一点。

> If control enters the declaration concurrently while the variable is being initialized, the concurrent execution shall wait for completion of the initialization.

编译器一般会为`static Singleton instance;`生成：

```c++
if (!__guard_variable_initialized) {
    std::lock_guard<std::mutex> lock(__internal_guard_mutex);
    if (!__guard_variable_initialized) {
        new (&instance) Singleton();        // 构造对象
        __guard_variable_initialized = true;
    }
}
```

一个隐藏的布尔变量标记是否已初始化，一个隐藏的锁防止并发初始化，编译器底层自动插入这些，使所有线程都通过锁序列化访问初始化代码，实现可见性和顺序性。
所有你用`atomic`想保障的行为,这里都内建了！

### once_flag & call_flag

```c++
class Singleton {
public:
    static Singleton* getInstance() {
        std::call_once(initFlag, []() {
            instance = new Singleton();
        });//如果是第一次，就执行lambda
        return instance;
    }
private:
    Singleton() {}
    static Singleton* instance;
    static std::once_flag initFlag;//std::once_flag是一个小的状态对象，记录初始化操作是否已经执行过来
};
Singleton* Singleton::instance = nullptr;
std::once_flag Singleton::initFlag;
```

1. 不要在 call_once() 的函数体中抛出异常：如果你抛了，flag 会被"复位"，下一次还会再执行。
2. 只适用于一次性初始化：不能用于通用锁用途。
3. 不能复制 std::once_flag：因为它是不可复制、不可赋值的对象（只用来标记一次性状态）。
4. C++ 标准保证这个操作是线程安全的+高性能的，底层用的是原子操作或更底层的CPU指令。

### 小细节

```c++
template <typename T>
class Singleton{
protected:
    Singleton() = default;
    Singleton(const Singleton<T>&) = delete;
    Singleton& operator = (const Singleton<T>& st)=delete;
    static std::shared_ptr<T> _instance;
public:
    static std::shared_ptr<T> GetInstance(){
        static std::once_flag s_flag;
        std::call_once(s_flag,[&](){
            _instance=std::shared_ptr<T>(new T);//1
        });
        return _instance;
    }
};
template <typename T>
std::shared_ptr<T> Singleton<T>::_instance=nullptr;//3
```

1. 为什么这里用shared_ptr+new而不是make_shared?

> make_shared需要访问类的构造函数，但是这个单例类的构造函数是protected的，无法被智能指针访问

2. make_shared & shared_ptr

   |    比较点    |                   std::shared_ptr<T>(new T)                   |            std::make_shared<T>()            |
   | :----------: | :-----------------------------------------------------------: | :-----------------------------------------: |
   | 内存分配次数 |                两次（一次给 T，一次给控制块）                |        一次（一次性分配 T 和控制块）        |
   |     性能     |                             稍慢                             |              更快、更缓存友好              |
   |  异常安全性  | 差一点：如果 new T 成功但后面构造 shared_ptr 抛异常，内存泄漏 |                   更安全                   |
   |  构造私有类  |             允许，只要写 new 的地方是友元或类内部             |  不允许，make_shared 访问不到私有构造函数 |
   |     写法     |                         冗长、易出错                         |               简洁、现代风格               |

make_shared优势：如果 new T(args) 成功，但接下来在 shared_ptr 的构造过程中（比如自定义 deleter）抛了异常——那 T 创建出来但没人管理，就会内存泄漏。而 make_shared 是一个整体，不存在中间状态，更安全：
使用 std::make_shared 的缺点是它在一个内存块中同时分配对象和控制块导致即使所有 shared_ptr 实例都已销毁，由于如 std::weak_ptr 的其他引用，内存可能仍未释放
可以通过make_shaerd创建，请搜索静态工厂函数

3. 类模板的静态成员变量必须在类外单独定义，否则编译通过，链接会报错（undefined reference to Singleton<T>::_instance）

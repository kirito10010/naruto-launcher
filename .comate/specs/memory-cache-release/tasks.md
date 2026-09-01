# 激活标签内存超限时清缓存释放（不重载）

- [x] Task 1: 在 main.js 新增清缓存阈值常量与记录对象
    - 1.1: 在 getMemoryMB() 之后新增 ACTIVE_MEM_CLEAR_THRESHOLD = 2500
    - 1.2: 新增 CACHE_CLEAR_COOLDOWN = 3 * 60 * 1000
    - 1.3: 新增 lastCacheClear 记录对象（webContentsId -> timestamp）

- [x] Task 2: 修改 memory-check 处理器增加清缓存分支
    - 2.1: 在现有 1500MB 判断之后追加 2500MB 清缓存判断
    - 2.2: 用冷却时间限制同一标签清缓存频率
    - 2.3: 调用 wc.session.clearCache() 并记录成功/失败日志

- [x] Task 3: 验证语法并打包
    - 3.1: node --check 校验 main.js 语法
    - 3.2: 打包为 3.1.1 验证功能

/**
 * @mc-creator/devkit —— 开发内核（设计文档 §8）。
 * 构建沙箱与工具链管理：JDK 选型、Gradle 编排、隔离沙箱、产物哈希。
 */
export * from './jdk.js';
export * from './jdk-download.js';
export * from './gradle.js';
// 生成器只写 gradle-wrapper.properties，不写 gradlew/gradlew.bat/wrapper.jar：
// 构建前补齐这一步，否则 spawn gradlew 必 ENOENT（见该文件头的实测证据）。
export * from './gradle-bootstrap.js';
// 按需预热：ForgeGradle 反编译缓存是冷启大头（实测每个 MC 版本约 385MB / 3 分钟），
// 后台全铺满不现实（8 个版本 ≈ 3GB），所以形态是「用户主动预热他选的那一个版本」。
export * from './gradle-warmup.js';
export * from './sandbox.js';
// §8.3 进程级隔离的实施者：把 sandbox.ts 的声明式契约接到真实进程隔离上。
// 在此之前 buildSandboxOptions 是死代码，envAllowlist 从未被执行过。
export * from './sandbox-exec.js';
export * from './run-validation.js';
export * from './artifact.js';
export * from './build-queue.js';

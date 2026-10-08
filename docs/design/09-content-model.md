## 9. 内容对象模型（34 类，按家族组织）

```markdown
A. 版本与运行时
GameVersion 版本清单、正式版/快照/远古版、加载器版本
JavaRuntime Java 运行时（Java only）

B. 身份
Account 账户（正版/离线/第三方）
Cape 披风

C. 实例与环境
Instance 游戏实例 / Profile
World 存档
WorldTemplate 世界模板

D. Java 内容
Modpack · Mod · ResourcePack · Shader · Datapack

E. Bedrock 内容
Add-on · SkinPack · TexturePack

F. 通用内容
Skin · SoundPack · LanguagePack · Font · Structure（.nbt/.schematic/.litematic）

G. 服务端
Server · ServerConfig · ServerPlugin · Proxy · ProxyPlugin · ProxyConfig
ServerBackup · ServerTask

H. 开发
ModProject · PluginProject · BuildArtifact
DevToolchain · MappingSet · TestHarness
```

**注**：Recipe / Advancement / LootTable 属数据包内部元素，
但需支持独立检索与单点生成。

---

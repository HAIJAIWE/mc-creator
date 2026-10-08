## 17. 智能体驱动的跨域闭环（示例场景）

**场景 A：一句需求到可玩服务端**

```
用户："做个自动钓鱼的插件，跑在测试服上"
→ get_capabilities('server')          确认插件受支持
→ 注入 Paper API + Folia 标记
→ generate_content(plugin)            生成工程
→ build_project(projectRef)           devkit 编译
→ deploy_plugin(projectRef, serverId) 部署
→ restart_server(serverId)            重启（hot reload 优先）
→ read_logs(serverId)                 验证加载成功
→ 失败则回灌修复，循环
```

**场景 B：跨域改动**

```
用户："把新地图包加到测试服，顺便让客户端也更新整合包"
→ install_modpack(ref, {edition:'java', instanceId})
→ import_package(worldPath, {edition:'server', serverId})
→ restart_server(serverId)
→ read_logs(...)
```

---
